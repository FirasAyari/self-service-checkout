using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SelfServiceCheckout.Application;
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
    private const int MaximumDatabaseContentionRetries = 3;

    public DemoChaosConfiguration Configuration => chaosState.Configuration;

    public async Task RecordScenarioAsync(
        string attemptId,
        PaymentScenario scenario,
        DemoChaosConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (configuration.Mode == DemoChaosMode.Latency && configuration.LatencyMilliseconds > 0)
        {
            await Task.Delay(configuration.LatencyMilliseconds, cancellationToken);
        }

        if (scenario == PaymentScenario.StillUnknown)
        {
            return;
        }

        var outcome = scenario == PaymentScenario.Decline ? "Declined" : "Approved";
        for (var retry = 0; ; retry++)
        {
            try
            {
                await RecordOutcomeAsync(attemptId, outcome, cancellationToken);
                return;
            }
            catch (Exception exception) when (IsSqliteBusy(exception))
            {
                if (retry >= MaximumDatabaseContentionRetries)
                {
                    throw new CheckoutException(
                        "DATABASE_BUSY",
                        "The simulated result is still being recorded. Retry this same order.",
                        CheckoutFailureKind.Unavailable);
                }

                var backoff = TimeSpan.FromMilliseconds((25 * (1 << retry)) + Random.Shared.Next(0, 50));
                await Task.Delay(backoff, cancellationToken);
            }
            catch (DbUpdateException)
            {
                await using var verification = await databaseFactory.CreateDbContextAsync(cancellationToken);
                if (!await verification.PaymentLedger.AnyAsync(item => item.AttemptId == attemptId, cancellationToken))
                {
                    throw;
                }

                return;
            }
        }
    }

    private async Task RecordOutcomeAsync(string attemptId, string outcome, CancellationToken cancellationToken)
    {
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

        await database.SaveChangesAsync(cancellationToken);
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
