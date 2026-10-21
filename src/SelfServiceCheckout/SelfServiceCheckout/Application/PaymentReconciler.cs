namespace SelfServiceCheckout.Application;

public sealed class PaymentReconciler(
    IServiceScopeFactory scopeFactory,
    ILogger<PaymentReconciler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var checkout = scope.ServiceProvider.GetRequiredService<CheckoutService>();
                await checkout.ReconcilePendingAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception)
            {
                logger.LogError("Payment reconciliation failed. It will retry on the next interval.");
            }
        }
    }
}
