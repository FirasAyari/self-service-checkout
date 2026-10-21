using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Checkout.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SelfServiceCheckout.Contracts;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Application;

public sealed record PlaceOrderResult(OrderStatusResponse Order, bool IsReplay);

public sealed class CheckoutService(
    IDbContextFactory<CheckoutDbContext> databaseFactory,
    MockPaymentGateway paymentGateway,
    TimeProvider timeProvider,
    IOptions<CheckoutOptions> options)
{
    private const string PendingStatus = "PENDING_PAYMENT";
    private const string PaidStatus = "PAID";
    private const string FailedStatus = "PAYMENT_FAILED";
    private const int MaximumRequestBodyBytes = 16_384;
    private const long DeclineWindowMilliseconds = 10 * 60 * 1_000;
    private const long PaymentLockoutMilliseconds = 60 * 1_000;
    private const int DeclinesBeforeLockout = 5;
    private const int MaximumDatabaseContentionRetries = 3;
    private readonly CheckoutOptions _options = options.Value;
    private readonly TimeZoneInfo _businessTimeZone = TimeZoneInfo.FindSystemTimeZoneById(options.Value.BusinessTimeZone);

    public async Task<MenuResponse> GetMenuAsync(CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var items = await database.CatalogItems
            .AsNoTracking()
            .Where(item => item.IsActive)
            .OrderBy(item => item.Category)
            .ThenBy(item => item.SortOrder)
            .ToListAsync(cancellationToken);

        var versionSource = string.Join('\n', items.Select(item =>
            $"{item.Id}|{item.PriceCents}|{item.Stock?.ToString() ?? "unlimited"}|{item.IsActive}|{MenuOptionCatalog.VersionDescriptor(item.Id)}"));
        var version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(versionSource)))[..16];
        var categories = items
            .GroupBy(item => item.Category)
            .Select(group => new MenuCategoryDto(group.Key, group.Select(item => new MenuItemDto(
                item.Id,
                item.Category,
                item.Name,
                item.Description,
                item.PriceCents,
                item.Stock,
                item.Stock is null or > 0,
                MenuOptionCatalog.GetGroups(item.Id))).ToArray()))
            .ToArray();

        return new MenuResponse(version, categories);
    }

    public async Task<QuoteResponse> CreateQuoteAsync(QuoteRequest request, CancellationToken cancellationToken)
    {
        var cart = CartRules.Normalize(request.Items?.Select(line =>
            line is null ? null : new CartLine(line.ItemId, line.Quantity, line.OptionIds)).ToArray());
        if (!cart.IsValid)
        {
            throw new CheckoutException(cart.ErrorCode!, cart.Message!, StatusCodes.Status400BadRequest);
        }

        var itemIds = cart.Lines.Select(line => line.ItemId).ToArray();
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var catalog = await database.CatalogItems
            .AsNoTracking()
            .Where(item => itemIds.Contains(item.Id) && item.IsActive)
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        var snapshots = new List<QuoteLineSnapshot>(cart.Lines.Count);
        long totalCents = 0;
        foreach (var line in cart.Lines)
        {
            if (!catalog.TryGetValue(line.ItemId, out var item))
            {
                throw new CheckoutException("ITEM_UNAVAILABLE", "A menu item is no longer available. Remove it and review your cart.", StatusCodes.Status409Conflict);
            }

            if (item.Stock is not null && item.Stock < line.Quantity)
            {
                throw new CheckoutException("STOCK_CHANGED", $"There are not enough {item.Name} portions left. Update your cart and review it again.", StatusCodes.Status409Conflict);
            }

            if (!MenuOptionCatalog.TryResolve(line.ItemId, line.OptionIds, out var selectedOptions))
            {
                throw new CheckoutException("ITEM_OPTIONS", "Choose valid options for this menu item and review your cart again.", StatusCodes.Status400BadRequest);
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
            throw new CheckoutException("ORDER_LIMIT", "The order total is above the $150.00 limit. Remove an item and try again.", StatusCodes.Status400BadRequest);
        }

        var now = timeProvider.GetUtcNow();
        var quoteId = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var expiresAt = now.AddSeconds(_options.QuoteLifetimeSeconds);
        var taxCents = InclusiveTax.Calculate(totalCents, _options.TaxRateBasisPoints);
        database.Quotes.Add(new QuoteEntity
        {
            Id = quoteId,
            CreatedAtUnixMs = now.ToUnixTimeMilliseconds(),
            ExpiresAtUnixMs = expiresAt.ToUnixTimeMilliseconds(),
            TotalCents = totalCents,
            TaxCents = taxCents,
            LinesJson = JsonSerializer.Serialize(snapshots)
        });
        await database.SaveChangesAsync(cancellationToken);

        return ToQuoteResponse(quoteId, expiresAt, snapshots, totalCents, taxCents);
    }

    public async Task<PlaceOrderResult> PlaceOrderAsync(
        PlaceOrderRequest request,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await PlaceOrderCoreAsync(request, cancellationToken);
            }
            catch (Exception exception) when (IsSqliteBusy(exception))
            {
                if (attempt >= MaximumDatabaseContentionRetries)
                {
                    throw new CheckoutException(
                        "DATABASE_BUSY",
                        "The order could not be saved yet. Retry the same payment attempt.",
                        StatusCodes.Status503ServiceUnavailable);
                }

                var backoff = TimeSpan.FromMilliseconds((25 * (1 << attempt)) + Random.Shared.Next(0, 50));
                await Task.Delay(backoff, cancellationToken);
            }
        }
    }

    private async Task<PlaceOrderResult> PlaceOrderCoreAsync(
        PlaceOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (!_options.MockPaymentsEnabled)
        {
            throw new CheckoutException("MOCK_PAYMENT_DISABLED", "Simulated payment is disabled in this environment.", StatusCodes.Status503ServiceUnavailable);
        }

        ValidateIdempotencyKey(request.IdempotencyKey);
        ValidateQuoteId(request.QuoteId);
        var quoteId = request.QuoteId.ToLowerInvariant();
        if (!Enum.IsDefined(request.Scenario))
        {
            throw new CheckoutException("PAYMENT_SCENARIO", "Choose one of the listed simulated payment outcomes.", StatusCodes.Status400BadRequest);
        }

        var requestHash = ComputeRequestHash(quoteId, request.Scenario);
        var chaosConfiguration = paymentGateway.Configuration;
        var effectiveScenario = chaosConfiguration.ScenarioOverride ?? request.Scenario;
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
                    .SingleOrDefaultAsync(order => order.IdempotencyKey == request.IdempotencyKey, cancellationToken);

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
                    await EnsureKioskIsNotLockedAsync(database, now, cancellationToken);
                    var order = new OrderEntity
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        PublicReference = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)),
                        IdempotencyKey = request.IdempotencyKey,
                        RequestHash = requestHash,
                        QuoteId = quoteId,
                        KioskId = _options.KioskId,
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
                        throw new CheckoutException("QUOTE_NOT_FOUND", "Review your cart to create a fresh price quote.", StatusCodes.Status409Conflict);
                    }

                    if (quote.ExpiresAtUnixMs <= now)
                    {
                        throw new CheckoutException("QUOTE_EXPIRED", "Your price quote expired. Review the current total before paying.", StatusCodes.Status409Conflict);
                    }

                    var snapshots = JsonSerializer.Deserialize<QuoteLineSnapshot[]>(quote.LinesJson);
                    if (snapshots is null || snapshots.Length is 0 or > CartRules.MaxLines)
                    {
                        throw new CheckoutException("QUOTE_INVALID", "Review your cart to create a fresh price quote.", StatusCodes.Status409Conflict);
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
                            throw new CheckoutException("ITEM_CHANGED", "A menu item is no longer available. Update your cart and review it again.", StatusCodes.Status409Conflict);
                        }

                        if (!MenuOptionCatalog.TryResolve(line.ItemId, line.OptionIds, out var selectedOptions))
                        {
                            throw new CheckoutException("ITEM_OPTIONS", "Review your cart to choose valid menu options before paying.", StatusCodes.Status409Conflict);
                        }

                        var baseUnitPriceCents = line.BaseUnitPriceCents ?? line.UnitPriceCents;
                        var currentUnitPriceCents = checked(item.PriceCents + selectedOptions.Sum(option => option.AdditionalPriceCents));
                        if (item.PriceCents != baseUnitPriceCents || currentUnitPriceCents != line.UnitPriceCents)
                        {
                            throw new CheckoutException("PRICE_CHANGED", "A price changed. Review and accept the new total before paying.", StatusCodes.Status409Conflict);
                        }

                        if (item.Stock is not null && item.Stock < line.Quantity)
                        {
                            throw new CheckoutException("STOCK_CHANGED", $"There are not enough {item.Name} portions left. Update your cart and review it again.", StatusCodes.Status409Conflict);
                        }

                        currentTotalCents = checked(currentTotalCents + checked(line.UnitPriceCents * line.Quantity));
                    }

                    if (currentTotalCents != quote.TotalCents)
                    {
                        throw new CheckoutException("PRICE_CHANGED", "The total changed. Review and accept the new total before paying.", StatusCodes.Status409Conflict);
                    }

                    foreach (var line in snapshots)
                    {
                        var updated = await database.CatalogItems
                            .Where(item => item.Id == line.ItemId && item.IsActive &&
                                           item.PriceCents == (line.BaseUnitPriceCents ?? line.UnitPriceCents) &&
                                           (item.Stock == null || item.Stock >= line.Quantity))
                            .ExecuteUpdateAsync(update => update.SetProperty(
                                item => item.Stock,
                                item => item.Stock == null ? (int?)null : item.Stock - line.Quantity), cancellationToken);

                        if (updated != 1)
                        {
                            throw new CheckoutException("STOCK_CHANGED", "Stock changed while placing the order. Update your cart and review it again.", StatusCodes.Status409Conflict);
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
                var replay = await TryGetReplayAsync(request.IdempotencyKey, requestHash, cancellationToken);
                if (replay is null)
                {
                    throw new CheckoutException("DATABASE_BUSY", "The order could not be saved. Retry with the same payment attempt.", StatusCodes.Status503ServiceUnavailable);
                }

                (orderId, attemptId) = replay.Value;
                isReplay = true;
            }
        }

        if (isReplay)
        {
            await TrySettleAttemptAsync(attemptId, CancellationToken.None);
        }
        else
        {
            if (chaosConfiguration.Mode == DemoChaosMode.CrashAfterReservation)
            {
                throw new CheckoutException(
                    "SIMULATED_CRASH_AFTER_RESERVATION",
                    "The demo interrupted checkout after reserving stock and before recording a payment result. Check this same payment attempt; do not pay again.",
                    StatusCodes.Status503ServiceUnavailable);
            }

            // Once the reservation is committed, a browser disconnect must not cancel the provider call.
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            await paymentGateway.RecordScenarioAsync(attemptId, effectiveScenario, chaosConfiguration, timeout.Token);
            if (effectiveScenario is MockPaymentScenario.Approve or MockPaymentScenario.Decline)
            {
                await TrySettleAttemptAsync(attemptId, CancellationToken.None);
            }

            if (chaosConfiguration.Mode == DemoChaosMode.DropResponse)
            {
                throw new CheckoutException(
                    "SIMULATED_RESPONSE_LOST",
                    "The checkout response was interrupted. Check this same payment attempt before trying again.",
                    StatusCodes.Status503ServiceUnavailable);
            }
        }

        var placedOrder = await LoadOrderStatusAsync(request.IdempotencyKey, orderId, cancellationToken);
        return new PlaceOrderResult(placedOrder, isReplay);
    }

    public async Task<OrderStatusResponse> GetOrderStatusAsync(
        OrderStatusRequest request,
        CancellationToken cancellationToken)
    {
        ValidateIdempotencyKey(request.IdempotencyKey);
        string? attemptId;
        string? orderId;
        await using (var database = await databaseFactory.CreateDbContextAsync(cancellationToken))
        {
            var order = await database.Orders
                .AsNoTracking()
                .Where(item => item.IdempotencyKey == request.IdempotencyKey)
                .Select(item => new { item.Id, AttemptId = item.PaymentAttempt!.Id })
                .SingleOrDefaultAsync(cancellationToken);
            attemptId = order?.AttemptId;
            orderId = order?.Id;
        }

        if (attemptId is null || orderId is null)
        {
            throw new CheckoutException("ORDER_NOT_FOUND", "This payment attempt is not in the system yet. Retry the same attempt to check safely.", StatusCodes.Status404NotFound);
        }

        await TrySettleAttemptAsync(attemptId, CancellationToken.None);
        return await LoadOrderStatusAsync(request.IdempotencyKey, orderId, cancellationToken);
    }

    public async Task ReconcilePendingAsync(CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var pendingAttemptIds = await database.PaymentAttempts
            .AsNoTracking()
            .Where(attempt => attempt.Status == PendingStatus)
            .Select(attempt => attempt.Id)
            .ToListAsync(cancellationToken);

        foreach (var attemptId in pendingAttemptIds)
        {
            await TrySettleAttemptAsync(attemptId, cancellationToken);
        }
    }

    private async Task TrySettleAttemptAsync(string attemptId, CancellationToken cancellationToken)
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

    private async Task<OrderStatusResponse> LoadOrderStatusAsync(
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
            throw new CheckoutException("ORDER_NOT_FOUND", "The order could not be found. Retry the same payment attempt to check safely.", StatusCodes.Status404NotFound);
        }

        var message = order.Status switch
        {
            PaidStatus => "Payment confirmed. Your order is ready for pickup.",
            FailedStatus => "The simulated payment was declined. No payment was recorded. You can review and try again.",
            _ => "Payment is still being confirmed. Do not pay again. Keep this page open and check again."
        };

        return new OrderStatusResponse(
            order.PublicReference,
            order.Status,
            order.PickupNumber,
            DateTimeOffset.FromUnixTimeMilliseconds(order.UpdatedAtUnixMs),
            message,
            order.Lines.OrderBy(line => line.ItemName, StringComparer.Ordinal)
                .Select(line => new OrderLineStatusDto(
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
        CancellationToken cancellationToken)
    {
        var lockedUntil = await database.PaymentDeclineLockouts
            .AsNoTracking()
            .Where(item => item.KioskId == _options.KioskId)
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
            StatusCodes.Status429TooManyRequests,
            retryAfterSeconds);
    }

    private static QuoteResponse ToQuoteResponse(
        string quoteId,
        DateTimeOffset expiresAt,
        IReadOnlyList<QuoteLineSnapshot> lines,
        long totalCents,
        long taxCents) => new(
            quoteId,
            expiresAt,
            lines.Select(line => new QuoteLineDto(
                line.ItemId,
                line.Name,
                line.Quantity,
                line.UnitPriceCents,
                line.LineTotalCents,
                line.OptionIds ?? Array.Empty<string>())).ToArray(),
            totalCents,
            taxCents,
            "USD");

    private static void EnsureSameRequest(OrderEntity order, string requestHash)
    {
        if (!CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(order.RequestHash),
                Convert.FromHexString(requestHash)))
        {
            throw new CheckoutException("IDEMPOTENCY_KEY_REUSED", "This payment attempt was already used for a different order. Review your cart to start a new attempt.", StatusCodes.Status422UnprocessableEntity);
        }
    }

    private static string ComputeRequestHash(string quoteId, MockPaymentScenario scenario)
    {
        var canonical = $"{quoteId.ToLowerInvariant()}\n{scenario}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static void ValidateIdempotencyKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length != 32 || !Guid.TryParseExact(key, "N", out _))
        {
            throw new CheckoutException("IDEMPOTENCY_KEY", "Refresh the checkout and try the payment again.", StatusCodes.Status400BadRequest);
        }
    }

    private static void ValidateQuoteId(string quoteId)
    {
        if (string.IsNullOrWhiteSpace(quoteId) || quoteId.Length != 64 || !quoteId.All(Uri.IsHexDigit))
        {
            throw new CheckoutException("QUOTE_ID", "Review your cart to create a fresh price quote.", StatusCodes.Status400BadRequest);
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
