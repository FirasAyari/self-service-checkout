using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using SelfServiceCheckout.Application;
using SelfServiceCheckout.Contracts;

namespace SelfServiceCheckout.Api;

public static class DemoAdminEndpoints
{
    public static IEndpointRouteBuilder MapDemoAdminEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/admin")
            .WithTags("Demo administration")
            .AddEndpointFilter(async (context, next) =>
            {
                var options = context.HttpContext.RequestServices.GetRequiredService<IOptions<DemoModeOptions>>().Value;
                var suppliedToken = context.HttpContext.Request.Headers["X-Admin-Token"].ToString();
                if (!HasValidToken(suppliedToken, options.AdminToken))
                {
                    return Results.NotFound();
                }

                return await next(context);
            });

        group.MapPatch("/items/{itemId}", async (
                string itemId,
                DemoCatalogPatchRequest request,
                IDemoAdministrationService administration,
                CancellationToken cancellationToken) =>
            {
                if (request.PriceCents is <= 0 || request.Stock is < 0 ||
                    (request.PriceCents is null && request.Stock is null && request.IsActive is null && !request.ClearStock))
                {
                    return Results.BadRequest(new { code = "INVALID_CATALOG_PATCH", message = "Provide a valid price, stock, availability, or clearStock value." });
                }

                var updated = await administration.UpdateCatalogItemAsync(
                    itemId,
                    request.PriceCents,
                    request.Stock,
                    request.IsActive,
                    request.ClearStock,
                    cancellationToken);
                if (!updated)
                {
                    return Results.NotFound(new { code = "ITEM_NOT_FOUND", message = "The menu item was not found." });
                }

                return Results.NoContent();
            })
            .WithName("DemoUpdateMenuItem")
            .Accepts<DemoCatalogPatchRequest>("application/json")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapPost("/reset", async (
                IDemoAdministrationService administration,
                DemoChaosState chaosState,
                CancellationToken cancellationToken) =>
            {
                await administration.ResetAsync(cancellationToken);
                chaosState.SetConfiguration(new DemoChaosConfiguration(null, null, 0));
                return TypedResults.NoContent();
            })
            .WithName("DemoReset")
            .Produces(StatusCodes.Status204NoContent);

        group.MapPost("/chaos", (DemoChaosRequest request, DemoChaosState chaosState) =>
            {
                if (request.ScenarioOverride is { } scenario && !Enum.IsDefined(scenario))
                {
                    return Results.BadRequest(new { code = "INVALID_SCENARIO", message = "Choose a supported simulated payment outcome." });
                }

                if (request.Mode is { } mode && !Enum.IsDefined(mode))
                {
                    return Results.BadRequest(new { code = "INVALID_CHAOS_MODE", message = "Choose a supported chaos mode." });
                }

                if (request.LatencyMilliseconds is < 0 or > 7_000)
                {
                    return Results.BadRequest(new { code = "INVALID_LATENCY", message = "Latency must be between 0 and 7000 milliseconds." });
                }

                chaosState.SetConfiguration(new DemoChaosConfiguration(
                    request.ScenarioOverride is { } selectedScenario
                        ? ApiContractMappings.ToApplicationScenario(selectedScenario)
                        : null,
                    request.Mode,
                    request.LatencyMilliseconds));
                return Results.Ok(new
                {
                    scenarioOverride = request.ScenarioOverride?.ToString() ?? "client-selected",
                    mode = request.Mode?.ToString() ?? "normal",
                    latencyMilliseconds = request.Mode == DemoChaosMode.Latency ? request.LatencyMilliseconds : 0
                });
            })
            .WithName("DemoSetChaos")
            .Accepts<DemoChaosRequest>("application/json")
            .Produces(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        return endpoints;
    }

    private static bool HasValidToken(string provided, string? expected)
    {
        if (string.IsNullOrEmpty(provided) || string.IsNullOrEmpty(expected)) return false;
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        return providedBytes.Length == expectedBytes.Length && CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }
}

public sealed record DemoCatalogPatchRequest(
    long? PriceCents,
    int? Stock,
    bool? IsActive,
    bool ClearStock = false);

public sealed record DemoChaosRequest(
    MockPaymentScenario? ScenarioOverride,
    DemoChaosMode? Mode = null,
    int LatencyMilliseconds = 3_000);
