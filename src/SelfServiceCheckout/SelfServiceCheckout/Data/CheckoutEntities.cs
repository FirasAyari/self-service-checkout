namespace SelfServiceCheckout.Data;

public sealed class CatalogItemEntity
{
    public required string Id { get; set; }
    public required string Category { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public long PriceCents { get; set; }
    public int? Stock { get; set; }
    public bool IsActive { get; set; }
    public int SortOrder { get; set; }
}

public sealed class QuoteEntity
{
    public required string Id { get; set; }
    public long CreatedAtUnixMs { get; set; }
    public long ExpiresAtUnixMs { get; set; }
    public long TotalCents { get; set; }
    public long TaxCents { get; set; }
    public required string LinesJson { get; set; }
}

public sealed class OrderEntity
{
    public required string Id { get; set; }
    public required string PublicReference { get; set; }
    public required string IdempotencyKey { get; set; }
    public required string RequestHash { get; set; }
    public required string QuoteId { get; set; }
    public required string KioskId { get; set; }
    public required string Status { get; set; }
    public long TotalCents { get; set; }
    public long TaxCents { get; set; }
    public string? PickupBusinessDate { get; set; }
    public int? PickupNumber { get; set; }
    public bool StockReleased { get; set; }
    public long CreatedAtUnixMs { get; set; }
    public long UpdatedAtUnixMs { get; set; }
    public List<OrderLineEntity> Lines { get; set; } = [];
    public PaymentAttemptEntity? PaymentAttempt { get; set; }
}

public sealed class OrderLineEntity
{
    public required string OrderId { get; set; }
    public required string ItemId { get; set; }
    public required string ItemName { get; set; }
    public int Quantity { get; set; }
    public long UnitPriceCents { get; set; }
    public long LineTotalCents { get; set; }
    public bool FiniteStock { get; set; }
}

public sealed class PaymentAttemptEntity
{
    public required string Id { get; set; }
    public required string OrderId { get; set; }
    public required string Status { get; set; }
    public long CreatedAtUnixMs { get; set; }
    public OrderEntity? Order { get; set; }
    public PaymentLedgerEntity? Ledger { get; set; }
}

public sealed class PaymentLedgerEntity
{
    public required string AttemptId { get; set; }
    public required string Outcome { get; set; }
    public required string TransactionReference { get; set; }
    public long RecordedAtUnixMs { get; set; }
    public PaymentAttemptEntity? Attempt { get; set; }
}

public sealed class PickupCounterEntity
{
    public required string BusinessDate { get; set; }
    public int NextNumber { get; set; }
}

public sealed class PaymentDeclineLockoutEntity
{
    public required string KioskId { get; set; }
    public long LockedUntilUnixMs { get; set; }
}

public sealed record QuoteLineSnapshot(
    string ItemId,
    string Name,
    int Quantity,
    long UnitPriceCents,
    long LineTotalCents,
    IReadOnlyList<string>? OptionIds = null,
    long? BaseUnitPriceCents = null);
