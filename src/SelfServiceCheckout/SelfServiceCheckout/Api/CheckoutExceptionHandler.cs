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
        var (statusCode, code, title) = exception is CheckoutException checkoutException
            ? (checkoutException.StatusCode, checkoutException.Code, checkoutException.Message)
            : (StatusCodes.Status500InternalServerError, "UNEXPECTED_ERROR", "We could not complete that request.");

        if (exception is not CheckoutException)
        {
            logger.LogError("Unhandled checkout error. RequestId: {RequestId}", httpContext.TraceIdentifier);
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
}
