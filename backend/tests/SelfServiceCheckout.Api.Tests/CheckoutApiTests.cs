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

    [Fact(DisplayName = "BR-M3: menu version changes with price, availability, and stock but stays stable otherwise")]
    public async Task MenuVersion_ChangesWhenRelevantCatalogDataChanges()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);

        var initial = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        var unchanged = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        Assert.Equal(initial?.Version, unchanged?.Version);
        Assert.Matches("^[A-F0-9]{16}$", initial!.Version);

        await SetPriceAsync(host, "turkey-melt", 896);
        var repriced = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        Assert.NotEqual(initial.Version, repriced?.Version);

        await SetStockAsync(host, "turkey-melt", 11);
        var restocked = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        Assert.NotEqual(repriced?.Version, restocked?.Version);

        await SetActiveAsync(host, "turkey-melt", false);
        var deactivated = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        Assert.NotEqual(restocked?.Version, deactivated?.Version);
    }

    [Fact(DisplayName = "BR-M4: menu and quote prices are positive integer minor units in the deployment currency")]
    public async Task MenuAndQuote_UsePositiveIntegerCentPricesAndCurrency()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        var menu = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));

        Assert.All(menu!.Categories.SelectMany(category => category.Items), item => Assert.True(item.PriceCents > 0));
        Assert.Equal("USD", quote.Currency);
        Assert.All(quote.Lines, line =>
        {
            Assert.True(line.UnitPriceCents > 0);
            Assert.True(line.LineTotalCents > 0);
            Assert.Equal(line.UnitPriceCents * line.Quantity, line.LineTotalCents);
        });
    }

    [Fact(DisplayName = "BR-S3: null stock stays unlimited after order settlement")]
    public async Task PlaceOrder_UnlimitedStockIsNotDecremented()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        await SetStockAsync(host, "turkey-melt", null);
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 2));

        var order = await PlaceOrderAsync(host.Client, quote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);

        Assert.Equal(HttpStatusCode.Created, order.Response.StatusCode);
        Assert.Null(await GetStockAsync(host, "turkey-melt"));
    }

    [Fact(DisplayName = "BR-O6: failed orders remain auditable and only paid orders receive pickup numbers")]
    public async Task PlaceOrder_DeclinesRemainStoredButOnlyPaidOrdersReceivePickupNumbers()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var declinedQuote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var paidQuote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));

        var declined = await PlaceOrderAsync(host.Client, declinedQuote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Decline);
        var paid = await PlaceOrderAsync(host.Client, paidQuote.QuoteId, Guid.NewGuid().ToString("N"), MockPaymentScenario.Approve);

        Assert.Equal("PAYMENT_FAILED", declined.Order?.Status);
        Assert.Null(declined.Order?.PickupNumber);
        Assert.Equal("PAID", paid.Order?.Status);
        Assert.InRange(paid.Order?.PickupNumber ?? 0, 1, int.MaxValue);
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var db = await factory.CreateDbContextAsync();
        Assert.Equal(2, await db.Orders.CountAsync());
        Assert.Equal(1, await db.Orders.CountAsync(order => order.Status == "PAYMENT_FAILED"));
        Assert.Equal(1, await db.Orders.CountAsync(order => order.Status == "PAID"));
        Assert.Single(await db.PickupCounters.ToListAsync());
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

    [Fact(DisplayName = "BR-X5 SC-G7 EVAL-PROD-04: cross-origin access is closed and rate limits are retryable")]
    public async Task ForwardedClientAddress_IsAcceptedOnlyFromConfiguredProxy()
    {
        using var untrustedDatabase = new TemporaryCheckoutDatabase();
        using var untrustedHost = untrustedDatabase.StartHost();
        using (var crossOrigin = new HttpRequestMessage(HttpMethod.Get, "/api/menu"))
        {
            crossOrigin.Headers.Add("Origin", "https://untrusted.example");
            using var response = await untrustedHost.Client.SendAsync(crossOrigin);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
        }

        for (var index = 1; index <= 11; index++)
        {
            using var response = await SubmitInvalidOrderWithForwardedAddressAsync(untrustedHost.Client, $"192.0.2.{index}");
            Assert.Equal(index == 11 ? HttpStatusCode.TooManyRequests : HttpStatusCode.BadRequest, response.StatusCode);
            if (index == 11) Assert.Equal("60", Assert.Single(response.Headers.GetValues("Retry-After")));
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

    [Theory(DisplayName = "BR-X4: demo administration requires Development and a sufficiently long token")]
    [InlineData("Development", "short", "AdminToken")]
    [InlineData("Production", TestAdminToken, "Demo administration requires Development")]
    public void Startup_RejectsUnsafeDemoAdministrationConfiguration(string environmentName, string token, string expectedMessage)
    {
        using var database = new TemporaryCheckoutDatabase();

        var exception = Assert.ThrowsAny<OptionsValidationException>(() => database.StartHost(
            demoModeEnabled: true,
            adminToken: token,
            environmentName: environmentName));

        Assert.Contains(expectedMessage, exception.Message, StringComparison.Ordinal);
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

    [Fact(DisplayName = "SC-E6: a payment settled after local midnight gets the new business day's pickup number")]
    public async Task PickupNumber_UsesBusinessDayAtSettlementAfterRollover()
    {
        using var database = new TemporaryCheckoutDatabase();
        var beforeMidnight = new DateTimeOffset(2026, 1, 1, 23, 59, 59, TimeSpan.Zero);
        var clock = new FixedTimeProvider(beforeMidnight);
        using var host = database.StartHost(timeProvider: clock);
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var key = Guid.NewGuid().ToString("N");

        var pending = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.UnknownAfterApproval);
        Assert.Equal(HttpStatusCode.Accepted, pending.Response.StatusCode);
        clock.SetUtcNow(beforeMidnight.AddSeconds(2));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var payments = scope.ServiceProvider.GetRequiredService<IPaymentReconciliationService>();
            await payments.ReconcilePendingAsync(CancellationToken.None);
        }

        await using var readScope = host.Services.CreateAsyncScope();
        var factory = readScope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var db = await factory.CreateDbContextAsync();
        var settled = await db.Orders.SingleAsync(order => order.IdempotencyKey == key);
        Assert.Equal("PAID", settled.Status);
        Assert.Equal("2026-01-02", settled.PickupBusinessDate);
        Assert.Equal(1, settled.PickupNumber);
    }

    [Fact(DisplayName = "SC-G3 EVAL-PROD-02 AC-D5: production hides demo administration and fixes the simulated outcome")]
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

}
