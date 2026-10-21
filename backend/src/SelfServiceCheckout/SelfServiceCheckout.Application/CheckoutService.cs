using System.Security.Cryptography;
using System.Text;

namespace SelfServiceCheckout.Application;

public sealed class CheckoutService(
    IOrderReservationStore reservationStore,
    IMockPaymentGateway paymentGateway,
    IPaymentOutcomeSettlement paymentSettlement,
    CheckoutOptions options,
    SimulatedPaymentPolicy paymentPolicy) : IOrderPlacementService
{
    public async Task<PlaceOrderResult> PlaceOrderAsync(
        PlaceOrderCommand command,
        CancellationToken cancellationToken)
    {
        if (!options.MockPaymentsEnabled)
        {
            throw new CheckoutException("MOCK_PAYMENT_DISABLED", "Simulated payment is disabled in this environment.", CheckoutFailureKind.Unavailable);
        }

        ValidateIdempotencyKey(command.IdempotencyKey);
        ValidateQuoteId(command.QuoteId);
        if (!Enum.IsDefined(command.Scenario))
        {
            throw new CheckoutException("PAYMENT_SCENARIO", "Choose one of the listed simulated payment outcomes.", CheckoutFailureKind.InvalidRequest);
        }

        var quoteId = command.QuoteId.ToLowerInvariant();
        var requestHash = ComputeRequestHash(quoteId, command.Scenario);
        var chaosConfiguration = paymentPolicy.IsDevelopment
            ? paymentGateway.Configuration
            : new DemoChaosConfiguration(null, null, 0);
        var effectiveScenario = paymentPolicy.IsDevelopment
            ? chaosConfiguration.ScenarioOverride ?? command.Scenario
            : PaymentScenario.Approve;
        var reservation = await reservationStore.ReserveAsync(new OrderReservationCommand(
            command.IdempotencyKey,
            quoteId,
            requestHash,
            options.KioskId), cancellationToken);

        if (reservation.IsReplay)
        {
            await paymentSettlement.SettleAttemptAsync(reservation.AttemptId, CancellationToken.None);
        }
        else
        {
            if (chaosConfiguration.Mode == DemoChaosMode.CrashAfterReservation)
            {
                throw new CheckoutException(
                    "SIMULATED_CRASH_AFTER_RESERVATION",
                    "The demo interrupted checkout after reserving stock and before recording a payment result. Check this same payment attempt; do not pay again.",
                    CheckoutFailureKind.Unavailable);
            }

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            await paymentGateway.RecordScenarioAsync(
                reservation.AttemptId,
                effectiveScenario,
                chaosConfiguration,
                timeout.Token);
            if (effectiveScenario is PaymentScenario.Approve or PaymentScenario.Decline)
            {
                await paymentSettlement.SettleAttemptAsync(reservation.AttemptId, CancellationToken.None);
            }

            if (chaosConfiguration.Mode == DemoChaosMode.DropResponse)
            {
                throw new CheckoutException(
                    "SIMULATED_RESPONSE_LOST",
                    "The checkout response was interrupted. Check this same payment attempt before trying again.",
                    CheckoutFailureKind.Unavailable);
            }
        }

        var order = await paymentSettlement.LoadOrderStatusAsync(
            command.IdempotencyKey,
            reservation.OrderId,
            cancellationToken);
        return new PlaceOrderResult(order, reservation.IsReplay);
    }

    private static string ComputeRequestHash(string quoteId, PaymentScenario scenario)
    {
        var canonical = $"{quoteId.ToLowerInvariant()}\n{scenario}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static void ValidateIdempotencyKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key) || key.Length != 32 || !Guid.TryParseExact(key, "N", out _))
        {
            throw new CheckoutException("IDEMPOTENCY_KEY", "Refresh the checkout and try the payment again.", CheckoutFailureKind.InvalidRequest);
        }
    }

    private static void ValidateQuoteId(string quoteId)
    {
        if (string.IsNullOrWhiteSpace(quoteId) || quoteId.Length != 64 || !quoteId.All(Uri.IsHexDigit))
        {
            throw new CheckoutException("QUOTE_ID", "Review your cart to create a fresh price quote.", CheckoutFailureKind.InvalidRequest);
        }
    }
}
