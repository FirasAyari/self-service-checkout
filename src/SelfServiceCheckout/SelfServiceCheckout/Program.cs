using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using SelfServiceCheckout.Api;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Data;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(server => server.Limits.MaxRequestBodySize = 16_384);

var configuredDatabasePath = builder.Configuration[$"{CheckoutOptions.SectionName}:DatabasePath"];
var databasePath = string.IsNullOrWhiteSpace(configuredDatabasePath)
    ? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "..", "data", "checkout.db"))
    : Path.GetFullPath(configuredDatabasePath);
Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);

var connectionString = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder
{
    DataSource = databasePath,
    Mode = Microsoft.Data.Sqlite.SqliteOpenMode.ReadWriteCreate,
    Cache = Microsoft.Data.Sqlite.SqliteCacheMode.Shared,
    ForeignKeys = true,
    Pooling = true,
    DefaultTimeout = 5
}.ToString();

builder.Services.AddDbContextFactory<CheckoutDbContext>(options =>
    options.UseSqlite(connectionString, sqlite => sqlite.CommandTimeout(5)));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<DemoChaosState>();
builder.Services.AddSingleton<MockPaymentGateway>();
builder.Services.AddScoped<CheckoutService>();
builder.Services.AddHostedService<PaymentReconciler>();
builder.Services.AddExceptionHandler<CheckoutExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddOptions<CheckoutOptions>()
    .BindConfiguration(CheckoutOptions.SectionName)
    .Validate(options => options.TaxRateBasisPoints is >= 0 and <= 10_000, "TaxRateBasisPoints must be between 0 and 10000.")
    .Validate(options => options.QuoteLifetimeSeconds is >= 30 and <= 600, "QuoteLifetimeSeconds must be between 30 and 600.")
    .Validate(options => !string.IsNullOrWhiteSpace(options.BusinessTimeZone), "BusinessTimeZone is required.")
    .Validate(options => !string.IsNullOrWhiteSpace(options.KioskId), "KioskId is required.")
    .ValidateOnStart();
builder.Services.AddOptions<DemoModeOptions>()
    .BindConfiguration(DemoModeOptions.SectionName)
    .Validate(options => !options.Enabled || (builder.Environment.IsDevelopment() && options.AdminToken is { Length: >= 32 }),
        "Demo administration requires Development and an AdminToken with at least 32 characters.")
    .ValidateOnStart();
builder.Services.Configure<JsonOptions>(options =>
{
    options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("browse", context => CreateIpLimiter(context, 120));
    options.AddPolicy("quote", context => CreateIpLimiter(context, 40));
    options.AddPolicy("order-submit", context => CreateIpLimiter(context, 10));
    options.AddPolicy("status", context => CreateIpLimiter(context, 60));
    options.AddPolicy("admin", context => CreateIpLimiter(context, 30));
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi("/openapi/v1.json");
}

app.MapGet("/healthz", () => TypedResults.Ok(new { status = "ready" })).WithName("Health");
app.MapCheckoutEndpoints();
if (app.Services.GetRequiredService<IOptions<DemoModeOptions>>().Value.Enabled)
{
    app.MapDemoAdminEndpoints();
}

var publishedWebRoot = app.Environment.WebRootPath;
var webRoot = !string.IsNullOrWhiteSpace(publishedWebRoot) && File.Exists(Path.Combine(publishedWebRoot, "index.html"))
    ? publishedWebRoot
    : Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "..", "web", "dist"));
if (Directory.Exists(webRoot))
{
    var files = new PhysicalFileProvider(webRoot);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
    app.MapFallback(async context =>
    {
        if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/openapi"))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(Path.Combine(webRoot, "index.html"));
    });
}

await using (var scope = app.Services.CreateAsyncScope())
{
    var databaseFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<CheckoutDbContext>>();
    await using var database = await databaseFactory.CreateDbContextAsync();
    await DatabaseInitializer.InitializeAsync(database, CancellationToken.None);
}

await app.RunAsync();

static FixedWindowRateLimiterOptions RateLimitOptions(int permits) => new()
{
    PermitLimit = permits,
    Window = TimeSpan.FromMinutes(1),
    QueueLimit = 0,
    AutoReplenishment = true
};

static RateLimitPartition<string> CreateIpLimiter(HttpContext context, int permits)
{
    var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => RateLimitOptions(permits));
}

public partial class Program { }
