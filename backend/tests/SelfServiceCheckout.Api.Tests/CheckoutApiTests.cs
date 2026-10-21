using System.Net;
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

public sealed class CheckoutApiTests
{
    [Fact(DisplayName = "AC-M1 BR-M1: menu has three categories, twelve positive-priced items, and sold-out availability")]
    public async Task GetMenu_ReturnsSeededItemsAndSoldOutAvailability()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        var menu = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");

        Assert.NotNull(menu);
        Assert.False(string.IsNullOrWhiteSpace(menu.Version));
        Assert.True(menu.Categories.Count >= 3);
        var items = menu.Categories.SelectMany(category => category.Items).ToDictionary(item => item.Id);
        Assert.Equal(12, items.Count);
        Assert.All(items.Values, item => Assert.True(item.PriceCents > 0));
        Assert.False(items["tomato-panini"].IsAvailable);
        Assert.Equal(0, items["tomato-panini"].Stock);
        Assert.True(items["turkey-melt"].IsAvailable);
        Assert.Equal(12, items["turkey-melt"].Stock);
    }

    [Fact(DisplayName = "EVAL-PROD-01: readiness checks the checkout database while liveness remains independent")]
    public async Task HealthEndpoints_ReadinessTracksDatabaseAndLivenessDoesNot()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        using var initialReady = await host.Client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, initialReady.StatusCode);
        Assert.Equal("ready", (await initialReady.Content.ReadFromJsonAsync<HealthEndpointResponse>())?.Status);

        await using (var scope = host.Services.CreateAsyncScope())
        {
            var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
            await using var db = await factory.CreateDbContextAsync();
            await db.Database.ExecuteSqlRawAsync("DROP TABLE catalog_items");
        }

        using var live = await host.Client.GetAsync("/health/live");
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal("live", (await live.Content.ReadFromJsonAsync<HealthEndpointResponse>())?.Status);

        using var ready = await host.Client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        Assert.Equal("not-ready", (await ready.Content.ReadFromJsonAsync<HealthEndpointResponse>())?.Status);
        using var legacyReady = await host.Client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, legacyReady.StatusCode);
        Assert.Equal("not-ready", (await legacyReady.Content.ReadFromJsonAsync<HealthEndpointResponse>())?.Status);
    }

    [Fact(DisplayName = "EVAL-PROD-04: only explicitly trusted proxies can set the client IP used for limits")]
    public async Task ForwardedClientAddress_IsAcceptedOnlyFromConfiguredProxy()
    {
        using var untrustedDatabase = new TemporaryCheckoutDatabase();
        using var untrustedHost = untrustedDatabase.StartHost();

        for (var index = 1; index <= 11; index++)
        {
            using var response = await SubmitInvalidOrderWithForwardedAddressAsync(untrustedHost.Client, $"192.0.2.{index}");
            Assert.Equal(index == 11 ? HttpStatusCode.TooManyRequests : HttpStatusCode.BadRequest, response.StatusCode);
        }

        using var trustedDatabase = new TemporaryCheckoutDatabase();
        using var trustedHost = trustedDatabase.StartHost(additionalEnvironment: new Dictionary<string, string?>
        {
            ["ReverseProxy__KnownProxies__0"] = "127.0.0.1"
        });

        for (var index = 1; index <= 11; index++)
        {
            using var response = await SubmitInvalidOrderWithForwardedAddressAsync(trustedHost.Client, $"198.51.100.{index}");
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }

    [Fact(DisplayName = "EVAL-PROD-03: business time zone configuration is checked against the host")]
    public void CheckoutOptions_RejectsInvalidBusinessTimeZone()
    {
        Assert.True(CheckoutOptions.IsValidBusinessTimeZone("America/Sao_Paulo"));
        Assert.True(CheckoutOptions.IsValidBusinessTimeZone("UTC"));
        Assert.False(CheckoutOptions.IsValidBusinessTimeZone(""));
        Assert.False(CheckoutOptions.IsValidBusinessTimeZone("Invalid/Not_A_Zone"));
    }

    [Fact(DisplayName = "EVAL-PROD-03: unsupported business time zone prevents API startup")]
    public void Startup_RejectsUnsupportedBusinessTimeZone()
    {
        using var database = new TemporaryCheckoutDatabase();

        var exception = Assert.ThrowsAny<OptionsValidationException>(() => database.StartHost(
            additionalEnvironment: new Dictionary<string, string?>
            {
                ["Checkout__BusinessTimeZone"] = "Invalid/Not_A_Zone"
            }));

        Assert.Contains("BusinessTimeZone", exception.Message, StringComparison.Ordinal);
    }

    [Fact(DisplayName = "EVAL-PROD-03: pickup date follows the configured store time zone")]
    public async Task PickupNumber_UsesConfiguredBusinessTimeZone()
    {
        using var database = new TemporaryCheckoutDatabase();
        var fixedTime = new FixedTimeProvider(new DateTimeOffset(2026, 1, 2, 1, 0, 0, TimeSpan.Zero));
        using var host = database.StartHost(
            additionalEnvironment: new Dictionary<string, string?>
            {
                ["Checkout__BusinessTimeZone"] = "America/Sao_Paulo"
            },
            timeProvider: fixedTime);
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));

        var result = await PlaceOrderAsync(host.Client, quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, result.Response.StatusCode);
        Assert.Equal(1, result.Order?.PickupNumber);
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var db = await factory.CreateDbContextAsync();
        Assert.Equal("2026-01-01", (await db.PickupCounters.SingleAsync()).BusinessDate);
    }

    [Fact(DisplayName = "EVAL-PROD-02 AC-D5: production fixes the demo outcome and exposes no demo controls")]
    public async Task ProductionMode_KeepsPaymentSimulationAndHidesDemoAdministration()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(environmentName: "Production");

        var checkoutOptions = host.Services.GetRequiredService<IOptions<CheckoutOptions>>().Value;
        var demoOptions = host.Services.GetRequiredService<IOptions<DemoModeOptions>>().Value;
        using var menu = await host.Client.GetAsync("/api/menu");
        using var admin = await host.Client.PostAsync("/api/admin/reset", content: null);

        Assert.True(checkoutOptions.MockPaymentsEnabled);
        Assert.False(demoOptions.Enabled);
        Assert.Equal(HttpStatusCode.OK, menu.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, admin.StatusCode);

        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var order = await PlaceOrderAsync(
            host.Client,
            quote.QuoteId,
            Guid.NewGuid().ToString("N"),
            MockPaymentScenario.StillUnknown);

        Assert.Equal(HttpStatusCode.Created, order.Response.StatusCode);
        Assert.Equal("PAID", order.Order?.Status);
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "AC-D6: expired quote cleanup deletes only a bounded stale batch")]
    public async Task QuoteCleanup_RemovesBoundedExpiredBatchAndRetainsRecentQuotes()
    {
        using var database = new TemporaryCheckoutDatabase();
        var now = new DateTimeOffset(2026, 1, 2, 12, 0, 0, TimeSpan.Zero);
        using var host = database.StartHost(timeProvider: new FixedTimeProvider(now));
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var db = await factory.CreateDbContextAsync();
        var oldExpiry = now.AddDays(-2).ToUnixTimeMilliseconds();
        var recentExpiry = now.AddHours(-1).ToUnixTimeMilliseconds();
        db.Quotes.AddRange(Enumerable.Range(0, 501).Select(index => new QuoteEntity
        {
            Id = $"expired-{index:D3}",
            CreatedAtUnixMs = oldExpiry - 120_000,
            ExpiresAtUnixMs = oldExpiry,
            TotalCents = 500,
            TaxCents = 40,
            LinesJson = "[]"
        }));
        db.Quotes.Add(new QuoteEntity
        {
            Id = "recently-expired",
            CreatedAtUnixMs = recentExpiry - 120_000,
            ExpiresAtUnixMs = recentExpiry,
            TotalCents = 500,
            TaxCents = 40,
            LinesJson = "[]"
        });
        await db.SaveChangesAsync();

        var catalog = scope.ServiceProvider.GetRequiredService<CatalogService>();
        var deleted = await catalog.CleanupExpiredQuotesAsync(CancellationToken.None);

        Assert.Equal(500, deleted);
        Assert.Equal(1, await db.Quotes.CountAsync(quote => quote.Id.StartsWith("expired-")));
        Assert.True(await db.Quotes.AnyAsync(quote => quote.Id == "recently-expired"));
    }

    [Fact(DisplayName = "EVAL-PROD-07: API responses include kiosk security and privacy headers")]
    public async Task ApiResponses_UseSecurityHeadersAndPreventCaching()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        using var response = await host.Client.GetAsync("/api/menu");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        Assert.Equal("DENY", Assert.Single(response.Headers.GetValues("X-Frame-Options")));
        Assert.Equal("no-referrer", Assert.Single(response.Headers.GetValues("Referrer-Policy")));
        Assert.Equal("no-store", Assert.Single(response.Headers.GetValues("Cache-Control")));
        var contentSecurityPolicy = Assert.Single(response.Headers.GetValues("Content-Security-Policy"));
        Assert.Contains("frame-ancestors 'none'", contentSecurityPolicy, StringComparison.Ordinal);
        Assert.Contains("font-src 'self'", contentSecurityPolicy, StringComparison.Ordinal);
        Assert.Contains("img-src 'self'", contentSecurityPolicy, StringComparison.Ordinal);
        Assert.Contains("style-src 'self'", contentSecurityPolicy, StringComparison.Ordinal);
        Assert.DoesNotContain("'unsafe-inline'", contentSecurityPolicy, StringComparison.Ordinal);
        Assert.DoesNotContain("data:", contentSecurityPolicy, StringComparison.Ordinal);
    }

    private static async Task<HttpResponseMessage> SubmitInvalidOrderWithForwardedAddressAsync(HttpClient client, string forwardedAddress)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new { quoteId = "", idempotencyKey = "", scenario = "Approve" })
        };
        request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedAddress);
        return await client.SendAsync(request);
    }

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

    [Fact(DisplayName = "AC-O8: after 30 seconds, no ledger result remains pending and keeps reserved stock")]
    public async Task StillUnknown_KeepsOrderPendingAndStockReservedAfterStatusAndReconciliation()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        const string key = "33333333333343338333333333333333";

        var submitted = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.StillUnknown);
        await AgePendingOrderAsync(host, key, TimeSpan.FromSeconds(31));
        var status = await host.Client.PostAsJsonAsync("/api/orders/status", new OrderStatusRequest(key));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var checkout = scope.ServiceProvider.GetRequiredService<IPaymentReconciliationService>();
            await checkout.ReconcilePendingAsync(CancellationToken.None);
        }
        var reconciledStatus = await host.Client.PostAsJsonAsync("/api/orders/status", new OrderStatusRequest(key));
        var statusBody = await status.Content.ReadFromJsonAsync<OrderStatusResponse>();
        var reconciledBody = await reconciledStatus.Content.ReadFromJsonAsync<OrderStatusResponse>();

        Assert.Equal(HttpStatusCode.Accepted, submitted.Response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        Assert.Equal("PENDING_PAYMENT", statusBody?.Status);
        Assert.Equal("PENDING_PAYMENT", reconciledBody?.Status);
        Assert.Contains("Do not pay again", statusBody?.Message, StringComparison.Ordinal);
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "AC-O6 AC-O8: durable approval is reconciled after API restart")]
    public async Task UnknownAfterApproval_IsReconciledAfterApiRestartFromDurableLedger()
    {
        using var database = new TemporaryCheckoutDatabase();
        const string key = "44444444444444448444444444444444";
        string publicReference;

        using (var firstHost = database.StartHost())
        {
            var quote = await CreateQuoteValueAsync(firstHost.Client, new CartLineRequest("turkey-melt", 1));
            var pending = await PlaceOrderAsync(firstHost.Client, quote.QuoteId, key, MockPaymentScenario.UnknownAfterApproval);
            Assert.Equal(HttpStatusCode.Accepted, pending.Response.StatusCode);
            Assert.Equal("PENDING_PAYMENT", pending.Order?.Status);
            publicReference = pending.Order!.PublicReference;
            await AgePendingOrderAsync(firstHost, key, TimeSpan.FromSeconds(31));
            Assert.Equal(11, await GetStockAsync(firstHost, "turkey-melt"));
        }

        SqliteConnection.ClearAllPools();
        using var restartedHost = database.StartHost();
        await using (var scope = restartedHost.Services.CreateAsyncScope())
        {
            var checkout = scope.ServiceProvider.GetRequiredService<IPaymentReconciliationService>();
            await checkout.ReconcilePendingAsync(CancellationToken.None);
        }
        var status = await restartedHost.Client.PostAsJsonAsync("/api/orders/status", new OrderStatusRequest(key));
        var paid = await status.Content.ReadFromJsonAsync<OrderStatusResponse>();

        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        Assert.Equal("PAID", paid?.Status);
        Assert.Equal(publicReference, paid?.PublicReference);
        Assert.InRange(paid?.PickupNumber ?? 0, 1, int.MaxValue);
        Assert.Equal(11, await GetStockAsync(restartedHost, "turkey-melt"));
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

    [Fact(DisplayName = "AC-Y7: repeated declines lock payment temporarily with Retry-After")]
    public async Task FiveDeclinesPersistLockoutAcrossRestartAndReturnRetryAfter()
    {
        using var database = new TemporaryCheckoutDatabase();
        const string kioskId = "lockout-test-kiosk";

        using (var host = database.StartHost(kioskId: kioskId))
        {
            for (var index = 0; index < 5; index++)
            {
                var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
                var attempt = await PlaceOrderAsync(
                    host.Client,
                    quote.QuoteId,
                    Guid.NewGuid().ToString("N"),
                    MockPaymentScenario.Decline);

                Assert.Equal(HttpStatusCode.Created, attempt.Response.StatusCode);
                Assert.Equal("PAYMENT_FAILED", attempt.Order?.Status);
            }
        }

        SqliteConnection.ClearAllPools();
        using var restartedHost = database.StartHost(kioskId: kioskId);
        var quoteAfterRestart = await CreateQuoteValueAsync(restartedHost.Client, new CartLineRequest("turkey-melt", 1));
        var lockedAttempt = await PlaceOrderAsync(
            restartedHost.Client,
            quoteAfterRestart.QuoteId,
            Guid.NewGuid().ToString("N"),
            MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.TooManyRequests, lockedAttempt.Response.StatusCode);
        Assert.Equal("PAYMENT_LOCKED", await GetProblemCodeAsync(lockedAttempt.Response));
        Assert.True(lockedAttempt.Response.Headers.TryGetValues("Retry-After", out var retryAfterValues));
        Assert.True(int.TryParse(retryAfterValues!.Single(), out var retryAfterSeconds));
        Assert.InRange(retryAfterSeconds, 1, 60);
        Assert.Equal(12, await GetStockAsync(restartedHost, "turkey-melt"));
        Assert.Equal(5, await CountOrdersAsync(restartedHost));

        using var separateKioskHost = database.StartHost(kioskId: "another-kiosk");
        var separateKioskQuote = await CreateQuoteValueAsync(separateKioskHost.Client, new CartLineRequest("turkey-melt", 1));
        var separateKioskAttempt = await PlaceOrderAsync(
            separateKioskHost.Client,
            separateKioskQuote.QuoteId,
            Guid.NewGuid().ToString("N"),
            MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, separateKioskAttempt.Response.StatusCode);
        Assert.Equal("PAID", separateKioskAttempt.Order?.Status);
    }

    [Fact]
    public async Task AdminRoutes_AreNotMappedWhenDemoModeIsDisabled()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        var response = await host.Client.PostAsync("/api/admin/reset", content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AdminRoutes_HideMissingOrInvalidTokenAndAcceptConfiguredToken()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);
        const string path = "/api/admin/items/turkey-melt";

        using var missingTokenRequest = new HttpRequestMessage(HttpMethod.Patch, path)
        {
            Content = JsonContent.Create(new { priceCents = 900 })
        };
        using var missingTokenResponse = await host.Client.SendAsync(missingTokenRequest);

        using var invalidTokenRequest = new HttpRequestMessage(HttpMethod.Patch, path)
        {
            Content = JsonContent.Create(new { priceCents = 900 })
        };
        invalidTokenRequest.Headers.Add("X-Admin-Token", "incorrect-demo-token-value-that-is-long-enough");
        using var invalidTokenResponse = await host.Client.SendAsync(invalidTokenRequest);

        using var validTokenRequest = new HttpRequestMessage(HttpMethod.Patch, path)
        {
            Content = JsonContent.Create(new { priceCents = 900 })
        };
        validTokenRequest.Headers.Add("X-Admin-Token", TestAdminToken);
        using var validTokenResponse = await host.Client.SendAsync(validTokenRequest);

        Assert.Equal(HttpStatusCode.NotFound, missingTokenResponse.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, invalidTokenResponse.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, validTokenResponse.StatusCode);
        Assert.Equal(900, await GetPriceAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "AC-D3: demo latency and lost-response chaos remain recoverable")]
    public async Task DemoChaos_LatencyCompletesAndDroppedResponseRecoversWithSameKey()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);

        await SetChaosAsync(host.Client, new
        {
            scenarioOverride = "Approve",
            mode = "Latency",
            latencyMilliseconds = 80
        });
        var delayedQuote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var timer = System.Diagnostics.Stopwatch.StartNew();
        var delayed = await PlaceOrderAsync(host.Client, delayedQuote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);
        timer.Stop();

        Assert.Equal(HttpStatusCode.Created, delayed.Response.StatusCode);
        Assert.Equal("PAID", delayed.Order?.Status);
        Assert.True(timer.ElapsedMilliseconds >= 60, $"Expected the demo latency, observed {timer.ElapsedMilliseconds} ms.");

        await SetChaosAsync(host.Client, new
        {
            scenarioOverride = "Approve",
            mode = "DropResponse",
            latencyMilliseconds = 0
        });
        var droppedQuote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var idempotencyKey = Guid.NewGuid().ToString("N");
        var interrupted = await PlaceOrderAsync(host.Client, droppedQuote.QuoteId, idempotencyKey, MockPaymentScenario.Approve);
        using var recoveredResponse = await host.Client.PostAsJsonAsync("/api/orders/status", new OrderStatusRequest(idempotencyKey));
        var recovered = await recoveredResponse.Content.ReadFromJsonAsync<OrderStatusResponse>();

        Assert.Equal(HttpStatusCode.ServiceUnavailable, interrupted.Response.StatusCode);
        Assert.Equal("SIMULATED_RESPONSE_LOST", await GetProblemCodeAsync(interrupted.Response));
        Assert.Equal(HttpStatusCode.OK, recoveredResponse.StatusCode);
        Assert.Equal("PAID", recovered?.Status);
        Assert.Equal(2, await CountOrdersAsync(host));
        Assert.Equal(10, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(2, await CountLedgerEntriesAsync(host));
    }

    [Fact(DisplayName = "AC-D3 AC-O8 SC-D11: crash after reservation remains unknown and keeps stock reserved")]
    public async Task DemoChaos_CrashAfterReservationLeavesPendingOrderWithoutLedgerResult()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);
        await SetChaosAsync(host.Client, new
        {
            scenarioOverride = "Approve",
            mode = "CrashAfterReservation",
            latencyMilliseconds = 0
        });

        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var idempotencyKey = Guid.NewGuid().ToString("N");
        var interrupted = await PlaceOrderAsync(host.Client, quote.QuoteId, idempotencyKey, MockPaymentScenario.Approve);
        using var interruptedResponse = interrupted.Response;

        Assert.Equal(HttpStatusCode.ServiceUnavailable, interruptedResponse.StatusCode);
        Assert.Equal("SIMULATED_CRASH_AFTER_RESERVATION", await GetProblemCodeAsync(interruptedResponse));
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));

        using var replayResponse = await host.Client.PostAsJsonAsync(
            "/api/orders",
            new PlaceOrderRequest(quote.QuoteId, idempotencyKey, MockPaymentScenario.Approve),
            JsonOptions);
        var replay = await replayResponse.Content.ReadFromJsonAsync<PlaceOrderResponse>(JsonOptions);
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var checkout = scope.ServiceProvider.GetRequiredService<IPaymentReconciliationService>();
            await checkout.ReconcilePendingAsync(CancellationToken.None);
        }

        Assert.Equal(HttpStatusCode.Accepted, replayResponse.StatusCode);
        Assert.Equal("PENDING_PAYMENT", replay?.Order.Status);
        Assert.Equal(1, await CountOrdersAsync(host));
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(0, await CountLedgerEntriesAsync(host));
    }

    [Fact(DisplayName = "AC-G1 SC-G4: rejected sensitive input is absent from application logs")]
    public async Task RejectedSensitiveRequest_DoesNotWriteItsValueToLogs()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var logs = new CapturingLoggerProvider();
        using var host = database.StartHost(loggerProvider: logs);
        const string sensitiveValue = "4111111111111111";

        using var response = await host.Client.PostAsJsonAsync("/api/quotes", new
        {
            items = new[]
            {
                new { itemId = "turkey-melt", quantity = 1, pan = sensitiveValue }
            }
        });

        Assert.False(response.IsSuccessStatusCode);
        Assert.DoesNotContain(sensitiveValue, logs.Messages, StringComparison.Ordinal);
        Assert.DoesNotContain(sensitiveValue, await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AdminCatalogUpdate_RejectsZeroOrNegativePrice()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);

        foreach (var priceCents in new long[] { 0, -1 })
        {
            using var request = new HttpRequestMessage(HttpMethod.Patch, "/api/admin/items/turkey-melt")
            {
                Content = JsonContent.Create(new { priceCents })
            };
            request.Headers.Add("X-Admin-Token", TestAdminToken);
            using var response = await host.Client.SendAsync(request);

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(895, await GetPriceAsync(host, "turkey-melt"));
        }
    }

    [Fact(DisplayName = "AC-O4: concurrent paid orders receive contiguous pickups without overselling")]
    public async Task ConcurrentOrders_ReceiveUniqueContiguousPickupNumbersAndReserveExactStock()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        const int orderCount = 20;
        var quotes = new List<QuoteResponse>(orderCount);
        for (var index = 0; index < orderCount; index++)
        {
            quotes.Add(await CreateQuoteValueAsync(host.Client, new CartLineRequest("sparkling-water", 1)));
        }

        var results = await Task.WhenAll(quotes.Select((quote, index) => PlaceOrderAsync(
            host.Server,
            new IPAddress(new byte[] { 10, 30, (byte)(index / 250), (byte)(index % 250 + 1) }),
            quote.QuoteId,
            Guid.NewGuid().ToString("N"),
            MockPaymentScenario.Approve)));

        Assert.All(results, result =>
        {
            Assert.True(result.StatusCode == HttpStatusCode.Created, $"Expected Created, received {result.StatusCode}: {result.ErrorBody}");
            Assert.Equal("PAID", result.Order?.Status);
        });
        var pickupNumbers = results
            .Select(result => result.Order?.PickupNumber)
            .OrderBy(number => number)
            .ToArray();
        Assert.Equal(Enumerable.Range(1, orderCount).Select(number => (int?)number), pickupNumbers);
        Assert.Equal(0, await GetStockAsync(host, "sparkling-water"));
        Assert.Equal(orderCount, await CountOrdersAsync(host));
    }

    private static Task<HttpResponseMessage> CreateQuoteAsync(HttpClient client, params CartLineRequest[] lines) =>
        client.PostAsJsonAsync("/api/quotes", new QuoteRequest(lines));

    private static async Task<QuoteResponse> CreateQuoteValueAsync(HttpClient client, params CartLineRequest[] lines)
    {
        using var response = await CreateQuoteAsync(client, lines);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var quote = await response.Content.ReadFromJsonAsync<QuoteResponse>();
        Assert.NotNull(quote);
        return quote;
    }

    private static async Task<(HttpResponseMessage Response, OrderStatusResponse? Order)> PlaceOrderAsync(
        HttpClient client,
        string quoteId,
        string idempotencyKey,
        MockPaymentScenario scenario)
    {
        var response = await client.PostAsJsonAsync(
            "/api/orders",
            new PlaceOrderRequest(quoteId, idempotencyKey, scenario),
            JsonOptions);
        var body = response.IsSuccessStatusCode
            ? await response.Content.ReadFromJsonAsync<PlaceOrderResponse>(JsonOptions)
            : null;
        return (response, body?.Order);
    }

    private static async Task<(HttpStatusCode StatusCode, OrderStatusResponse? Order, string? ErrorBody)> PlaceOrderAsync(
        TestServer server,
        IPAddress remoteAddress,
        string quoteId,
        string idempotencyKey,
        MockPaymentScenario scenario)
    {
        using var handler = server.CreateHandler(context => context.Connection.RemoteIpAddress = remoteAddress);
        using var client = new HttpClient(handler) { BaseAddress = server.BaseAddress };
        using var response = await client.PostAsJsonAsync(
            "/api/orders",
            new PlaceOrderRequest(quoteId, idempotencyKey, scenario),
            JsonOptions);
        var orderBody = response.IsSuccessStatusCode
            ? await response.Content.ReadFromJsonAsync<PlaceOrderResponse>(JsonOptions)
            : null;
        var errorBody = !response.IsSuccessStatusCode
            ? await response.Content.ReadAsStringAsync()
            : null;
        return (response.StatusCode, orderBody?.Order, errorBody);
    }

    private static async Task<string?> GetProblemCodeAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private static async Task<int?> GetStockAsync(CheckoutApiHost host, string itemId)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        return await database.CatalogItems
            .Where(item => item.Id == itemId)
            .Select(item => item.Stock)
            .SingleAsync();
    }

    private static async Task<int> CountOrdersAsync(CheckoutApiHost host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        return await database.Orders.CountAsync();
    }

    private static async Task<int> CountLedgerEntriesAsync(CheckoutApiHost host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        return await database.PaymentLedger.CountAsync();
    }

    private static async Task AgePendingOrderAsync(CheckoutApiHost host, string idempotencyKey, TimeSpan age)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        var order = await database.Orders
            .Include(item => item.PaymentAttempt)
            .SingleAsync(item => item.IdempotencyKey == idempotencyKey);
        var oldTimestamp = DateTimeOffset.UtcNow.Subtract(age).ToUnixTimeMilliseconds();
        order.CreatedAtUnixMs = oldTimestamp;
        order.PaymentAttempt!.CreatedAtUnixMs = oldTimestamp;
        await database.SaveChangesAsync();
    }

    private static async Task<long> GetPriceAsync(CheckoutApiHost host, string itemId)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        return await database.CatalogItems
            .Where(item => item.Id == itemId)
            .Select(item => item.PriceCents)
            .SingleAsync();
    }

    private static async Task SetChaosAsync(HttpClient client, object configuration)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/admin/chaos")
        {
            Content = JsonContent.Create(configuration)
        };
        request.Headers.Add("X-Admin-Token", TestAdminToken);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task SetPriceAsync(CheckoutApiHost host, string itemId, long priceCents)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        await database.CatalogItems
            .Where(item => item.Id == itemId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.PriceCents, priceCents));
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    private const string TestAdminToken = "this-is-a-long-demo-admin-token-for-tests";
}

