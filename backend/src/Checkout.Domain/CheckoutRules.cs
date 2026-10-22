using System.Collections.ObjectModel;

namespace Checkout.Domain;

public sealed record CartLine(string ItemId, int Quantity, IReadOnlyList<string>? OptionIds = null);

public sealed record CartValidationResult(
    bool IsValid,
    IReadOnlyList<CartLine> Lines,
    string? ErrorCode = null,
    string? Message = null);

public static class CartRules
{
    public const int MaxQuantityPerLine = 10;
    public const int MaxLines = 15;
    public const int MaxUnits = 30;
    public const long MaxTotalCents = 15_000;

    public static CartValidationResult Normalize(IReadOnlyCollection<CartLine?>? input)
    {
        if (input is null || input.Count is 0 or > MaxUnits)
        {
            return Invalid("CART_SIZE", $"Choose no more than {MaxLines} different items and {MaxUnits} items total.");
        }

        var normalizedByItem = new Dictionary<string, (int Quantity, string[] OptionIds)>(StringComparer.Ordinal);
        foreach (var line in input)
        {
            if (line is null || string.IsNullOrWhiteSpace(line.ItemId) || line.ItemId.Length > 64 ||
                line.Quantity is < 1 or > MaxQuantityPerLine)
            {
                return Invalid("CART_LINE", "Each item needs a valid ID and a quantity from 1 to 10.");
            }

            var requestedOptions = line.OptionIds ?? Array.Empty<string>();
            if (requestedOptions.Count > 8 || requestedOptions.Any(option =>
                    string.IsNullOrWhiteSpace(option) || option.Length > 64) ||
                requestedOptions.Distinct(StringComparer.Ordinal).Count() != requestedOptions.Count)
            {
                return Invalid("CART_OPTIONS", "Choose valid, unique options for each menu item.");
            }

            var optionIds = requestedOptions.Order(StringComparer.Ordinal).ToArray();
            if (normalizedByItem.TryGetValue(line.ItemId, out var existing))
            {
                if (!existing.OptionIds.SequenceEqual(optionIds, StringComparer.Ordinal))
                {
                    return Invalid("CART_OPTIONS", "Choose one option set for each menu item.");
                }

                var combinedQuantity = existing.Quantity + line.Quantity;
                if (combinedQuantity > MaxQuantityPerLine)
                {
                    return Invalid("CART_LINE", $"Choose up to {MaxQuantityPerLine} of each item.");
                }

                normalizedByItem[line.ItemId] = (combinedQuantity, optionIds);
            }
            else
            {
                normalizedByItem.Add(line.ItemId, (line.Quantity, optionIds));
            }
        }

        if (normalizedByItem.Count > MaxLines)
        {
            return Invalid("CART_SIZE", $"Choose no more than {MaxLines} different items.");
        }

        var normalized = normalizedByItem
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => new CartLine(
                pair.Key,
                pair.Value.Quantity,
                pair.Value.OptionIds.Length == 0 ? null : pair.Value.OptionIds))
            .ToArray();

        if (normalized.Sum(line => line.Quantity) > MaxUnits)
        {
            return Invalid("CART_UNITS", $"An order can have up to {MaxUnits} items.");
        }

        return new CartValidationResult(true, new ReadOnlyCollection<CartLine>(normalized));
    }

    private static CartValidationResult Invalid(string code, string message) =>
        new(false, Array.Empty<CartLine>(), code, message);
}

public static class InclusiveTax
{
    public static long Calculate(long grossCents, int rateBasisPoints)
    {
        if (grossCents < 0 || rateBasisPoints is < 0 or > 10_000)
        {
            throw new ArgumentOutOfRangeException(nameof(grossCents));
        }

        var numerator = checked(grossCents * rateBasisPoints);
        var denominator = 10_000L + rateBasisPoints;
        return checked((numerator + denominator / 2) / denominator);
    }
}

public enum OrderStatus
{
    PendingPayment,
    Paid,
    PaymentFailed
}

public enum PaymentOutcome
{
    Approved,
    Declined
}

public static class OrderTransitions
{
    public static bool CanTransition(OrderStatus current, OrderStatus next) =>
        current == OrderStatus.PendingPayment && next is OrderStatus.Paid or OrderStatus.PaymentFailed;
}
