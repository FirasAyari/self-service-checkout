using SelfServiceCheckout.Application;

namespace SelfServiceCheckout.Api.HostedServices;

public sealed class PaymentReconciler(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    ILogger<PaymentReconciler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextQuoteCleanup = timeProvider.GetUtcNow();
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var checkout = scope.ServiceProvider.GetRequiredService<IPaymentReconciliationService>();
                var catalog = scope.ServiceProvider.GetRequiredService<IQuoteMaintenanceService>();
                await checkout.ReconcilePendingAsync(stoppingToken);

                if (timeProvider.GetUtcNow() >= nextQuoteCleanup)
                {
                    var removedQuotes = await catalog.CleanupExpiredQuotesAsync(stoppingToken);
                    if (removedQuotes > 0)
                    {
                        logger.LogInformation("Removed {QuoteCount} expired checkout quotes.", removedQuotes);
                    }

                    nextQuoteCleanup = timeProvider.GetUtcNow().AddMinutes(15);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Checkout maintenance failed. It will retry on the next interval.");
            }
        }
    }
}
