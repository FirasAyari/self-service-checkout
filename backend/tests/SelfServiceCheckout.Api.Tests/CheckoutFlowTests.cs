using System.Net;
using System.Text;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Encodings.Web;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Contracts;
using SelfServiceCheckout.Data;
using SelfServiceCheckout.Infrastructure.Sqlite.Services;
using Xunit;

namespace SelfServiceCheckout.Api.Tests;

public sealed partial class CheckoutApiTests
{
    [Fact(DisplayName = "AC-M6 AC-R6: menu add-ons are server-priced and included in the order receipt")]
    public async Task MenuOptions_AreServerPricedAndSnapshotToPaidOrder()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var menu = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        Assert.NotNull(menu);
        var coldBrew = menu!.Categories.SelectMany(category => category.Items)
            .Single(item => item.Id == "cold-brew");
        var sizeGroup = Assert.Single(coldBrew.OptionGroups, group => group.Id == "size");
        Assert.True(sizeGroup.IsRequired);

        using var invalidOptions = await CreateQuoteAsync(
            host.Client,
            new CartLineRequest("cold-brew", 1, ["oat-milk"]));
        Assert.Equal(HttpStatusCode.BadRequest, invalidOptions.StatusCode);
        Assert.Equal("ITEM_OPTIONS", await GetProblemCodeAsync(invalidOptions));

        var quote = await CreateQuoteValueAsync(
            host.Client,
            new CartLineRequest("cold-brew", 1, ["large", "oat-milk"]));
        Assert.Equal(600, quote.TotalCents);
        Assert.Equal(600, Assert.Single(quote.Lines).UnitPriceCents);
        Assert.Equal(new[] { "large", "oat-milk" }, Assert.Single(quote.Lines).OptionIds);
        Assert.Equal("Cold brew (Large, Oat milk)", Assert.Single(quote.Lines).Name);

