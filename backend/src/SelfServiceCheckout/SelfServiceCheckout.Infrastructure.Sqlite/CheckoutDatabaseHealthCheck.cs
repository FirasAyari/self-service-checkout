using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite;

public sealed class CheckoutDatabaseHealthCheck(
    IDbContextFactory<CheckoutDbContext> databaseFactory) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
            _ = await database.CatalogItems.AsNoTracking().AnyAsync(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            return HealthCheckResult.Unhealthy("Checkout data store is unavailable.");
        }
    }
}
