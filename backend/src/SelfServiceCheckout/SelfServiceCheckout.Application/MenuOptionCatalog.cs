using System.Globalization;

namespace SelfServiceCheckout.Application;

/// <summary>Server-owned option and price catalog for the P2 demo items.</summary>
public static class MenuOptionCatalog
{
    private static readonly IReadOnlyList<MenuOptionGroupSnapshot> ColdBrewGroups =
    [
        new MenuOptionGroupSnapshot(
            "size",
            "Size",
            true,
            1,
            [
                new MenuOptionSnapshot("small", "Small", 0),
                new MenuOptionSnapshot("large", "Large", 125)
            ]),
        new MenuOptionGroupSnapshot(
            "extras",
            "Add-ons",
            false,
            2,
            [
                new MenuOptionSnapshot("oat-milk", "Oat milk", 50),
                new MenuOptionSnapshot("extra-shot", "Extra shot", 100)
            ])
    ];

    public static IReadOnlyList<MenuOptionGroupSnapshot> GetGroups(string itemId) =>
        itemId == "cold-brew" ? ColdBrewGroups : Array.Empty<MenuOptionGroupSnapshot>();

    public static bool TryResolve(
        string itemId,
        IReadOnlyList<string>? requestedOptionIds,
        out IReadOnlyList<MenuOptionSnapshot> selectedOptions)
    {
        var groups = GetGroups(itemId);
        var optionIds = requestedOptionIds ?? Array.Empty<string>();
        var uniqueIds = optionIds.ToHashSet(StringComparer.Ordinal);
        if (uniqueIds.Count != optionIds.Count)
        {
            selectedOptions = Array.Empty<MenuOptionSnapshot>();
            return false;
        }

        var resolved = new List<MenuOptionSnapshot>();
        foreach (var group in groups)
        {
            var selectedInGroup = group.Options.Where(option => uniqueIds.Contains(option.Id)).ToArray();
            if ((group.IsRequired && selectedInGroup.Length != 1) ||
                selectedInGroup.Length > group.MaximumSelections)
            {
                selectedOptions = Array.Empty<MenuOptionSnapshot>();
                return false;
            }

            resolved.AddRange(selectedInGroup);
        }

        if (uniqueIds.Any(id => groups.All(group => group.Options.All(option => option.Id != id))))
        {
            selectedOptions = Array.Empty<MenuOptionSnapshot>();
            return false;
        }

        selectedOptions = resolved;
        return true;
    }

    public static string VersionDescriptor(string itemId) => string.Join(
        ";",
        GetGroups(itemId).Select(group => string.Concat(
            group.Id,
            ":",
            group.IsRequired.ToString(CultureInfo.InvariantCulture),
            ":",
            group.MaximumSelections.ToString(CultureInfo.InvariantCulture),
            ":",
            string.Join(",", group.Options.Select(option => string.Concat(
                option.Id,
                "=",
                option.AdditionalPriceCents.ToString(CultureInfo.InvariantCulture)))))));
}
