namespace SelfServiceCheckout.Application;

/// <summary>Process-local demo override, exposed only by authenticated Development endpoints.</summary>
public sealed class DemoChaosState
{
    private DemoChaosConfiguration _configuration = new(null, null, 0);

    public DemoChaosConfiguration Configuration => Volatile.Read(ref _configuration);

    public void SetConfiguration(DemoChaosConfiguration configuration) =>
        Volatile.Write(ref _configuration, configuration);
}

public enum DemoChaosMode
{
    Latency,
    DropResponse,
    CrashAfterReservation
}

public sealed record DemoChaosConfiguration(
    PaymentScenario? ScenarioOverride,
    DemoChaosMode? Mode,
    int LatencyMilliseconds);
