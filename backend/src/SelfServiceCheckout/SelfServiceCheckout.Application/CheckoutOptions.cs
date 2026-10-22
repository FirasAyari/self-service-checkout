namespace SelfServiceCheckout.Application;

public sealed class CheckoutOptions
{
    public const string SectionName = "Checkout";

    public bool MockPaymentsEnabled { get; init; }
    public int TaxRateBasisPoints { get; init; } = 800;
    public int QuoteLifetimeSeconds { get; init; } = 120;
    public string BusinessTimeZone { get; init; } = "UTC";
    public string KioskId { get; init; } = "kiosk-1";
    public string? HelpUrl { get; init; }

    public static bool IsValidBusinessTimeZone(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId)) return false;

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            return false;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    public static bool IsValidHelpUrl(string? helpUrl)
    {
        if (string.IsNullOrWhiteSpace(helpUrl)) return true;

        return Uri.TryCreate(helpUrl, UriKind.Absolute, out var uri) &&
            uri.Scheme == Uri.UriSchemeHttps &&
            !string.IsNullOrWhiteSpace(uri.Host) &&
            string.IsNullOrEmpty(uri.UserInfo);
    }
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
    CheckoutFailureKind kind,
    int? retryAfterSeconds = null) : Exception(message)
{
    public string Code { get; } = code;
    public CheckoutFailureKind Kind { get; } = kind;
    public int? RetryAfterSeconds { get; } = retryAfterSeconds;
}
