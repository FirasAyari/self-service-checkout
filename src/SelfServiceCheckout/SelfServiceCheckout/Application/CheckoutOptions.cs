namespace SelfServiceCheckout.Application;

public sealed class CheckoutOptions
{
    public const string SectionName = "Checkout";

    public bool MockPaymentsEnabled { get; init; }
    public int TaxRateBasisPoints { get; init; } = 800;
    public int QuoteLifetimeSeconds { get; init; } = 120;
    public string BusinessTimeZone { get; init; } = "UTC";
    public string KioskId { get; init; } = "kiosk-1";
}

public sealed class DemoModeOptions
{
    public const string SectionName = "DemoMode";

    public bool Enabled { get; init; }
    public string AdminToken { get; init; } = string.Empty;
}

public sealed class CheckoutException(
    string code,
    string message,
    int statusCode,
    int? retryAfterSeconds = null) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}
