using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SelfServiceCheckout.Data.Migrations
{
    /// <inheritdoc />
    public partial class PositiveCatalogPrices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddCheckConstraint(
                name: "CK_catalog_items_price_cents_positive",
                table: "catalog_items",
                sql: "PriceCents > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_catalog_items_price_cents_positive",
                table: "catalog_items");
        }
    }
}
