using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Checkout.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Contracts;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite.Services;

public sealed class SqliteOrderReservationStore(
    IDbContextFactory<CheckoutDbContext> databaseFactory,
    TimeProvider timeProvider) : IOrderReservationStore
{
    private const string PendingStatus = "PENDING_PAYMENT";
    private const int MaximumDatabaseContentionRetries = 3;

    public async Task<OrderReservation> ReserveAsync(OrderReservationCommand command, CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await ReserveCoreAsync(command, cancellationToken);
            }
            catch (Exception exception) when (IsSqliteBusy(exception))
            {
                if (attempt >= MaximumDatabaseContentionRetries)
                {
                    throw new CheckoutException("DATABASE_BUSY", "The order could not be saved yet. Retry the same payment attempt.", CheckoutFailureKind.Unavailable);
                }

                var backoff = TimeSpan.FromMilliseconds((25 * (1 << attempt)) + Random.Shared.Next(0, 50));
                await Task.Delay(backoff, cancellationToken);
            }
        }
    }

    private async Task<OrderReservation> ReserveCoreAsync(OrderReservationCommand command, CancellationToken cancellationToken)
    {
        var requestHash = command.RequestHash;
        var quoteId = command.QuoteId;
        string orderId;
        string attemptId;
        var isReplay = false;
        await using (var database = await databaseFactory.CreateDbContextAsync(cancellationToken))
        {
            try
            {
                await using var transaction = await database.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                var existing = await database.Orders
                    .Include(order => order.PaymentAttempt)
                    .SingleOrDefaultAsync(order => order.IdempotencyKey == command.IdempotencyKey, cancellationToken);

                if (existing is not null)
                {
                    EnsureSameRequest(existing, requestHash);
                    orderId = existing.Id;
                    attemptId = existing.PaymentAttempt!.Id;
                    isReplay = true;
                }
                else
                {
                    var now = timeProvider.GetUtcNow().ToUnixTimeMilliseconds();
                    await EnsureKioskIsNotLockedAsync(database, now, command.KioskId, cancellationToken);
                    var order = new OrderEntity
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        PublicReference = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)),
                        IdempotencyKey = command.IdempotencyKey,
                        RequestHash = requestHash,
                        QuoteId = quoteId,
                        KioskId = command.KioskId,
                        Status = PendingStatus,
                        CreatedAtUnixMs = now,
                        UpdatedAtUnixMs = now
                    };
                    var attempt = new PaymentAttemptEntity
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        OrderId = order.Id,
                        Status = PendingStatus,
                        CreatedAtUnixMs = now,
                        Order = order
                    };
                    order.PaymentAttempt = attempt;

                    // This write claims the key inside the same transaction as reservation.
                    // A validation failure or process crash rolls the claim and order back together.
                    database.Orders.Add(order);
                    await database.SaveChangesAsync(cancellationToken);

                    var quote = await database.Quotes
                        .AsNoTracking()
                        .SingleOrDefaultAsync(item => item.Id == quoteId, cancellationToken);
                    if (quote is null)
                    {
                        throw new CheckoutException("QUOTE_NOT_FOUND", "Review your cart to create a fresh price quote.", CheckoutFailureKind.Conflict);
                    }

                    if (quote.ExpiresAtUnixMs <= now)
                    {
                        throw new CheckoutException("QUOTE_EXPIRED", "Your price quote expired. Review the current total before paying.", CheckoutFailureKind.Conflict);
                    }

                    var snapshots = JsonSerializer.Deserialize<QuoteLineSnapshot[]>(quote.LinesJson);
                    if (snapshots is null || snapshots.Length is 0 or > CartRules.MaxLines)
                    {
                        throw new CheckoutException("QUOTE_INVALID", "Review your cart to create a fresh price quote.", CheckoutFailureKind.Conflict);
                    }

                    var itemIds = snapshots.Select(line => line.ItemId).ToArray();
                    var currentItems = await database.CatalogItems
                        .Where(item => itemIds.Contains(item.Id))
                        .ToDictionaryAsync(item => item.Id, cancellationToken);

                    long currentTotalCents = 0;
                    foreach (var line in snapshots)
                    {
                        if (!currentItems.TryGetValue(line.ItemId, out var item) || !item.IsActive)
                        {
                            throw new CheckoutException("ITEM_CHANGED", "A menu item is no longer available. Update your cart and review it again.", CheckoutFailureKind.Conflict);
                        }

                        if (!MenuOptionCatalog.TryResolve(line.ItemId, line.OptionIds, out var selectedOptions))
                        {
                            throw new CheckoutException("ITEM_OPTIONS", "Review your cart to choose valid menu options before paying.", CheckoutFailureKind.Conflict);
                        }

                        var baseUnitPriceCents = line.BaseUnitPriceCents ?? line.UnitPriceCents;
                        var currentUnitPriceCents = checked(item.PriceCents + selectedOptions.Sum(option => option.AdditionalPriceCents));
                        if (item.PriceCents != baseUnitPriceCents || currentUnitPriceCents != line.UnitPriceCents)
                        {
                            throw new CheckoutException("PRICE_CHANGED", "A price changed. Review and accept the new total before paying.", CheckoutFailureKind.Conflict);
                        }

                        if (item.Stock is not null && item.Stock < line.Quantity)
                        {
                            throw new CheckoutException("STOCK_CHANGED", $"There are not enough {item.Name} portions left. Update your cart and review it again.", CheckoutFailureKind.Conflict);
                        }

                        currentTotalCents = checked(currentTotalCents + checked(line.UnitPriceCents * line.Quantity));
                    }

                    if (currentTotalCents != quote.TotalCents)
                    {
                        throw new CheckoutException("PRICE_CHANGED", "The total changed. Review and accept the new total before paying.", CheckoutFailureKind.Conflict);
                    }

                    foreach (var line in snapshots)
                    {
                        var updated = await database.CatalogItems
                            .Where(item => item.Id == line.ItemId && item.IsActive &&
                                           item.PriceCents == (line.BaseUnitPriceCents ?? line.UnitPriceCents) &&
                                           (item.Stock == null || item.Stock >= line.Quantity))
                            .ExecuteUpdateAsync(update => update.SetProperty<int?>(
                                item => item.Stock,
                                item => item.Stock == null ? (int?)null : item.Stock - line.Quantity), cancellationToken);

                        if (updated != 1)
                        {
                            throw new CheckoutException("STOCK_CHANGED", "Stock changed while placing the order. Update your cart and review it again.", CheckoutFailureKind.Conflict);
                        }

                        database.OrderLines.Add(new OrderLineEntity
                        {
                            OrderId = order.Id,
                            ItemId = line.ItemId,
                            ItemName = line.Name,
                            Quantity = line.Quantity,
                            UnitPriceCents = line.UnitPriceCents,
                            LineTotalCents = line.LineTotalCents,
                            FiniteStock = currentItems[line.ItemId].Stock is not null
                        });
                    }

                    order.TotalCents = quote.TotalCents;
                    order.TaxCents = quote.TaxCents;
                    await database.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    orderId = order.Id;
                    attemptId = attempt.Id;
                }
            }
            catch (DbUpdateException exception) when (IsSqliteBusy(exception))
            {
                throw;
            }
            catch (DbUpdateException)
            {
                var replay = await TryGetReplayAsync(command.IdempotencyKey, requestHash, cancellationToken);
                if (replay is null)
                {
                    throw new CheckoutException("DATABASE_BUSY", "The order could not be saved. Retry with the same payment attempt.", CheckoutFailureKind.Unavailable);
                }

                (orderId, attemptId) = replay.Value;
                isReplay = true;
            }
        }

        return new OrderReservation(orderId, attemptId, isReplay);
    }

    private async Task<(string OrderId, string AttemptId)?> TryGetReplayAsync(
        string idempotencyKey,
        string requestHash,
        CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var order = await database.Orders
            .AsNoTracking()
            .Include(item => item.PaymentAttempt)
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (order is null)
        {
            return null;
        }

        EnsureSameRequest(order, requestHash);
        return (order.Id, order.PaymentAttempt!.Id);
    }

    private async Task EnsureKioskIsNotLockedAsync(
        CheckoutDbContext database,
        long nowUnixMs,
        string kioskId,
        CancellationToken cancellationToken)
    {
        var lockedUntil = await database.PaymentDeclineLockouts
            .AsNoTracking()
            .Where(item => item.KioskId == kioskId)
            .Select(item => (long?)item.LockedUntilUnixMs)
            .SingleOrDefaultAsync(cancellationToken);
        if (lockedUntil is null || lockedUntil.Value <= nowUnixMs)
        {
            return;
        }

        var retryAfterSeconds = Math.Max(1, (int)Math.Ceiling((lockedUntil.Value - nowUnixMs) / 1_000d));
        throw new CheckoutException(
            "PAYMENT_LOCKED",
            "Too many payment declines. Please wait briefly before trying another payment.",
            CheckoutFailureKind.RateLimited,
            retryAfterSeconds);
    }

    private static void EnsureSameRequest(OrderEntity order, string requestHash)
    {
        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(order.RequestHash),
                Convert.FromHexString(requestHash)))
        {
            throw new CheckoutException("IDEMPOTENCY_KEY_REUSED", "This payment attempt was already used for a different order. Review your cart to start a new attempt.", CheckoutFailureKind.Unprocessable);
        }
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
}
