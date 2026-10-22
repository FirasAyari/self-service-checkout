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

    private static async Task<int> CountQuotesAsync(CheckoutApiHost host)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        return await database.Quotes.CountAsync();
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

    private static async Task SetStockAsync(CheckoutApiHost host, string itemId, int? stock)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        await database.CatalogItems
            .Where(item => item.Id == itemId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Stock, stock));
    }

    private static async Task SetActiveAsync(CheckoutApiHost host, string itemId, bool isActive)
    {
        await using var scope = host.Services.CreateAsyncScope();
        var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
        await using var database = await factory.CreateDbContextAsync();
        await database.CatalogItems
            .Where(item => item.Id == itemId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.IsActive, isActive));
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
    private DateTimeOffset _utcNow = utcNow;

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public void SetUtcNow(DateTimeOffset value) => _utcNow = value;
}
