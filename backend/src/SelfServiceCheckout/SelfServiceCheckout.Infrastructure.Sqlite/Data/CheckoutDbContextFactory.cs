using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace SelfServiceCheckout.Data;

/// <summary>Creates a provider-configured context without starting the HTTP host during migrations.</summary>
public sealed class CheckoutDbContextFactory : IDesignTimeDbContextFactory<CheckoutDbContext>
{
    public CheckoutDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<CheckoutDbContext>()
            .UseSqlite("Data Source=:memory:")
            .Options;
        return new CheckoutDbContext(options);
    }
}
