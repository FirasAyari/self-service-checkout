using Microsoft.EntityFrameworkCore;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite.Services;

public sealed class DemoAdministrationService(
    IDbContextFactory<CheckoutDbContext> databaseFactory) : IDemoAdministrationService
{
    public async Task<bool> UpdateCatalogItemAsync(
        string itemId,
        long? priceCents,
        int? stock,
        bool? isActive,
        bool clearStock,
        CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var item = await database.CatalogItems.SingleOrDefaultAsync(row => row.Id == itemId, cancellationToken);
        if (item is null)
        {
            return false;
        }

        if (priceCents is long price) item.PriceCents = price;
        if (stock is int quantity) item.Stock = quantity;
        if (clearStock) item.Stock = null;
        if (isActive is bool active) item.IsActive = active;
        await database.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task ResetAsync(CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        await DatabaseInitializer.ResetDemoDataAsync(database, cancellationToken);
    }
}