        var order = await PlaceOrderAsync(host.Client, quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);
        Assert.Equal(HttpStatusCode.Created, order.Response.StatusCode);
        Assert.Equal("PAID", order.Order?.Status);
        Assert.Equal("Cold brew (Large, Oat milk)", Assert.Single(order.Order!.Lines).Name);
        Assert.Equal(600, order.Order.TotalCents);
    }

    [Fact]
    public async Task DevelopmentRoot_ServesBuiltReactClientFromWebDist()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        using var response = await host.Client.GetAsync("/");
        var html = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("<div id=\"app\"></div>", html, StringComparison.Ordinal);
        Assert.Contains("/assets/index-", html, StringComparison.Ordinal);
    }

    [Fact(DisplayName = "AC-D4: OpenAPI matches the committed contract snapshot")]
    public async Task OpenApiDocument_MatchesCommittedContractSnapshot()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);

        var actual = await host.Client.GetStringAsync("/openapi/v1.json");
        var document = JsonNode.Parse(actual)?.AsObject();
        Assert.NotNull(document);
        document.Remove("servers");
        var serializerOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };
        var snapshot = document.ToJsonString(serializerOptions)
            .Replace("\r\n", "\n", StringComparison.Ordinal) + "\n";
        var snapshotPath = Path.GetFullPath(Path.Combine(
            AppContext.BaseDirectory,
            "..", "..", "..", "Contracts", "openapi.v1.json"));

        if (Environment.GetEnvironmentVariable("UPDATE_OPENAPI_SNAPSHOT") == "1")
        {
            await File.WriteAllTextAsync(snapshotPath, snapshot);
            return;
        }

        var expected = JsonNode.Parse(await File.ReadAllTextAsync(snapshotPath));
        Assert.True(JsonNode.DeepEquals(expected, document), "The committed OpenAPI contract is out of date.");
    }

    [Fact]
    public async Task CreateQuote_ReturnsServerPricedSnapshotAndInclusiveTax()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        var response = await CreateQuoteAsync(host.Client, new CartLineRequest("turkey-melt", 2));

        Assert.Equal(200, (int)response.StatusCode);
        var quote = await response.Content.ReadFromJsonAsync<QuoteResponse>();
        Assert.NotNull(quote);
        Assert.Matches("^[0-9a-f]{64}$", quote.QuoteId);
        Assert.Equal("USD", quote.Currency);
        Assert.Equal(1_790, quote.TotalCents);
        Assert.Equal(133, quote.TaxCents);
        Assert.Collection(quote.Lines, line =>
        {
            Assert.Equal("turkey-melt", line.ItemId);
            Assert.Equal(2, line.Quantity);
            Assert.Equal(895, line.UnitPriceCents);
            Assert.Equal(1_790, line.LineTotalCents);
        });
    }

    [Fact(DisplayName = "AC-C7: server quote rejects orders above 150 dollars")]
    public async Task CreateQuote_RejectsClientBypassOfMaximumOrderTotal()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        await SetPriceAsync(host, "turkey-melt", 15_001);

        using var response = await CreateQuoteAsync(host.Client, new CartLineRequest("turkey-melt", 1));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("ORDER_LIMIT", await GetProblemCodeAsync(response));
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "SC-B2: API rejects line, unit, and distinct-line caps")]
    public async Task CreateQuote_RejectsLineAndUnitLimitBypass()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        using var lineLimit = await CreateQuoteAsync(host.Client, new CartLineRequest("turkey-melt", 11));
        Assert.Equal(HttpStatusCode.BadRequest, lineLimit.StatusCode);
        Assert.Equal("CART_LINE", await GetProblemCodeAsync(lineLimit));

        using var unitLimit = await CreateQuoteAsync(host.Client, Enumerable.Range(0, 11)
            .Select(index => new CartLineRequest($"unknown-{index}", 3)).ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, unitLimit.StatusCode);
        Assert.Equal("CART_UNITS", await GetProblemCodeAsync(unitLimit));

        using var distinctLineLimit = await CreateQuoteAsync(host.Client, Enumerable.Range(0, 16)
            .Select(index => new CartLineRequest($"unknown-{index}", 1)).ToArray());
        Assert.Equal(HttpStatusCode.BadRequest, distinctLineLimit.StatusCode);
        Assert.Equal("CART_SIZE", await GetProblemCodeAsync(distinctLineLimit));
        Assert.Equal(0, await CountOrdersAsync(host));
    }

    [Fact(DisplayName = "SC-B6 BR-X1: malformed, missing, unknown, and extra request fields fail without side effects")]
    public async Task RequestShape_RejectsMalformedAndUnknownCheckoutInput()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var invalidQuotes = new (string Body, HttpStatusCode Status, string? Code)[]
        {
            ("{}", HttpStatusCode.BadRequest, null),
            ("{\"items\":[{\"itemId\":\"turkey-melt\",\"quantity\":0}]}", HttpStatusCode.BadRequest, "CART_LINE"),
            ("{\"items\":[{\"itemId\":\"turkey-melt\"}]}", HttpStatusCode.BadRequest, null),
            ("{\"items\":[{\"itemId\":\"turkey-melt\",\"quantity\":1,\"priceCents\":1}]}", HttpStatusCode.BadRequest, null),
            ("{\"items\":[{\"itemId\":\"missing-menu-item\",\"quantity\":1}]}", HttpStatusCode.Conflict, "ITEM_UNAVAILABLE")
        };

        foreach (var (body, status, code) in invalidQuotes)
        {
            using var response = await host.Client.PostAsync("/api/quotes", new StringContent(body, Encoding.UTF8, "application/json"));
            Assert.Equal(status, response.StatusCode);
            if (code is not null) Assert.Equal(code, await GetProblemCodeAsync(response));
        }

        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var key = Guid.NewGuid().ToString("N");
        var missingScenario = JsonSerializer.Serialize(new { quoteId = quote.QuoteId, idempotencyKey = key });
        using (var response = await host.Client.PostAsync("/api/orders", new StringContent(missingScenario, Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        var extraOrderField = JsonSerializer.Serialize(new { quoteId = quote.QuoteId, idempotencyKey = key, scenario = "Approve", totalCents = 1 });
        using (var response = await host.Client.PostAsync("/api/orders", new StringContent(extraOrderField, Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        Assert.Equal(1, await CountQuotesAsync(host));
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "SC-B7: invented client prices are rejected and changed consent cannot be bypassed")]
    public async Task PlaceOrder_RejectsClientPriceFieldsAndChangedQuote()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var key = Guid.NewGuid().ToString("N");
        var inventedAmount = JsonSerializer.Serialize(new
        {
            quoteId = quote.QuoteId,
            idempotencyKey = key,
            scenario = "Approve",
            unitPriceCents = 1,
            totalCents = 1
        });

        using (var response = await host.Client.PostAsync("/api/orders", new StringContent(inventedAmount, Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        await SetPriceAsync(host, "turkey-melt", 900);
        var staleQuote = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Conflict, staleQuote.Response.StatusCode);
        Assert.Equal("PRICE_CHANGED", await GetProblemCodeAsync(staleQuote.Response));
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "AC-O1: first paid order returns Created with the paid receipt fields and no card data")]
    public async Task PlaceOrder_FirstPaidOrderReturnsCreatedAndPublicReceipt()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));

        var result = await PlaceOrderAsync(host.Client, quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);
        var responseBody = await result.Response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.Created, result.Response.StatusCode);
        Assert.NotNull(result.Order);
        Assert.Matches("^[A-F0-9]{32}$", result.Order.PublicReference);
        Assert.Equal("PAID", result.Order.Status);
        Assert.InRange(result.Order.PickupNumber ?? 0, 1, int.MaxValue);
        Assert.Equal(895, result.Order.TotalCents);
        Assert.Collection(result.Order.Lines, line =>
        {
            Assert.Equal("turkey-melt", line.ItemId);
            Assert.Equal("Turkey melt", line.Name);
            Assert.Equal(895, line.LineTotalCents);
        });
        Assert.DoesNotContain("pan", responseBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cvc", responseBody, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("last4", responseBody, StringComparison.OrdinalIgnoreCase);
    }

    [Fact(DisplayName = "AC-O2 AC-O7: paid replay returns the same order without another reservation")]
    public async Task PlaceOrder_ApprovalReservesStockAndIdempotentReplayDoesNotReserveAgain()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 2));
        const string key = "11111111111141118111111111111111";

        var first = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);
        var replay = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, first.Response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.Response.StatusCode);
        Assert.NotNull(first.Order);
        Assert.NotNull(replay.Order);
        Assert.Equal("PAID", first.Order.Status);
        Assert.InRange(first.Order.PickupNumber ?? 0, 1, int.MaxValue);
        Assert.Equal(first.Order.PublicReference, replay.Order.PublicReference);
        Assert.Equal(first.Order.PickupNumber, replay.Order.PickupNumber);
        Assert.Equal(first.Order.Status, replay.Order.Status);
        Assert.Equal(first.Order.TotalCents, replay.Order.TotalCents);
        Assert.Equal(first.Order.TaxCents, replay.Order.TaxCents);
        Assert.Equal(first.Order.Lines, replay.Order.Lines);
        Assert.Equal(10, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(1, await CountOrdersAsync(host));
        Assert.Equal(1, await CountLedgerEntriesAsync(host));
    }

    [Fact(DisplayName = "AC-O3 AC-O7: mismatch is rejected and decline restores reserved stock once")]
    public async Task PlaceOrder_DeclineRestoresStockExactlyOnce_AndKeyCannotBeReusedForAnotherRequest()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 2));
        const string key = "22222222222242228222222222222222";

        var declined = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Decline);
        var replay = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Decline);
        var mismatched = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.NotNull(declined.Order);
        Assert.Equal("PAYMENT_FAILED", declined.Order.Status);
        Assert.Equal("PAYMENT_FAILED", replay.Order?.Status);
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, mismatched.Response.StatusCode);
        Assert.Equal("IDEMPOTENCY_KEY_REUSED", await GetProblemCodeAsync(mismatched.Response));
        Assert.Equal(1, await CountOrdersAsync(host));
    }


    [Fact]
    public async Task PriceChangeRejectsOrderWithoutClaimingIdempotencyKeyOrReservingStock()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        const string key = "55555555555545558555555555555555";
        await SetPriceAsync(host, "turkey-melt", 896);

        var rejected = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Conflict, rejected.Response.StatusCode);
        Assert.Equal("PRICE_CHANGED", await GetProblemCodeAsync(rejected.Response));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(0, await CountOrdersAsync(host));

        await SetPriceAsync(host, "turkey-melt", 895);
        var retry = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, retry.Response.StatusCode);
        Assert.Equal("PAID", retry.Order?.Status);
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(1, await CountOrdersAsync(host));
    }

    [Fact]
    public async Task CreateQuote_RejectsUnavailableOrOverstockItems()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        var soldOut = await CreateQuoteAsync(host.Client, new CartLineRequest("tomato-panini", 1));
        var overstock = await CreateQuoteAsync(host.Client, new CartLineRequest("chicken-club", 3));

        Assert.Equal(HttpStatusCode.Conflict, soldOut.StatusCode);
        Assert.Equal("STOCK_CHANGED", await GetProblemCodeAsync(soldOut));
        Assert.Equal(HttpStatusCode.Conflict, overstock.StatusCode);
        Assert.Equal("STOCK_CHANGED", await GetProblemCodeAsync(overstock));
    }

    [Fact(DisplayName = "SC-C2: stock sold between quote and submit is rejected without payment and can recover")]
    public async Task PlaceOrder_RejectsNewStockShortfallWithoutSideEffectsAndCanRetry()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var key = Guid.NewGuid().ToString("N");
        await SetStockAsync(host, "turkey-melt", 0);

        var rejected = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Conflict, rejected.Response.StatusCode);
        Assert.Equal("STOCK_CHANGED", await GetProblemCodeAsync(rejected.Response));
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
        Assert.Equal(0, await GetStockAsync(host, "turkey-melt"));

        await SetStockAsync(host, "turkey-melt", 12);
        var recovered = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, recovered.Response.StatusCode);
        Assert.Equal("PAID", recovered.Order?.Status);
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "SC-C4: an item deactivated after quote cannot be ordered")]
    public async Task PlaceOrder_RejectsItemDeactivatedAfterQuote()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        await SetActiveAsync(host, "turkey-melt", false);

        var rejected = await PlaceOrderAsync(host.Client, quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Conflict, rejected.Response.StatusCode);
        Assert.Equal("ITEM_CHANGED", await GetProblemCodeAsync(rejected.Response));
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "SC-E4: SQLite writer contention returns a retryable error without partial reservation")]
    public async Task PlaceOrder_ReturnsRetryableErrorWhenSqliteIsBusy()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        await using var blocker = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = database.DatabasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Shared,
            Pooling = false
        }.ToString());
        await blocker.OpenAsync();
        await using var lockCommand = blocker.CreateCommand();
        lockCommand.CommandText = "SELECT * FROM catalog_items;";
        await using var lockedCatalog = await lockCommand.ExecuteReaderAsync();
        Assert.True(await lockedCatalog.ReadAsync());

        using var rejected = await host.Client.PostAsJsonAsync("/api/orders", new PlaceOrderRequest(
            quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve), JsonOptions);

        Assert.True(rejected.StatusCode == HttpStatusCode.ServiceUnavailable,
            $"Expected a retryable database response but received {(int)rejected.StatusCode}: {await rejected.Content.ReadAsStringAsync()}");
        Assert.Equal("DATABASE_BUSY", await GetProblemCodeAsync(rejected));
        await lockedCatalog.DisposeAsync();
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "SC-E5: database write failure rolls back order and stock changes")]
    public async Task PlaceOrder_RollsBackWhenStockWriteFails()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
            await using var db = await factory.CreateDbContextAsync();
            await db.Database.ExecuteSqlRawAsync("CREATE TRIGGER fail_stock_reservation BEFORE UPDATE ON catalog_items BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;");
        }

        using var failed = await host.Client.PostAsJsonAsync("/api/orders", new PlaceOrderRequest(
            quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve), JsonOptions);
        var body = await JsonNode.ParseAsync(await failed.Content.ReadAsStreamAsync());

        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.Equal("UNEXPECTED_ERROR", body?["code"]?.GetValue<string>());
        Assert.False(string.IsNullOrWhiteSpace(body?["requestId"]?.GetValue<string>()));
        Assert.Equal(0, await CountOrdersAsync(host));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
        Assert.Equal(12, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "SC-G1: an idempotency replay after quote cleanup returns the stored order once")]
    public async Task PlaceOrder_ReplayAfterQuoteCleanupDoesNotChargeOrReserveAgain()
    {
        using var database = new TemporaryCheckoutDatabase();
        var now = new DateTimeOffset(2026, 1, 2, 12, 0, 0, TimeSpan.Zero);
        var clock = new FixedTimeProvider(now);
        using var host = database.StartHost(timeProvider: clock);
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        const string key = "66666666666646668666666666666666";
        var first = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        clock.SetUtcNow(now.AddDays(2));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var catalog = scope.ServiceProvider.GetRequiredService<CatalogService>();
            Assert.Equal(1, await catalog.CleanupExpiredQuotesAsync(CancellationToken.None));
        }
        Assert.Equal(0, await CountQuotesAsync(host));

        var replay = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, first.Response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, replay.Response.StatusCode);
        Assert.Equal(first.Order?.PublicReference, replay.Order?.PublicReference);
        Assert.Equal(1, await CountOrdersAsync(host));
        Assert.Equal(1, await CountLedgerEntriesAsync(host));
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
    }

}
