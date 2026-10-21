using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using SelfServiceCheckout.Application;

namespace SelfServiceCheckout.Api;

public sealed class CheckoutExceptionHandler(
    IProblemDetailsService problemDetailsService,
    ILogger<CheckoutExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var (statusCode, code, title) = exception switch
        {
            CheckoutException checkoutException => (ToStatusCode(checkoutException.Kind), checkoutException.Code, checkoutException.Message),
            BadHttpRequestException { StatusCode: StatusCodes.Status413PayloadTooLarge } =>
                (StatusCodes.Status413PayloadTooLarge, "REQUEST_TOO_LARGE", "The request body exceeds the allowed size."),
            BadHttpRequestException badRequest =>
                (badRequest.StatusCode, "INVALID_REQUEST", "The request body is invalid. Check the request fields and try again."),
            _ => (StatusCodes.Status500InternalServerError, "UNEXPECTED_ERROR", "We could not complete that request.")
        };

        if (exception is not CheckoutException and not BadHttpRequestException)
        {
            logger.LogError(exception, "Unhandled checkout error. RequestId: {RequestId}", httpContext.TraceIdentifier);
        }

        httpContext.Response.StatusCode = statusCode;
        if (exception is CheckoutException { RetryAfterSeconds: int retryAfterSeconds })
        {
            httpContext.Response.Headers["Retry-After"] = retryAfterSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        var problem = new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Type = "about:blank",
            Extensions =
            {
                ["code"] = code,
                ["requestId"] = httpContext.TraceIdentifier
            }
        };

        return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = problem
        });
    }

    private static int ToStatusCode(CheckoutFailureKind kind) => kind switch
    {
        CheckoutFailureKind.InvalidRequest => StatusCodes.Status400BadRequest,
        CheckoutFailureKind.Conflict => StatusCodes.Status409Conflict,
        CheckoutFailureKind.NotFound => StatusCodes.Status404NotFound,
        CheckoutFailureKind.Unavailable => StatusCodes.Status503ServiceUnavailable,
        CheckoutFailureKind.RateLimited => StatusCodes.Status429TooManyRequests,
        CheckoutFailureKind.Unprocessable => StatusCodes.Status422UnprocessableEntity,
        _ => StatusCodes.Status500InternalServerError
    };
}
