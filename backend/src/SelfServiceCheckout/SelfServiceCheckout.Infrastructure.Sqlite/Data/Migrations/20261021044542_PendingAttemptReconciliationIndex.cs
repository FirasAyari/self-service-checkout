using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SelfServiceCheckout.Data.Migrations
{
    /// <inheritdoc />
    public partial class PendingAttemptReconciliationIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_Status_CreatedAtUnixMs",
                table: "payment_attempts",
                columns: new[] { "Status", "CreatedAtUnixMs" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_payment_attempts_Status_CreatedAtUnixMs",
                table: "payment_attempts");
        }
    }
}