internal sealed class CheckoutApiHost : IDisposable
{
    private readonly WebApplicationFactory<global::Program> _factory;

    public CheckoutApiHost(
        string databasePath,
        bool demoModeEnabled,
        string adminToken,
        string kioskId,
        ILoggerProvider? loggerProvider = null,
        IReadOnlyDictionary<string, string?>? additionalEnvironment = null,
        string environmentName = "Development",
        TimeProvider? timeProvider = null)
    {
        _factory = new CheckoutApiFactory(loggerProvider, environmentName, timeProvider);
        try
        {
            var environment = new Dictionary<string, string?>
            {
                ["Checkout__DatabasePath"] = databasePath,
                ["Checkout__MockPaymentsEnabled"] = "true",
                ["Checkout__TaxRateBasisPoints"] = "800",
                ["Checkout__QuoteLifetimeSeconds"] = "120",
                ["Checkout__BusinessTimeZone"] = "UTC",
                ["Checkout__KioskId"] = kioskId,
                ["DemoMode__Enabled"] = demoModeEnabled.ToString(),
                ["DemoMode__AdminToken"] = adminToken
            };
            if (additionalEnvironment is not null)
            {
                foreach (var (name, value) in additionalEnvironment)
                {
                    environment[name] = value;
                }
            }

            using (new TemporaryEnvironmentVariables(environment))
            {
                Client = _factory.CreateClient();
            }

            Services = _factory.Services;
        }
        catch
        {
            _factory.Dispose();
            throw;
        }
    }

