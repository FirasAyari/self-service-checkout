using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SelfServiceCheckout.Data.Migrations
{
    /// <inheritdoc />
    public partial class OrderKioskIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "KioskId",
                table: "orders",
                type: "TEXT",
                maxLength: 64,
                nullable: false,
                defaultValue: "kiosk-1");

            migrationBuilder.CreateIndex(
                name: "IX_orders_KioskId_Status_UpdatedAtUnixMs",
                table: "orders",
                columns: new[] { "KioskId", "Status", "UpdatedAtUnixMs" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_orders_KioskId_Status_UpdatedAtUnixMs",
                table: "orders");

            migrationBuilder.DropColumn(
                name: "KioskId",
                table: "orders");
        }
    }
}
