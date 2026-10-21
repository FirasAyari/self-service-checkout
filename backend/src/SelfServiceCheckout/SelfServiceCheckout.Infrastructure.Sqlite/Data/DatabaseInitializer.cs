using Microsoft.EntityFrameworkCore;

namespace SelfServiceCheckout.Data;

public static class DatabaseInitializer
{
    private static readonly (string Id, string Category, string Name, string Description, long PriceCents, int? Stock, int SortOrder)[] SeedItems =
    [
        ("turkey-melt", "Sandwiches", "Turkey melt", "Roasted turkey, cheddar, tomato, and toasted sourdough.", 895, 12, 1),
        ("garden-wrap", "Sandwiches", "Garden wrap", "Hummus, cucumber, greens, and pickled onion.", 765, 8, 2),
        ("chicken-club", "Sandwiches", "Chicken club", "Grilled chicken, crisp lettuce, and herb mayo.", 995, 2, 3),
        ("tomato-panini", "Sandwiches", "Tomato panini", "Mozzarella, basil, and roasted tomato.", 825, 0, 4),
        ("grain-bowl", "Bowls", "Green grain bowl", "Warm grains, avocado, greens, and lemon dressing.", 1095, 10, 1),
        ("chicken-bowl", "Bowls", "Chicken harvest bowl", "Grilled chicken, brown rice, and seasonal vegetables.", 1195, 7, 2),
        ("falafel-bowl", "Bowls", "Falafel bowl", "Crisp falafel, hummus, cucumber, and tahini.", 1045, 6, 3),
        ("soup-cup", "Bowls", "Soup of the day", "A warm cup made fresh each morning.", 575, 9, 4),
        ("sparkling-water", "Drinks", "Sparkling water", "Cold, lightly sparkling water.", 250, 20, 1),
        ("iced-tea", "Drinks", "House iced tea", "Unsweetened black tea with lemon.", 325, 16, 2),
        ("cold-brew", "Drinks", "Cold brew", "Slow-steeped coffee, served over ice.", 425, 12, 3),
        ("lemonade", "Drinks", "Fresh lemonade", "Bright lemon with just enough sweetness.", 375, 14, 4)
    ];

    public static async Task InitializeAsync(CheckoutDbContext database, CancellationToken cancellationToken)
    {
        await database.Database.ExecuteSqlRawAsync("PRAGMA journal_mode = WAL;", cancellationToken);
        await database.Database.MigrateAsync(cancellationToken);

        if (await database.CatalogItems.AnyAsync(cancellationToken))
        {
            return;
        }

        database.CatalogItems.AddRange(SeedItems.Select(item => new CatalogItemEntity
        {
            Id = item.Id,
            Category = item.Category,
            Name = item.Name,
            Description = item.Description,
            PriceCents = item.PriceCents,
            Stock = item.Stock,
            IsActive = true,
            SortOrder = item.SortOrder
        }));

        await database.SaveChangesAsync(cancellationToken);
    }

    public static async Task ResetDemoDataAsync(CheckoutDbContext database, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        await database.Orders.ExecuteDeleteAsync(cancellationToken);
        await database.Quotes.ExecuteDeleteAsync(cancellationToken);
        await database.PickupCounters.ExecuteDeleteAsync(cancellationToken);
        await database.PaymentDeclineLockouts.ExecuteDeleteAsync(cancellationToken);

        var seedIds = SeedItems.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        await database.CatalogItems
            .Where(item => !seedIds.Contains(item.Id))
            .ExecuteDeleteAsync(cancellationToken);

        foreach (var seed in SeedItems)
        {
            var item = await database.CatalogItems.SingleOrDefaultAsync(row => row.Id == seed.Id, cancellationToken);
            if (item is null)
            {
                database.CatalogItems.Add(new CatalogItemEntity
                {
                    Id = seed.Id,
                    Category = seed.Category,
                    Name = seed.Name,
                    Description = seed.Description,
                    PriceCents = seed.PriceCents,
                    Stock = seed.Stock,
                    IsActive = true,
                    SortOrder = seed.SortOrder
                });
                continue;
            }

            item.Category = seed.Category;
            item.Name = seed.Name;
            item.Description = seed.Description;
            item.PriceCents = seed.PriceCents;
            item.Stock = seed.Stock;
            item.IsActive = true;
            item.SortOrder = seed.SortOrder;
        }

        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
