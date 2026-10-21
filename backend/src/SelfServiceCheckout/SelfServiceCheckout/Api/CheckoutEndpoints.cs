using SelfServiceCheckout.Application;
using SelfServiceCheckout.Contracts;

namespace SelfServiceCheckout.Api;

public static class CheckoutEndpoints
{
    public static IEndpointRouteBuilder MapCheckoutEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api").WithTags("Checkout");

        group.MapGet("/menu", async (IMenuQueryService catalog, CancellationToken cancellationToken) =>
                TypedResults.Ok(await catalog.GetMenuAsync(cancellationToken)))
            .WithName("GetMenu")
            .Produces<MenuResponse>();

        group.MapPost("/quotes", async (QuoteRequest? request, IQuoteService catalog, CancellationToken cancellationToken) =>
                TypedResults.Ok(await catalog.CreateQuoteAsync(
                    request ?? throw new CheckoutException("REQUEST_REQUIRED", "Add items to your cart and try again.", CheckoutFailureKind.InvalidRequest),
                    cancellationToken)))
            .WithName("CreateQuote")
            .Accepts<QuoteRequest>("application/json")
            .Produces<QuoteResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapPost("/orders", async (PlaceOrderRequest? request, IOrderPlacementService checkout, CancellationToken cancellationToken) =>
            {
                var result = await checkout.PlaceOrderAsync(
                    request ?? throw new CheckoutException("REQUEST_REQUIRED", "Review your cart and try again.", CheckoutFailureKind.InvalidRequest),
                    cancellationToken);
                var response = new PlaceOrderResponse(result.Order);
                return result.Order.Status == "PENDING_PAYMENT"
                    ? Results.Json(response, statusCode: StatusCodes.Status202Accepted)
                    : result.IsReplay
                        ? Results.Ok(response)
                        : Results.Json(response, statusCode: StatusCodes.Status201Created);
            })
            .WithName("PlaceOrder")
            .Accepts<PlaceOrderRequest>("application/json")
            .Produces<PlaceOrderResponse>(StatusCodes.Status201Created)
            .Produces<PlaceOrderResponse>(StatusCodes.Status200OK)
            .Produces<PlaceOrderResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        group.MapPost("/orders/status", async (OrderStatusRequest? request, IOrderStatusService checkout, CancellationToken cancellationToken) =>
                TypedResults.Ok(await checkout.GetOrderStatusAsync(
                    request ?? throw new CheckoutException("REQUEST_REQUIRED", "Use the payment attempt from this checkout to check its status.", CheckoutFailureKind.InvalidRequest),
                    cancellationToken)))
            .WithName("GetOrderStatus")
            .Accepts<OrderStatusRequest>("application/json")
            .Produces<OrderStatusResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        return endpoints;
    }
}
