using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SelfServiceCheckout.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "catalog_items",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Category = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Description = table.Column<string>(type: "TEXT", maxLength: 300, nullable: false),
                    PriceCents = table.Column<long>(type: "INTEGER", nullable: false),
                    Stock = table.Column<int>(type: "INTEGER", nullable: true),
                    IsActive = table.Column<bool>(type: "INTEGER", nullable: false),
                    SortOrder = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_catalog_items", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "orders",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    PublicReference = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    RequestHash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    QuoteId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    TotalCents = table.Column<long>(type: "INTEGER", nullable: false),
                    TaxCents = table.Column<long>(type: "INTEGER", nullable: false),
                    PickupBusinessDate = table.Column<string>(type: "TEXT", nullable: true),
                    PickupNumber = table.Column<int>(type: "INTEGER", nullable: true),
                    StockReleased = table.Column<bool>(type: "INTEGER", nullable: false),
                    CreatedAtUnixMs = table.Column<long>(type: "INTEGER", nullable: false),
                    UpdatedAtUnixMs = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_orders", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "pickup_counters",
                columns: table => new
                {
                    BusinessDate = table.Column<string>(type: "TEXT", maxLength: 10, nullable: false),
                    NextNumber = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pickup_counters", x => x.BusinessDate);
                });

            migrationBuilder.CreateTable(
                name: "quotes",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    CreatedAtUnixMs = table.Column<long>(type: "INTEGER", nullable: false),
                    ExpiresAtUnixMs = table.Column<long>(type: "INTEGER", nullable: false),
                    TotalCents = table.Column<long>(type: "INTEGER", nullable: false),
                    TaxCents = table.Column<long>(type: "INTEGER", nullable: false),
                    LinesJson = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_quotes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "order_lines",
                columns: table => new
                {
                    OrderId = table.Column<string>(type: "TEXT", nullable: false),
                    ItemId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    ItemName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Quantity = table.Column<int>(type: "INTEGER", nullable: false),
                    UnitPriceCents = table.Column<long>(type: "INTEGER", nullable: false),
                    LineTotalCents = table.Column<long>(type: "INTEGER", nullable: false),
                    FiniteStock = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_order_lines", x => new { x.OrderId, x.ItemId });
                    table.ForeignKey(
                        name: "FK_order_lines_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "payment_attempts",
                columns: table => new
                {
                    Id = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    OrderId = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    CreatedAtUnixMs = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_attempts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_payment_attempts_orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "payment_ledger",
                columns: table => new
                {
                    AttemptId = table.Column<string>(type: "TEXT", nullable: false),
                    Outcome = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    TransactionReference = table.Column<string>(type: "TEXT", maxLength: 32, nullable: false),
                    RecordedAtUnixMs = table.Column<long>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_payment_ledger", x => x.AttemptId);
                    table.ForeignKey(
                        name: "FK_payment_ledger_payment_attempts_AttemptId",
                        column: x => x.AttemptId,
                        principalTable: "payment_attempts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_catalog_items_Category_SortOrder",
                table: "catalog_items",
                columns: new[] { "Category", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_orders_IdempotencyKey",
                table: "orders",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_orders_PickupBusinessDate_PickupNumber",
                table: "orders",
                columns: new[] { "PickupBusinessDate", "PickupNumber" },
                unique: true,
                filter: "PickupNumber IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_orders_PublicReference",
                table: "orders",
                column: "PublicReference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_orders_Status_UpdatedAtUnixMs",
                table: "orders",
                columns: new[] { "Status", "UpdatedAtUnixMs" });

            migrationBuilder.CreateIndex(
                name: "IX_payment_attempts_OrderId",
                table: "payment_attempts",
                column: "OrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_quotes_ExpiresAtUnixMs",
                table: "quotes",
                column: "ExpiresAtUnixMs");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "catalog_items");

            migrationBuilder.DropTable(
                name: "order_lines");

            migrationBuilder.DropTable(
                name: "payment_ledger");

            migrationBuilder.DropTable(
                name: "pickup_counters");

            migrationBuilder.DropTable(
                name: "quotes");

            migrationBuilder.DropTable(
                name: "payment_attempts");

            migrationBuilder.DropTable(
                name: "orders");
        }
    }
}
