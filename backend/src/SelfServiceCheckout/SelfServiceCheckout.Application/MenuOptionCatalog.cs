using System.Globalization;
using SelfServiceCheckout.Contracts;

namespace SelfServiceCheckout.Application;

/// <summary>Server-owned option and price catalog for the P2 demo items.</summary>
public static class MenuOptionCatalog
{
    private static readonly IReadOnlyList<MenuItemOptionGroupDto> ColdBrewGroups =
    [
        new MenuItemOptionGroupDto(
            "size",
            "Size",
            true,
            1,
            [
                new MenuItemOptionDto("small", "Small", 0),
                new MenuItemOptionDto("large", "Large", 125)
            ]),
        new MenuItemOptionGroupDto(
            "extras",
            "Add-ons",
            false,
            2,
            [
                new MenuItemOptionDto("oat-milk", "Oat milk", 50),
                new MenuItemOptionDto("extra-shot", "Extra shot", 100)
            ])
    ];

    public static IReadOnlyList<MenuItemOptionGroupDto> GetGroups(string itemId) =>
        itemId == "cold-brew" ? ColdBrewGroups : Array.Empty<MenuItemOptionGroupDto>();

    public static bool TryResolve(
        string itemId,
        IReadOnlyList<string>? requestedOptionIds,
        out IReadOnlyList<MenuItemOptionDto> selectedOptions)
    {
        var groups = GetGroups(itemId);
        var optionIds = requestedOptionIds ?? Array.Empty<string>();
        var uniqueIds = optionIds.ToHashSet(StringComparer.Ordinal);
        if (uniqueIds.Count != optionIds.Count)
        {
            selectedOptions = Array.Empty<MenuItemOptionDto>();
            return false;
        }

        var resolved = new List<MenuItemOptionDto>();
        foreach (var group in groups)
        {
            var selectedInGroup = group.Options.Where(option => uniqueIds.Contains(option.Id)).ToArray();
            if ((group.IsRequired && selectedInGroup.Length != 1) ||
                selectedInGroup.Length > group.MaximumSelections)
            {
                selectedOptions = Array.Empty<MenuItemOptionDto>();
                return false;
            }

            resolved.AddRange(selectedInGroup);
        }

        if (uniqueIds.Any(id => groups.All(group => group.Options.All(option => option.Id != id))))
        {
            selectedOptions = Array.Empty<MenuItemOptionDto>();
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
