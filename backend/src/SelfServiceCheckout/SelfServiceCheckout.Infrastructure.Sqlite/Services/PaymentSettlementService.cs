using System.Data;
using Checkout.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite.Services;

public sealed class PaymentSettlementService(
    IDbContextFactory<CheckoutDbContext> databaseFactory,
    TimeProvider timeProvider,
    IOptions<CheckoutOptions> options) : IPaymentOutcomeSettlement, IOrderStatusService, IPaymentReconciliationService
{
    private const string PendingStatus = "PENDING_PAYMENT";
    private const string PaidStatus = "PAID";
    private const string FailedStatus = "PAYMENT_FAILED";
    private const long DeclineWindowMilliseconds = 10 * 60 * 1_000;
    private const long PaymentLockoutMilliseconds = 60 * 1_000;
    private const int DeclinesBeforeLockout = 5;
    private const int MaximumDatabaseContentionRetries = 3;
    private readonly CheckoutOptions _options = options.Value;
    private readonly TimeZoneInfo _businessTimeZone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.BusinessTimeZone);

    public async Task<OrderStatusSnapshot> GetOrderStatusAsync(
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        ValidateIdempotencyKey(idempotencyKey);
        string? attemptId;
        string? orderId;
        await using (var database = await databaseFactory.CreateDbContextAsync(cancellationToken))
        {
            var order = await database.Orders
                .AsNoTracking()
                .Where(item => item.IdempotencyKey == idempotencyKey)
                .Select(item => new { item.Id, AttemptId = item.PaymentAttempt!.Id })
                .SingleOrDefaultAsync(cancellationToken);
            attemptId = order?.AttemptId;
            orderId = order?.Id;
        }

        if (attemptId is null || orderId is null)
        {
            throw new CheckoutException("ORDER_NOT_FOUND", "This payment attempt is not in the system yet. Retry the same attempt to check safely.", CheckoutFailureKind.NotFound);
        }

        await SettleAttemptAsync(attemptId, CancellationToken.None);
        return await LoadOrderStatusAsync(idempotencyKey, orderId, cancellationToken);
    }

    public async Task ReconcilePendingAsync(CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var pendingAttemptIds = await database.PaymentAttempts
            .AsNoTracking()
            .Where(attempt => attempt.Status == PendingStatus && attempt.Ledger != null)
            .OrderBy(attempt => attempt.CreatedAtUnixMs)
            .Select(attempt => attempt.Id)
            .Take(100)
            .ToListAsync(cancellationToken);

        foreach (var attemptId in pendingAttemptIds)
        {
            await SettleAttemptAsync(attemptId, cancellationToken);
        }
    }

    public async Task SettleAttemptAsync(string attemptId, CancellationToken cancellationToken)
    {
        for (var retry = 0; ; retry++)
        {
            try
            {
                await SettleAttemptCoreAsync(attemptId, cancellationToken);
                return;
            }
            catch (Exception exception) when (IsSqliteBusy(exception))
            {
                if (retry >= MaximumDatabaseContentionRetries)
                {
                    throw new CheckoutException(
                        "DATABASE_BUSY",
                        "The order is still being confirmed. Check the same payment attempt again after database contention clears.",
                        CheckoutFailureKind.Unavailable);
                }

                var backoff = TimeSpan.FromMilliseconds((25 * (1 << retry)) + Random.Shared.Next(0, 50));
                await Task.Delay(backoff, cancellationToken);
            }
        }
    }

    private async Task SettleAttemptCoreAsync(string attemptId, CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
        var attempt = await database.PaymentAttempts
            .Include(item => item.Ledger)
            .Include(item => item.Order)
            .SingleOrDefaultAsync(item => item.Id == attemptId, cancellationToken);

        if (attempt is null || attempt.Status != PendingStatus || attempt.Ledger is null || attempt.Order is null)
        {
            return;
        }

        var order = attempt.Order;
        if (order.Status != PendingStatus)
        {
            return;
        }

        var now = timeProvider.GetUtcNow();
        var updatedAt = now.ToUnixTimeMilliseconds();
        if (attempt.Ledger.Outcome == "Approved")
        {
            var businessDate = TimeZoneInfo.ConvertTime(now, _businessTimeZone).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
            var counterUpdated = await database.PickupCounters
                .Where(counter => counter.BusinessDate == businessDate)
                .ExecuteUpdateAsync(update => update.SetProperty(counter => counter.NextNumber, counter => counter.NextNumber + 1), cancellationToken);

            int pickupNumber;
            if (counterUpdated == 0)
            {
                database.PickupCounters.Add(new PickupCounterEntity { BusinessDate = businessDate, NextNumber = 2 });
                await database.SaveChangesAsync(cancellationToken);
                pickupNumber = 1;
            }
            else
            {
                var nextNumber = await database.PickupCounters
                    .AsNoTracking()
                    .Where(counter => counter.BusinessDate == businessDate)
                    .Select(counter => counter.NextNumber)
                    .SingleAsync(cancellationToken);
                pickupNumber = nextNumber - 1;
            }

            if (!OrderTransitions.CanTransition(OrderStatus.PendingPayment, OrderStatus.Paid))
            {
                throw new InvalidOperationException("The order state transition is invalid.");
            }

            order.Status = PaidStatus;
            order.PickupBusinessDate = businessDate;
            order.PickupNumber = pickupNumber;
            attempt.Status = "Approved";
        }
        else if (attempt.Ledger.Outcome == "Declined")
        {
            if (!order.StockReleased)
            {
                var reservedLines = await database.OrderLines
                    .AsNoTracking()
                    .Where(line => line.OrderId == order.Id && line.FiniteStock)
                    .ToListAsync(cancellationToken);
                foreach (var line in reservedLines)
                {
                    var restored = await database.CatalogItems
                        .Where(item => item.Id == line.ItemId && item.Stock != null)
                        .ExecuteUpdateAsync(update => update.SetProperty(
                            item => item.Stock,
                            item => item.Stock + line.Quantity), cancellationToken);
                    if (restored != 1)
                    {
                        throw new InvalidOperationException("Reserved stock could not be restored.");
                    }
                }

                order.StockReleased = true;
            }

            if (!OrderTransitions.CanTransition(OrderStatus.PendingPayment, OrderStatus.PaymentFailed))
            {
                throw new InvalidOperationException("The order state transition is invalid.");
            }

            order.Status = FailedStatus;
            attempt.Status = "Declined";

            var declineWindowStart = updatedAt - DeclineWindowMilliseconds;
            var recentDeclines = await database.Orders
                .CountAsync(item => item.Id != order.Id && item.KioskId == _options.KioskId &&
                                    item.Status == FailedStatus && item.UpdatedAtUnixMs >= declineWindowStart, cancellationToken);
            if (recentDeclines + 1 >= DeclinesBeforeLockout)
            {
                var lockout = await database.PaymentDeclineLockouts
                    .SingleOrDefaultAsync(item => item.KioskId == _options.KioskId, cancellationToken);
                if (lockout is null)
                {
                    database.PaymentDeclineLockouts.Add(new PaymentDeclineLockoutEntity
                    {
                        KioskId = _options.KioskId,
                        LockedUntilUnixMs = updatedAt + PaymentLockoutMilliseconds
                    });
                }
                else
                {
                    lockout.LockedUntilUnixMs = updatedAt + PaymentLockoutMilliseconds;
                }
            }
        }
        else
        {
            throw new InvalidOperationException("The mock payment ledger contains an unsupported outcome.");
        }

        order.UpdatedAtUnixMs = updatedAt;
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static bool IsSqliteBusy(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is SqliteException sqliteException && sqliteException.SqliteErrorCode is 5 or 6)
            {
                return true;
            }
        }

        return false;
    }

    public async Task<OrderStatusSnapshot> LoadOrderStatusAsync(
        string idempotencyKey,
        string orderId,
        CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var order = await database.Orders
            .AsNoTracking()
            .Include(item => item.Lines)
            .SingleOrDefaultAsync(item => item.Id == orderId && item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (order is null)
        {
            throw new CheckoutException("ORDER_NOT_FOUND", "The order could not be found. Retry the same payment attempt to check safely.", CheckoutFailureKind.NotFound);
        }

        var message = order.Status switch
        {
            PaidStatus => "Payment confirmed. Your order is ready for pickup.",
            FailedStatus => "The simulated payment was declined. No payment was recorded. You can review and try again.",
            _ => "Payment is still being confirmed. Do not pay again. Keep this page open and check again."
        };

        return new OrderStatusSnapshot(
            order.PublicReference,
            order.Status,
            order.PickupNumber,
            DateTimeOffset.FromUnixTimeMilliseconds(order.UpdatedAtUnixMs),
            message,
            order.Lines.OrderBy(line => line.ItemName, StringComparer.Ordinal)
                .Select(line => new OrderLineSnapshot(
                    line.ItemId,
                    line.ItemName,
                    line.Quantity,
                    line.UnitPriceCents,
                    line.LineTotalCents))
                .ToArray(),
            order.TotalCents,
            order.TaxCents,
            "USD");
    }

    private static void ValidateIdempotencyKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length != 32 || !Guid.TryParseExact(key, "N", out _))
        {
            throw new CheckoutException("IDEMPOTENCY_KEY", "Refresh the checkout and try the payment again.", CheckoutFailureKind.InvalidRequest);
        }
    }
}
