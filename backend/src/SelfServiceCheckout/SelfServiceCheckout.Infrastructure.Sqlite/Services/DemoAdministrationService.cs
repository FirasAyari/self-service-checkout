using Microsoft.EntityFrameworkCore;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite.Services;

public sealed class DemoAdministrationService(
    IDbContextFactory<CheckoutDbContext> databaseFactory) : IDemoAdministrationService
{
    public async Task<IReadOnlyList<CatalogItemRecord>> GetCatalogItemsAsync(CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        return await database.CatalogItems
            .AsNoTracking()
            .OrderBy(item => item.Category)
            .ThenBy(item => item.SortOrder)
            .ThenBy(item => item.Id)
            .Select(item => new CatalogItemRecord(
                item.Id,
                item.Category,
                item.Name,
                item.Description,
                item.PriceCents,
                item.Stock,
                item.IsActive,
                item.SortOrder))
            .ToListAsync(cancellationToken);
    }

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
