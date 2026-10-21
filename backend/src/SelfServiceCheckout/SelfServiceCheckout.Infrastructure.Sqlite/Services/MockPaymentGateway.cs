using Microsoft.EntityFrameworkCore;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Contracts;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite.Services;

/// <summary>
/// A deterministic demo provider. It accepts no card data and records outcomes in its own
/// database transaction so the reconciler can recover after an API restart.
/// </summary>
public sealed class MockPaymentGateway(
    IDbContextFactory<CheckoutDbContext> databaseFactory,
    TimeProvider timeProvider,
    DemoChaosState chaosState) : IMockPaymentGateway
{
    public DemoChaosConfiguration Configuration => chaosState.Configuration;

    public async Task RecordScenarioAsync(
        string attemptId,
        MockPaymentScenario scenario,
        DemoChaosConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (configuration.Mode == DemoChaosMode.Latency && configuration.LatencyMilliseconds > 0)
        {
            await Task.Delay(configuration.LatencyMilliseconds, cancellationToken);
        }

        if (scenario == MockPaymentScenario.StillUnknown)
        {
            return;
        }

        var outcome = scenario == MockPaymentScenario.Decline ? "Declined" : "Approved";
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        if (await database.PaymentLedger.AnyAsync(item => item.AttemptId == attemptId, cancellationToken))
        {
            return;
        }

        database.PaymentLedger.Add(new PaymentLedgerEntity
        {
            AttemptId = attemptId,
            Outcome = outcome,
            TransactionReference = Guid.NewGuid().ToString("N"),
            RecordedAtUnixMs = timeProvider.GetUtcNow().ToUnixTimeMilliseconds()
        });

        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another idempotent invocation may have committed the same provider result.
            if (!await database.PaymentLedger.AnyAsync(item => item.AttemptId == attemptId, cancellationToken))
            {
                throw;
            }
        }
    }
}
