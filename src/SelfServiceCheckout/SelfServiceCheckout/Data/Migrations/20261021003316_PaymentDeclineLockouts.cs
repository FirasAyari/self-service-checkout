using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SelfServiceCheckout.Data.Migrations
{
    /// <inheritdoc />
    public partial class PaymentDeclineLockouts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "payment_decline_lockouts",
                columns: table => new
                {
                    KioskId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    LockedUntilUnixMs = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_decline_lockouts", x => x.KioskId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "payment_decline_lockouts");
        }
    }
}
