using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Checkout.Domain;

namespace SelfServiceCheckout.Application;

public sealed class CatalogService(
    ICatalogStore catalogStore,
    TimeProvider timeProvider,
    CheckoutOptions options) : IMenuQueryService, IQuoteService, IQuoteMaintenanceService
{
    private const int QuoteCleanupBatchSize = 500;
    private static readonly TimeSpan QuoteRetentionAfterExpiry = TimeSpan.FromDays(1);

    public async Task<MenuSnapshot> GetMenuAsync(CancellationToken cancellationToken)
    {
        var items = await catalogStore.GetActiveItemsAsync(null, cancellationToken);
        var versionSource = string.Join('\n', items.Select(item =>
            $"{item.Id}|{item.PriceCents}|{item.Stock?.ToString() ?? "unlimited"}|{item.IsActive}|{MenuOptionCatalog.VersionDescriptor(item.Id)}"));
        var version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(versionSource)))[..16];
        var categories = items
            .GroupBy(item => item.Category)
            .Select(group => new MenuCategorySnapshot(group.Key, group.Select(item => new MenuItemSnapshot(
                item.Id,
                item.Category,
                item.Name,
                item.Description,
                item.PriceCents,
                item.Stock,
                item.Stock is null or > 0,
                MenuOptionCatalog.GetGroups(item.Id))).ToArray()))
            .ToArray();

        return new MenuSnapshot(version, categories);
    }

    public async Task<QuoteSnapshot> CreateQuoteAsync(IReadOnlyCollection<CartLine?>? lines, CancellationToken cancellationToken)
    {
        var cart = CartRules.Normalize(lines);
        if (!cart.IsValid)
        {
            throw new CheckoutException(cart.ErrorCode!, cart.Message!, CheckoutFailureKind.InvalidRequest);
        }

        var itemIds = cart.Lines.Select(line => line.ItemId).ToArray();
        var catalog = (await catalogStore.GetActiveItemsAsync(itemIds, cancellationToken))
            .ToDictionary(item => item.Id, StringComparer.Ordinal);

        var snapshots = new List<QuoteLineSnapshot>(cart.Lines.Count);
        long totalCents = 0;
        foreach (var line in cart.Lines)
        {
            if (!catalog.TryGetValue(line.ItemId, out var item))
            {
                throw new CheckoutException("ITEM_UNAVAILABLE", "A menu item is no longer available. Remove it and review your cart.", CheckoutFailureKind.Conflict);
            }

            if (item.Stock is not null && item.Stock < line.Quantity)
            {
                throw new CheckoutException("STOCK_CHANGED", $"There are not enough {item.Name} portions left. Update your cart and review it again.", CheckoutFailureKind.Conflict);
            }

            if (!MenuOptionCatalog.TryResolve(line.ItemId, line.OptionIds, out var selectedOptions))
            {
                throw new CheckoutException("ITEM_OPTIONS", "Choose valid options for this menu item and review your cart again.", CheckoutFailureKind.InvalidRequest);
            }

            var unitPriceCents = checked(item.PriceCents + selectedOptions.Sum(option => option.AdditionalPriceCents));
            var lineTotalCents = checked(unitPriceCents * line.Quantity);
            totalCents = checked(totalCents + lineTotalCents);
            var selectedName = selectedOptions.Count == 0
                ? item.Name
                : $"{item.Name} ({string.Join(", ", selectedOptions.Select(option => option.Name))})";
            snapshots.Add(new QuoteLineSnapshot(
                item.Id,
                selectedName,
                line.Quantity,
                unitPriceCents,
                lineTotalCents,
                selectedOptions.Select(option => option.Id).ToArray(),
                item.PriceCents));
        }

        if (totalCents > CartRules.MaxTotalCents)
        {
            throw new CheckoutException("ORDER_LIMIT", "The order total is above the $150.00 limit. Remove an item and try again.", CheckoutFailureKind.InvalidRequest);
        }

        var now = timeProvider.GetUtcNow();
        var quoteId = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var expiresAt = now.AddSeconds(options.QuoteLifetimeSeconds);
        var taxCents = InclusiveTax.Calculate(totalCents, options.TaxRateBasisPoints);
        await catalogStore.SaveQuoteAsync(new QuoteRecord(
            quoteId,
            now.ToUnixTimeMilliseconds(),
            expiresAt.ToUnixTimeMilliseconds(),
            totalCents,
            taxCents,
            JsonSerializer.Serialize(snapshots)), cancellationToken);

        return ToQuoteResponse(quoteId, expiresAt, snapshots, totalCents, taxCents);
    }

    public Task<int> CleanupExpiredQuotesAsync(CancellationToken cancellationToken)
    {
        var cutoffUnixMs = timeProvider.GetUtcNow()
            .Subtract(QuoteRetentionAfterExpiry)
            .ToUnixTimeMilliseconds();
        return catalogStore.DeleteExpiredQuotesAsync(cutoffUnixMs, QuoteCleanupBatchSize, cancellationToken);
    }

    private static QuoteSnapshot ToQuoteResponse(
        string quoteId,
        DateTimeOffset expiresAt,
        IReadOnlyList<QuoteLineSnapshot> lines,
        long totalCents,
        long taxCents) => new QuoteSnapshot(
            quoteId,
            expiresAt,
            lines.Select(line => new QuotedLineSnapshot(
                line.ItemId,
                line.Name,
                line.Quantity,
                line.UnitPriceCents,
                line.LineTotalCents,
                line.OptionIds ?? Array.Empty<string>())).ToArray(),
            totalCents,
            taxCents,
            "USD");
}
