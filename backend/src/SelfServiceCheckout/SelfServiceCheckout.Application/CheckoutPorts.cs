using Checkout.Domain;

namespace SelfServiceCheckout.Application;

public interface IMenuQueryService
{
    Task<MenuSnapshot> GetMenuAsync(CancellationToken cancellationToken);
}

public interface IQuoteService
{
    Task<QuoteSnapshot> CreateQuoteAsync(IReadOnlyCollection<CartLine?>? lines, CancellationToken cancellationToken);
}

public interface IQuoteMaintenanceService
{
    Task<int> CleanupExpiredQuotesAsync(CancellationToken cancellationToken);
}

public interface ICatalogStore
{
    Task<IReadOnlyList<CatalogItemRecord>> GetActiveItemsAsync(
        IReadOnlyCollection<string>? itemIds,
        CancellationToken cancellationToken);

    Task SaveQuoteAsync(QuoteRecord quote, CancellationToken cancellationToken);
    Task<int> DeleteExpiredQuotesAsync(long expiredBeforeUnixMs, int maximumCount, CancellationToken cancellationToken);
}

public sealed record CatalogItemRecord(
    string Id,
    string Category,
    string Name,
    string Description,
    long PriceCents,
    int? Stock,
    bool IsActive,
    int SortOrder);

public sealed record QuoteRecord(
    string Id,
    long CreatedAtUnixMs,
    long ExpiresAtUnixMs,
    long TotalCents,
    long TaxCents,
    string LinesJson);

public sealed record QuoteLineSnapshot(
    string ItemId,
    string Name,
    int Quantity,
    long UnitPriceCents,
    long LineTotalCents,
    IReadOnlyList<string>? OptionIds = null,
    long? BaseUnitPriceCents = null);

public interface IOrderPlacementService
{
    Task<PlaceOrderResult> PlaceOrderAsync(PlaceOrderCommand command, CancellationToken cancellationToken);
}

public interface IOrderReservationStore
{
    Task<OrderReservation> ReserveAsync(OrderReservationCommand command, CancellationToken cancellationToken);
}

public sealed record OrderReservationCommand(
    string IdempotencyKey,
    string QuoteId,
    string RequestHash,
    string KioskId);

public sealed record OrderReservation(string OrderId, string AttemptId, bool IsReplay);

public interface IOrderStatusService
{
    Task<OrderStatusSnapshot> GetOrderStatusAsync(string idempotencyKey, CancellationToken cancellationToken);
}

public interface IPaymentReconciliationService
{
    Task ReconcilePendingAsync(CancellationToken cancellationToken);
}

public interface IPaymentOutcomeSettlement
{
    Task SettleAttemptAsync(string attemptId, CancellationToken cancellationToken);
    Task<OrderStatusSnapshot> LoadOrderStatusAsync(
        string idempotencyKey,
        string orderId,
        CancellationToken cancellationToken);
}

public interface IMockPaymentGateway
{
    DemoChaosConfiguration Configuration { get; }
    Task RecordScenarioAsync(
        string attemptId,
        PaymentScenario scenario,
        DemoChaosConfiguration configuration,
        CancellationToken cancellationToken);
}

public interface IDemoAdministrationService
{
    Task<IReadOnlyList<CatalogItemRecord>> GetCatalogItemsAsync(CancellationToken cancellationToken);

    Task<bool> UpdateCatalogItemAsync(
        string itemId,
        long? priceCents,
        int? stock,
        bool? isActive,
        bool clearStock,
        CancellationToken cancellationToken);

    Task ResetAsync(CancellationToken cancellationToken);
}

public sealed record PlaceOrderResult(OrderStatusSnapshot Order, bool IsReplay);

public sealed record PlaceOrderCommand(string QuoteId, string IdempotencyKey, PaymentScenario Scenario);

public sealed record SimulatedPaymentPolicy(bool IsDevelopment);

public enum CheckoutFailureKind
{
    InvalidRequest,
    Conflict,
    NotFound,
    Unavailable,
    RateLimited,
    Unprocessable
}
