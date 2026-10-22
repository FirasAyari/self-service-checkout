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
    [Fact(DisplayName = "SC-G2: SQL-looking item IDs are treated as data and do not alter catalog results")]
    public async Task CreateQuote_SQLLookingItemIdIsRejectedWithoutChangingCatalog()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();

        using var response = await CreateQuoteAsync(host.Client, new CartLineRequest("' OR 1=1 --", 1));
        var menu = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("ITEM_UNAVAILABLE", await GetProblemCodeAsync(response));
        Assert.Equal(12, menu!.Categories.SelectMany(category => category.Items).Single(item => item.Id == "turkey-melt").Stock);
        Assert.Equal(0, await CountOrdersAsync(host));
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

        using var items = await host.Client.GetAsync("/api/admin/items");
        using var chaos = await host.Client.GetAsync("/api/admin/chaos");
        using var patch = await host.Client.PatchAsJsonAsync("/api/admin/items/turkey-melt", new { priceCents = 900 });
        using var response = await host.Client.PostAsync("/api/admin/reset", content: null);

        Assert.Equal(HttpStatusCode.NotFound, items.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, chaos.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, patch.StatusCode);
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

    [Fact(DisplayName = "AC-D8: demo administration reads require a token and expose current catalog and chaos state")]
    public async Task DemoAdmin_ReadEndpointsRequireTokenAndReturnCurrentState()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost(demoModeEnabled: true, adminToken: TestAdminToken);
        await SetActiveAsync(host, "turkey-melt", false);

        using var unauthorizedItems = await host.Client.GetAsync("/api/admin/items");
        using var unauthorizedChaos = await host.Client.GetAsync("/api/admin/chaos");
        Assert.Equal(HttpStatusCode.NotFound, unauthorizedItems.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unauthorizedChaos.StatusCode);

        using var itemsRequest = new HttpRequestMessage(HttpMethod.Get, "/api/admin/items");
        itemsRequest.Headers.Add("X-Admin-Token", TestAdminToken);
        using var itemsResponse = await host.Client.SendAsync(itemsRequest);
        var items = await itemsResponse.Content.ReadFromJsonAsync<DemoCatalogItemDto[]>(JsonOptions);

        Assert.Equal(HttpStatusCode.OK, itemsResponse.StatusCode);
        Assert.NotNull(items);
        Assert.Contains(items, item => item.Id == "turkey-melt" && !item.IsActive);

        using var setChaosRequest = new HttpRequestMessage(HttpMethod.Post, "/api/admin/chaos")
        {
            Content = JsonContent.Create(new
            {
                scenarioOverride = "StillUnknown",
                mode = "Latency",
                latencyMilliseconds = 250
            })
        };
        setChaosRequest.Headers.Add("X-Admin-Token", TestAdminToken);
        using var setChaosResponse = await host.Client.SendAsync(setChaosRequest);
        Assert.Equal(HttpStatusCode.OK, setChaosResponse.StatusCode);

        using var chaosRequest = new HttpRequestMessage(HttpMethod.Get, "/api/admin/chaos");
        chaosRequest.Headers.Add("X-Admin-Token", TestAdminToken);
        using var chaosResponse = await host.Client.SendAsync(chaosRequest);
        var chaos = await chaosResponse.Content.ReadFromJsonAsync<DemoChaosStateDto>(JsonOptions);

        Assert.Equal(HttpStatusCode.OK, chaosResponse.StatusCode);
        Assert.NotNull(chaos);
        Assert.Equal(MockPaymentScenario.StillUnknown, chaos.ScenarioOverride);
        Assert.Equal(SelfServiceCheckout.Contracts.DemoChaosMode.Latency, chaos.Mode);
        Assert.Equal(250, chaos.LatencyMilliseconds);
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

    [Fact(DisplayName = "AC-D3 AC-O8 SC-D11: same-attempt retry resumes after reservation before gateway")]
    public async Task DemoChaos_CrashAfterReservationSameAttemptRetryRecordsOutcomeAndSettlesOnce()
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

        using var pendingStatusResponse = await host.Client.PostAsJsonAsync(
            "/api/orders/status",
            new OrderStatusRequest(idempotencyKey),
            JsonOptions);
        var pendingStatus = await pendingStatusResponse.Content.ReadFromJsonAsync<OrderStatusResponse>(JsonOptions);
        Assert.Equal(HttpStatusCode.OK, pendingStatusResponse.StatusCode);
        Assert.Equal("PENDING_PAYMENT", pendingStatus?.Status);

        using var replayResponse = await host.Client.PostAsJsonAsync(
            "/api/orders",
            new PlaceOrderRequest(quote.QuoteId, idempotencyKey, MockPaymentScenario.Approve),
            JsonOptions);
        var replay = await replayResponse.Content.ReadFromJsonAsync<PlaceOrderResponse>(JsonOptions);
        Assert.Equal(HttpStatusCode.OK, replayResponse.StatusCode);
        Assert.Equal("PAID", replay?.Order.Status);
        Assert.Equal(pendingStatus?.PublicReference, replay?.Order.PublicReference);
        Assert.InRange(replay?.Order.PickupNumber ?? 0, 1, int.MaxValue);
        Assert.Equal(1, await CountOrdersAsync(host));
        Assert.Equal(11, await GetStockAsync(host, "turkey-melt"));
        Assert.Equal(1, await CountLedgerEntriesAsync(host));
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
        using var logs = new CapturingLoggerProvider();
        using var host = database.StartHost(loggerProvider: logs);
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
            Assert.True(result.StatusCode == HttpStatusCode.Created, $"Expected Created, received {result.StatusCode}: {result.ErrorBody}{Environment.NewLine}{logs.Messages}");
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

    [Fact(DisplayName = "AC-O7 SC-G6: concurrent duplicate submissions create one order and reserve stock once")]
    public async Task ConcurrentDuplicateSubmissions_ReturnTheSameOrderAndPickupNumber()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("sparkling-water", 1));
        const string idempotencyKey = "88888888888848888888888888888888";

        var results = await Task.WhenAll(Enumerable.Range(1, 2).Select(index => PlaceOrderAsync(
            host.Server,
            new IPAddress(new byte[] { 10, 31, 0, (byte)index }),
            quote.QuoteId,
            idempotencyKey,
            MockPaymentScenario.Approve)));

        Assert.All(results, result =>
        {
            Assert.Contains(result.StatusCode, new[] { HttpStatusCode.Created, HttpStatusCode.OK, HttpStatusCode.Accepted });
            Assert.NotNull(result.Order);
        });
        Assert.Single(results.Select(result => result.Order!.PublicReference).Distinct());
        Assert.Single(results.Select(result => result.Order!.PickupNumber).Where(number => number is not null).Distinct());
        Assert.Contains(results, result => result.Order?.Status == "PAID");
        Assert.Equal(19, await GetStockAsync(host, "sparkling-water"));
        Assert.Equal(1, await CountOrdersAsync(host));
        Assert.Equal(1, await CountLedgerEntriesAsync(host));
    }

}
