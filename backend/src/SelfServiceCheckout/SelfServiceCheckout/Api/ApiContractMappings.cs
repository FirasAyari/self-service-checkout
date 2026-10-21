using SelfServiceCheckout.Application;
using SelfServiceCheckout.Contracts;

namespace SelfServiceCheckout.Api;

internal static class ApiContractMappings
{
    public static PaymentScenario ToApplicationScenario(MockPaymentScenario scenario) => scenario switch
    {
        MockPaymentScenario.Approve => PaymentScenario.Approve,
        MockPaymentScenario.Decline => PaymentScenario.Decline,
        MockPaymentScenario.UnknownAfterApproval => PaymentScenario.UnknownAfterApproval,
        MockPaymentScenario.StillUnknown => PaymentScenario.StillUnknown,
        _ => throw new ArgumentOutOfRangeException(nameof(scenario))
    };

    public static MenuResponse ToResponse(MenuSnapshot menu) => new(
        menu.Version,
        menu.Categories.Select(category => new MenuCategoryDto(
            category.Name,
            category.Items.Select(item => new MenuItemDto(
                item.Id,
                item.Category,
                item.Name,
                item.Description,
                item.PriceCents,
                item.Stock,
                item.IsAvailable,
                item.OptionGroups.Select(group => new MenuItemOptionGroupDto(
                    group.Id,
                    group.Name,
                    group.IsRequired,
                    group.MaximumSelections,
                    group.Options.Select(option => new MenuItemOptionDto(
                        option.Id,
                        option.Name,
                        option.AdditionalPriceCents)).ToArray())).ToArray())).ToArray())).ToArray());

    public static QuoteResponse ToResponse(QuoteSnapshot quote) => new(
        quote.QuoteId,
        quote.ExpiresAtUtc,
        quote.Lines.Select(line => new QuoteLineDto(
            line.ItemId,
            line.Name,
            line.Quantity,
            line.UnitPriceCents,
            line.LineTotalCents,
            line.OptionIds)).ToArray(),
        quote.TotalCents,
        quote.TaxCents,
        quote.Currency);

    public static OrderStatusResponse ToResponse(OrderStatusSnapshot order) => new(
        order.PublicReference,
        order.Status,
        order.PickupNumber,
        order.UpdatedAtUtc,
        order.Message,
        order.Lines.Select(line => new OrderLineStatusDto(
            line.ItemId,
            line.Name,
            line.Quantity,
            line.UnitPriceCents,
            line.LineTotalCents)).ToArray(),
        order.TotalCents,
        order.TaxCents,
        order.Currency);
}
