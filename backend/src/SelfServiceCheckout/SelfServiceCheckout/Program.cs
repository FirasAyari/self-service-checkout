using System.Net;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using SelfServiceCheckout.Api;
using SelfServiceCheckout.Api.HostedServices;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Infrastructure.Sqlite;

var builder = WebApplication.CreateBuilder(args);

var trustedProxyAddresses = builder.Configuration.GetSection("ReverseProxy:KnownProxies")
    .GetChildren()
    .Select(section => section.Value)
    .Where(value => !string.IsNullOrWhiteSpace(value))
    .Select(value => IPAddress.TryParse(value, out var address)
        ? address
        : throw new InvalidOperationException("ReverseProxy:KnownProxies must contain valid IP addresses."))
    .ToArray();

builder.WebHost.ConfigureKestrel(server => server.Limits.MaxRequestBodySize = 16_384);

var configuredDatabasePath = builder.Configuration[$"{CheckoutOptions.SectionName}:DatabasePath"];
var databasePath = string.IsNullOrWhiteSpace(configuredDatabasePath)
    ? Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "..", "..", "data", "checkout.db"))
    : Path.GetFullPath(configuredDatabasePath);
Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);

builder.Services.AddSqliteCheckout(databasePath);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<DemoChaosState>();
builder.Services.AddSingleton(new SimulatedPaymentPolicy(builder.Environment.IsDevelopment()));
builder.Services.AddHostedService<PaymentReconciler>();
builder.Services.AddExceptionHandler<CheckoutExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(365);
    options.IncludeSubDomains = false;
    options.Preload = false;
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardLimit = 1;
    if (trustedProxyAddresses.Length == 0)
    {
        options.ForwardedHeaders = ForwardedHeaders.None;
        return;
    }

    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownProxies.Clear();
    options.KnownIPNetworks.Clear();
    foreach (var address in trustedProxyAddresses) options.KnownProxies.Add(address);
});
builder.Services.AddOptions<CheckoutOptions>()
    .BindConfiguration(CheckoutOptions.SectionName)
    .Validate(options => options.TaxRateBasisPoints is >= 0 and <= 10_000, "TaxRateBasisPoints must be between 0 and 10000.")
    .Validate(options => options.QuoteLifetimeSeconds is >= 30 and <= 600, "QuoteLifetimeSeconds must be between 30 and 600.")
    .Validate(options => CheckoutOptions.IsValidBusinessTimeZone(options.BusinessTimeZone), "BusinessTimeZone must be a valid time-zone ID on this host.")
    .Validate(options => !string.IsNullOrWhiteSpace(options.KioskId), "KioskId is required.")
    .ValidateOnStart();
builder.Services.AddSingleton(provider => provider.GetRequiredService<IOptions<CheckoutOptions>>().Value);
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
    options.OnRejected = (context, _) =>
    {
        context.HttpContext.Response.Headers["Retry-After"] = "60";
        return ValueTask.CompletedTask;
    };
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        var (policy, permits) = context.Request.Method switch
        {
            "GET" when context.Request.Path == "/api/menu" => ("browse", 120),
            "POST" when context.Request.Path == "/api/quotes" => ("quote", 40),
            "POST" when context.Request.Path == "/api/orders/status" => ("status", 60),
            "POST" when context.Request.Path == "/api/orders" => ("order-submit", 10),
            _ when context.Request.Path.StartsWithSegments("/api/admin") => ("admin", 30),
            _ => (string.Empty, 0)
        };

        if (policy.Length == 0)
        {
            return RateLimitPartition.GetNoLimiter("unlimited");
        }

        var clientAddress = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter($"{policy}:{clientAddress}", _ => RateLimitOptions(permits));
    });
});

var app = builder.Build();

app.UseForwardedHeaders();
app.UseRouting();
app.Use(async (context, next) =>
{
    context.Response.OnStarting(() =>
    {
        var headers = context.Response.Headers;
        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        headers["Content-Security-Policy"] = "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'";

        if (context.Request.Path.StartsWithSegments("/api"))
        {
            headers.CacheControl = "no-store";
        }

        return Task.CompletedTask;
    });

    await next(context);
});
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseExceptionHandler();
app.UseRateLimiter();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi("/openapi/v1.json");
}

app.MapGet("/healthz", ReadinessAsync)
    .WithName("Health")
    .Produces<HealthEndpointResponse>()
    .Produces<HealthEndpointResponse>(StatusCodes.Status503ServiceUnavailable);
app.MapGet("/health/live", () => TypedResults.Ok(new HealthEndpointResponse("live")))
    .ExcludeFromDescription();
app.MapGet("/health/ready", ReadinessAsync)
    .ExcludeFromDescription();
app.MapCheckoutEndpoints();
if (app.Services.GetRequiredService<IOptions<DemoModeOptions>>().Value.Enabled)
{
    app.MapDemoAdminEndpoints();
}

var publishedWebRoot = app.Environment.WebRootPath;
var webRoot = !string.IsNullOrWhiteSpace(publishedWebRoot) && File.Exists(Path.Combine(publishedWebRoot, "index.html"))
    ? publishedWebRoot
    : Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "..", "..", "..", "frontend", "dist"));
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

await app.Services.InitializeCheckoutDatabaseAsync();

await app.RunAsync();

static FixedWindowRateLimiterOptions RateLimitOptions(int permits) => new()
{
    PermitLimit = permits,
    Window = TimeSpan.FromMinutes(1),
    QueueLimit = 0,
    AutoReplenishment = true
};

static async Task<IResult> ReadinessAsync(HealthCheckService healthChecks, CancellationToken cancellationToken)
{
    var report = await healthChecks.CheckHealthAsync(check => check.Tags.Contains("ready"), cancellationToken);
    var isReady = report.Status == Microsoft.Extensions.Diagnostics.HealthChecks.HealthStatus.Healthy;
    return Results.Json(
        new HealthEndpointResponse(isReady ? "ready" : "not-ready"),
        statusCode: isReady ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
}

public partial class Program { }

public sealed record HealthEndpointResponse(string Status);
