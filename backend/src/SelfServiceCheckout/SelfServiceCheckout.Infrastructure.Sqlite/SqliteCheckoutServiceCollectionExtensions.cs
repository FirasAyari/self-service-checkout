using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Data;
using SelfServiceCheckout.Infrastructure.Sqlite.Services;

namespace SelfServiceCheckout.Infrastructure.Sqlite;

public static class SqliteCheckoutServiceCollectionExtensions
{
    public static IServiceCollection AddSqliteCheckout(this IServiceCollection services, string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);

        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.GetFullPath(databasePath),
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            ForeignKeys = true,
            Pooling = true,
            DefaultTimeout = 5
        }.ToString();

        services.AddDbContextFactory<CheckoutDbContext>(options =>
            options.UseSqlite(connectionString, sqlite => sqlite.CommandTimeout(5)));
        services.AddScoped<ICatalogStore, SqliteCatalogStore>();
        services.AddScoped<CatalogService>();
        services.AddScoped<IMenuQueryService>(provider => provider.GetRequiredService<CatalogService>());
        services.AddScoped<IQuoteService>(provider => provider.GetRequiredService<CatalogService>());
        services.AddScoped<IQuoteMaintenanceService>(provider => provider.GetRequiredService<CatalogService>());
        services.AddScoped<IOrderReservationStore, SqliteOrderReservationStore>();
        services.AddScoped<CheckoutService>();
        services.AddScoped<IOrderPlacementService>(provider => provider.GetRequiredService<CheckoutService>());
        services.AddScoped<PaymentSettlementService>();
        services.AddScoped<IPaymentOutcomeSettlement>(provider => provider.GetRequiredService<PaymentSettlementService>());
        services.AddScoped<IOrderStatusService>(provider => provider.GetRequiredService<PaymentSettlementService>());
        services.AddScoped<IPaymentReconciliationService>(provider => provider.GetRequiredService<PaymentSettlementService>());
        services.AddSingleton<MockPaymentGateway>();
        services.AddSingleton<IMockPaymentGateway>(provider => provider.GetRequiredService<MockPaymentGateway>());
        services.AddScoped<IDemoAdministrationService, DemoAdministrationService>();
        services.AddHealthChecks()
            .AddCheck<CheckoutDatabaseHealthCheck>("checkout-database", tags: ["ready"]);

        return services;
    }

    public static async Task InitializeCheckoutDatabaseAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var databaseFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        await DatabaseInitializer.InitializeAsync(database, cancellationToken);
    }
}
