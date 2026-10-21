namespace SelfServiceCheckout.Application;

public enum PaymentScenario
{
    Approve,
    Decline,
    UnknownAfterApproval,
    StillUnknown
}

public sealed record MenuSnapshot(string Version, IReadOnlyList<MenuCategorySnapshot> Categories);

public sealed record MenuCategorySnapshot(string Name, IReadOnlyList<MenuItemSnapshot> Items);

public sealed record MenuItemSnapshot(
    string Id,
    string Category,
    string Name,
    string Description,
    long PriceCents,
    int? Stock,
    bool IsAvailable,
    IReadOnlyList<MenuOptionGroupSnapshot> OptionGroups);

public sealed record MenuOptionGroupSnapshot(
    string Id,
    string Name,
    bool IsRequired,
    int MaximumSelections,
    IReadOnlyList<MenuOptionSnapshot> Options);

public sealed record MenuOptionSnapshot(string Id, string Name, long AdditionalPriceCents);

public sealed record QuoteSnapshot(
    string QuoteId,
    DateTimeOffset ExpiresAtUtc,
    IReadOnlyList<QuotedLineSnapshot> Lines,
    long TotalCents,
    long TaxCents,
    string Currency);

public sealed record QuotedLineSnapshot(
    string ItemId,
    string Name,
    int Quantity,
    long UnitPriceCents,
    long LineTotalCents,
    IReadOnlyList<string> OptionIds);

public sealed record OrderStatusSnapshot(
    string PublicReference,
    string Status,
    int? PickupNumber,
    DateTimeOffset UpdatedAtUtc,
    string Message,
    IReadOnlyList<OrderLineSnapshot> Lines,
    long TotalCents,
    long TaxCents,
    string Currency);

public sealed record OrderLineSnapshot(
    string ItemId,
    string Name,
    int Quantity,
    long UnitPriceCents,
    long LineTotalCents);
