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
    [Fact(DisplayName = "AC-O8 SC-D4: after 30 seconds, no ledger result remains pending and keeps reserved stock")]
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

    [Fact(DisplayName = "SC-C7: catalog price changes after reservation do not change the order snapshot")]
    public async Task UnknownAfterApproval_PreservesOrderSnapshotWhenCatalogChangesBeforeSettlement()
    {
        using var database = new TemporaryCheckoutDatabase();
        using var host = database.StartHost();
        var quote = await CreateQuoteValueAsync(host.Client, new CartLineRequest("turkey-melt", 1));
        var key = Guid.NewGuid().ToString("N");

        var pending = await PlaceOrderAsync(host.Client, quote.QuoteId, key, MockPaymentScenario.UnknownAfterApproval);
        Assert.Equal(HttpStatusCode.Accepted, pending.Response.StatusCode);
        await SetPriceAsync(host, "turkey-melt", 900);
        await AgePendingOrderAsync(host, key, TimeSpan.FromSeconds(31));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var payments = scope.ServiceProvider.GetRequiredService<IPaymentReconciliationService>();
            await payments.ReconcilePendingAsync(CancellationToken.None);
        }
        var status = await host.Client.PostAsJsonAsync("/api/orders/status", new OrderStatusRequest(key));
        var paid = await status.Content.ReadFromJsonAsync<OrderStatusResponse>();

        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        Assert.Equal("PAID", paid?.Status);
        Assert.Equal(895, paid?.TotalCents);
        Assert.Equal(quote.TaxCents, paid?.TaxCents);
        Assert.Equal(895, Assert.Single(paid!.Lines).UnitPriceCents);
        var menu = await host.Client.GetFromJsonAsync<MenuResponse>("/api/menu");
        Assert.Equal(900, menu?.Categories.SelectMany(category => category.Items).Single(item => item.Id == "turkey-melt").PriceCents);
    }

}
