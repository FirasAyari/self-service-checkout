using Microsoft.EntityFrameworkCore;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Data;

namespace SelfServiceCheckout.Infrastructure.Sqlite.Services;

public sealed class SqliteCatalogStore(
    IDbContextFactory<CheckoutDbContext> databaseFactory) : ICatalogStore
{
    public async Task<IReadOnlyList<CatalogItemRecord>> GetActiveItemsAsync(
        IReadOnlyCollection<string>? itemIds,
        CancellationToken cancellationToken)
    {
        if (itemIds is { Count: 0 })
        {
            return Array.Empty<CatalogItemRecord>();
        }

        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var query = database.CatalogItems.AsNoTracking().Where(item => item.IsActive);
        if (itemIds is not null)
        {
            query = query.Where(item => itemIds.Contains(item.Id));
        }

        return await query
            .OrderBy(item => item.Category)
            .ThenBy(item => item.SortOrder)
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

    public async Task SaveQuoteAsync(QuoteRecord quote, CancellationToken cancellationToken)
    {
        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        database.Quotes.Add(new QuoteEntity
        {
            Id = quote.Id,
            CreatedAtUnixMs = quote.CreatedAtUnixMs,
            ExpiresAtUnixMs = quote.ExpiresAtUnixMs,
            TotalCents = quote.TotalCents,
            TaxCents = quote.TaxCents,
            LinesJson = quote.LinesJson
        });
        await database.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> DeleteExpiredQuotesAsync(
        long expiredBeforeUnixMs,
        int maximumCount,
        CancellationToken cancellationToken)
    {
        if (maximumCount < 1)
        {
            return 0;
        }

        await using var database = await databaseFactory.CreateDbContextAsync(cancellationToken);
        var expiredQuoteIds = await database.Quotes
            .AsNoTracking()
            .Where(quote => quote.ExpiresAtUnixMs < expiredBeforeUnixMs)
            .OrderBy(quote => quote.ExpiresAtUnixMs)
            .Select(quote => quote.Id)
            .Take(maximumCount)
            .ToArrayAsync(cancellationToken);

        return expiredQuoteIds.Length == 0
            ? 0
            : await database.Quotes
                .Where(quote => expiredQuoteIds.Contains(quote.Id))
                .ExecuteDeleteAsync(cancellationToken);
    }
}