    public HttpClient Client { get; }
    public IServiceProvider Services { get; }
    public TestServer Server => _factory.Server;

    public void Dispose()
    {
        Client.Dispose();
        _factory.Dispose();
        SqliteConnection.ClearAllPools();
    }
}

internal sealed class CheckoutApiFactory(
    ILoggerProvider? loggerProvider = null,
    string environmentName = "Development",
    TimeProvider? timeProvider = null) : WebApplicationFactory<global::Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environmentName);
        if (loggerProvider is not null)
        {
            builder.ConfigureLogging(logging => logging.AddProvider(loggerProvider));
        }

        if (timeProvider is not null)
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<TimeProvider>();
                services.AddSingleton(timeProvider);
            });
        }
    }
}

internal sealed class TemporaryEnvironmentVariables : IDisposable
{
    private readonly Dictionary<string, string?> _originalValues;

    public TemporaryEnvironmentVariables(IReadOnlyDictionary<string, string?> values)
    {
        _originalValues = new Dictionary<string, string?>(values.Count, StringComparer.Ordinal);
        foreach (var (name, value) in values)
        {
            _originalValues[name] = Environment.GetEnvironmentVariable(name);
            Environment.SetEnvironmentVariable(name, value);
        }
    }

    public void Dispose()
    {
        foreach (var (name, value) in _originalValues)
        {
            Environment.SetEnvironmentVariable(name, value);
        }
    }
}

internal sealed class TemporaryCheckoutDatabase : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "self-service-checkout-tests", Guid.NewGuid().ToString("N"));

    public string DatabasePath => Path.Combine(_directory, "checkout.db");

    public CheckoutApiHost StartHost(
        bool demoModeEnabled = false,
        string adminToken = "",
        string kioskId = "test-kiosk",
        ILoggerProvider? loggerProvider = null,
        IReadOnlyDictionary<string, string?>? additionalEnvironment = null,
        string environmentName = "Development",
        TimeProvider? timeProvider = null) =>
        new(DatabasePath, demoModeEnabled, adminToken, kioskId, loggerProvider, additionalEnvironment, environmentName, timeProvider);

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }
}

internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _messages = new();

    public string Messages => string.Join(Environment.NewLine, _messages);

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(_messages);

    public void Dispose() { }

    private sealed class CapturingLogger(ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            messages.Enqueue(formatter(state, exception));
            if (exception is not null)
            {
                messages.Enqueue(exception.ToString());
            }
        }
    }
}

internal sealed class FixedTimeProvider(DateTimeOffset utcNow) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => utcNow;
}
