using SelfServiceCheckout.Contracts;

namespace SelfServiceCheckout.Application;

public interface IMenuQueryService
{
    Task<MenuResponse> GetMenuAsync(CancellationToken cancellationToken);
}

public interface IQuoteService
{
    Task<QuoteResponse> CreateQuoteAsync(QuoteRequest request, CancellationToken cancellationToken);
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
    Task<PlaceOrderResult> PlaceOrderAsync(PlaceOrderRequest request, CancellationToken cancellationToken);
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
    Task<OrderStatusResponse> GetOrderStatusAsync(OrderStatusRequest request, CancellationToken cancellationToken);
}

public interface IPaymentReconciliationService
{
    Task ReconcilePendingAsync(CancellationToken cancellationToken);
}

public interface IPaymentOutcomeSettlement
{
    Task SettleAttemptAsync(string attemptId, CancellationToken cancellationToken);
    Task<OrderStatusResponse> LoadOrderStatusAsync(
        string idempotencyKey,
        string orderId,
        CancellationToken cancellationToken);
}

public interface IMockPaymentGateway
{
    DemoChaosConfiguration Configuration { get; }
    Task RecordScenarioAsync(
        string attemptId,
        MockPaymentScenario scenario,
        DemoChaosConfiguration configuration,
        CancellationToken cancellationToken);
}

public interface IDemoAdministrationService
{
    Task<bool> UpdateCatalogItemAsync(
        string itemId,
        long? priceCents,
        int? stock,
        bool? isActive,
        bool clearStock,
        CancellationToken cancellationToken);

    Task ResetAsync(CancellationToken cancellationToken);
}

public sealed record PlaceOrderResult(OrderStatusResponse Order, bool IsReplay);

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
