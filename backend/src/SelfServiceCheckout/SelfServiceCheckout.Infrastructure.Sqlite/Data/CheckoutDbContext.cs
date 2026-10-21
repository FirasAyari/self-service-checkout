using Microsoft.EntityFrameworkCore;

namespace SelfServiceCheckout.Data;

public sealed class CheckoutDbContext(DbContextOptions<CheckoutDbContext> options) : DbContext(options)
{
    public DbSet<CatalogItemEntity> CatalogItems => Set<CatalogItemEntity>();
    public DbSet<QuoteEntity> Quotes => Set<QuoteEntity>();
    public DbSet<OrderEntity> Orders => Set<OrderEntity>();
    public DbSet<OrderLineEntity> OrderLines => Set<OrderLineEntity>();
    public DbSet<PaymentAttemptEntity> PaymentAttempts => Set<PaymentAttemptEntity>();
    public DbSet<PaymentLedgerEntity> PaymentLedger => Set<PaymentLedgerEntity>();
    public DbSet<PickupCounterEntity> PickupCounters => Set<PickupCounterEntity>();
    public DbSet<PaymentDeclineLockoutEntity> PaymentDeclineLockouts => Set<PaymentDeclineLockoutEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CatalogItemEntity>(entity =>
        {
            entity.ToTable("catalog_items", table => table.HasCheckConstraint(
                "CK_catalog_items_price_cents_positive",
                "PriceCents > 0"));
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Id).HasMaxLength(64);
            entity.Property(item => item.Category).HasMaxLength(64).IsRequired();
            entity.Property(item => item.Name).HasMaxLength(120).IsRequired();
            entity.Property(item => item.Description).HasMaxLength(300).IsRequired();
            entity.Property(item => item.PriceCents).IsRequired();
            entity.Property(item => item.IsActive).IsRequired();
            entity.HasIndex(item => new { item.Category, item.SortOrder });
        });

        modelBuilder.Entity<QuoteEntity>(entity =>
        {
            entity.ToTable("quotes");
            entity.HasKey(quote => quote.Id);
            entity.Property(quote => quote.Id).HasMaxLength(64);
            entity.Property(quote => quote.LinesJson).IsRequired();
            entity.HasIndex(quote => quote.ExpiresAtUnixMs);
        });

        modelBuilder.Entity<OrderEntity>(entity =>
        {
            entity.ToTable("orders");
            entity.HasKey(order => order.Id);
            entity.Property(order => order.Id).HasMaxLength(32);
            entity.Property(order => order.PublicReference).HasMaxLength(32).IsRequired();
            entity.Property(order => order.IdempotencyKey).HasMaxLength(32).IsRequired();
            entity.Property(order => order.RequestHash).HasMaxLength(64).IsRequired();
            entity.Property(order => order.QuoteId).HasMaxLength(64).IsRequired();
            entity.Property(order => order.KioskId).HasMaxLength(64).IsRequired();
            entity.Property(order => order.Status).HasMaxLength(32).IsRequired();
            entity.HasIndex(order => order.PublicReference).IsUnique();
            entity.HasIndex(order => order.IdempotencyKey).IsUnique();
            entity.HasIndex(order => new { order.Status, order.UpdatedAtUnixMs });
            entity.HasIndex(order => new { order.KioskId, order.Status, order.UpdatedAtUnixMs });
            entity.HasIndex(order => new { order.PickupBusinessDate, order.PickupNumber })
                .IsUnique()
                .HasFilter("PickupNumber IS NOT NULL");
            entity.HasMany(order => order.Lines)
                .WithOne()
                .HasForeignKey(line => line.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(order => order.PaymentAttempt)
                .WithOne(attempt => attempt.Order)
                .HasForeignKey<PaymentAttemptEntity>(attempt => attempt.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<OrderLineEntity>(entity =>
        {
            entity.ToTable("order_lines");
            entity.HasKey(line => new { line.OrderId, line.ItemId });
            entity.Property(line => line.ItemId).HasMaxLength(64);
            entity.Property(line => line.ItemName).HasMaxLength(120).IsRequired();
        });

        modelBuilder.Entity<PaymentAttemptEntity>(entity =>
        {
            entity.ToTable("payment_attempts");
            entity.HasKey(attempt => attempt.Id);
            entity.Property(attempt => attempt.Id).HasMaxLength(32);
            entity.Property(attempt => attempt.Status).HasMaxLength(32).IsRequired();
            entity.HasIndex(attempt => attempt.OrderId).IsUnique();
            entity.HasIndex(attempt => new { attempt.Status, attempt.CreatedAtUnixMs });
            entity.HasOne(attempt => attempt.Ledger)
                .WithOne(ledger => ledger.Attempt)
                .HasForeignKey<PaymentLedgerEntity>(ledger => ledger.AttemptId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PaymentLedgerEntity>(entity =>
        {
            entity.ToTable("payment_ledger");
            entity.HasKey(ledger => ledger.AttemptId);
            entity.Property(ledger => ledger.TransactionReference).HasMaxLength(32).IsRequired();
            entity.Property(ledger => ledger.Outcome).HasMaxLength(16).IsRequired();
        });

        modelBuilder.Entity<PickupCounterEntity>(entity =>
        {
            entity.ToTable("pickup_counters");
            entity.HasKey(counter => counter.BusinessDate);
            entity.Property(counter => counter.BusinessDate).HasMaxLength(10);
        });

        modelBuilder.Entity<PaymentDeclineLockoutEntity>(entity =>
        {
            entity.ToTable("payment_decline_lockouts");
            entity.HasKey(lockout => lockout.KioskId);
            entity.Property(lockout => lockout.KioskId).HasMaxLength(64);
        });
    }
}
