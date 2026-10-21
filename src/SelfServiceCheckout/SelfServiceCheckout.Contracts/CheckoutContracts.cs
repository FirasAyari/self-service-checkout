namespace SelfServiceCheckout.Contracts;

public sealed record MenuItemDto(
    string Id,
    string Category,
    string Name,
    string Description,
    long PriceCents,
    int? Stock,
    bool IsAvailable,
    IReadOnlyList<MenuItemOptionGroupDto> OptionGroups);

public sealed record MenuItemOptionDto(string Id, string Name, long AdditionalPriceCents);

public sealed record MenuItemOptionGroupDto(
    string Id,
    string Name,
    bool IsRequired,
    int MaximumSelections,
    IReadOnlyList<MenuItemOptionDto> Options);

public sealed record MenuCategoryDto(string Name, IReadOnlyList<MenuItemDto> Items);

public sealed record MenuResponse(string Version, IReadOnlyList<MenuCategoryDto> Categories);

public sealed record CartLineRequest(string ItemId, int Quantity, IReadOnlyList<string>? OptionIds = null);

public sealed record QuoteRequest(IReadOnlyList<CartLineRequest?>? Items);

public sealed record QuoteLineDto(
    string ItemId,
    string Name,
    int Quantity,
    long UnitPriceCents,
    long LineTotalCents,
    IReadOnlyList<string> OptionIds);

public sealed record QuoteResponse(
    string QuoteId,
    DateTimeOffset ExpiresAtUtc,
    IReadOnlyList<QuoteLineDto> Lines,
    long TotalCents,
    long TaxCents,
    string Currency);

public enum MockPaymentScenario
{
    Approve,
    Decline,
    UnknownAfterApproval,
    StillUnknown
}

public sealed record PlaceOrderRequest(
    string QuoteId,
    string IdempotencyKey,
    MockPaymentScenario Scenario);

public sealed record OrderStatusRequest(string IdempotencyKey);

public sealed record OrderLineStatusDto(
    string ItemId,
    string Name,
    int Quantity,
    long UnitPriceCents,
    long LineTotalCents);

public sealed record OrderStatusResponse(
    string PublicReference,
    string Status,
    int? PickupNumber,
    DateTimeOffset UpdatedAtUtc,
    string Message,
    IReadOnlyList<OrderLineStatusDto> Lines,
    long TotalCents,
    long TaxCents,
    string Currency);

public sealed record ApiErrorResponse(string Code, string Message, string? TraceId = null);

public sealed record PlaceOrderResponse(OrderStatusResponse Order);
