using Checkout.Domain;
using Xunit;

namespace Checkout.Domain.Tests;

public sealed class CheckoutRulesTests
{
    [Fact]
    public void Normalize_MergesDuplicateLinesAndSortsByItemId()
    {
        CartLine?[] input =
        [
            new("tea", 2),
            new("coffee", 1),
            new("tea", 3)
        ];

        var result = CartRules.Normalize(input);

        Assert.True(result.IsValid);
        Assert.Collection(
            result.Lines,
            line => Assert.Equal(new CartLine("coffee", 1), line),
            line => Assert.Equal(new CartLine("tea", 5), line));
    }

    [Fact(DisplayName = "AC-C3: a line cannot exceed ten units")]
    public void Normalize_RejectsDuplicateLinesThatExceedPerItemLimit()
    {
        CartLine?[] input = [new("tea", 6), new("tea", 5)];

        var result = CartRules.Normalize(input);

        Assert.False(result.IsValid);
        Assert.Equal("CART_LINE", result.ErrorCode);
    }

    [Fact(DisplayName = "AC-M6 SC-B8: cart normalization merges repeated item lines before limits")]
    public void Normalize_MergesLinesWithMatchingOptionsAndRejectsMixedOptions()
    {
        CartLine?[] matchingOptions =
        [
            new("cold-brew", 1, ["large", "oat-milk"]),
            new("cold-brew", 2, ["oat-milk", "large"])
        ];
        CartLine?[] mixedOptions =
        [
            new("cold-brew", 1, ["small"]),
            new("cold-brew", 1, ["large"])
        ];

        var merged = CartRules.Normalize(matchingOptions);
        var mixed = CartRules.Normalize(mixedOptions);

        Assert.True(merged.IsValid);
        Assert.Equal(3, Assert.Single(merged.Lines).Quantity);
        Assert.Equal(new[] { "large", "oat-milk" }, Assert.Single(merged.Lines).OptionIds);
        Assert.False(mixed.IsValid);
        Assert.Equal("CART_OPTIONS", mixed.ErrorCode);
    }

    [Theory(DisplayName = "BR-M5: inclusive tax is informational and rounds half-up")]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(11)]
    public void Normalize_RejectsInvalidQuantity(int? quantity)
    {
        CartLine?[] input = [new("tea", quantity ?? 1)];
        if (quantity is null)
        {
            input[0] = null;
        }

        var result = CartRules.Normalize(input);

        Assert.False(result.IsValid);
        Assert.Equal("CART_LINE", result.ErrorCode);
    }

    [Fact(DisplayName = "AC-C7: cart rejects more than fifteen distinct items")]
    public void Normalize_RejectsTooManyDistinctItems()
    {
        var input = Enumerable.Range(0, CartRules.MaxLines + 1)
            .Select(index => (CartLine?)new CartLine($"item-{index:D2}", 1))
            .ToArray();

        var result = CartRules.Normalize(input);

        Assert.False(result.IsValid);
        Assert.Equal("CART_SIZE", result.ErrorCode);
    }

    [Fact(DisplayName = "AC-C7: cart rejects more than thirty total units")]
    public void Normalize_RejectsTooManyUnitsAcrossLines()
    {
        var input = Enumerable.Range(0, CartRules.MaxLines)
            .Select(index => (CartLine?)new CartLine($"item-{index:D2}", 3))
            .ToArray();

        var result = CartRules.Normalize(input);

        Assert.False(result.IsValid);
        Assert.Equal("CART_UNITS", result.ErrorCode);
    }

    [Theory]
    [InlineData(3, 2_000, 1)]
    [InlineData(100, 800, 7)]
    [InlineData(101, 800, 7)]
    [InlineData(1000, 0, 0)]
    [InlineData(10000, 10000, 5000)]
    public void InclusiveTax_CalculatesTaxIncludedInGrossTotal(long grossCents, int rateBasisPoints, long expectedTaxCents)
    {
        Assert.Equal(expectedTaxCents, InclusiveTax.Calculate(grossCents, rateBasisPoints));
    }

    [Fact]
    public void InclusiveTax_RejectsInvalidInputs()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => InclusiveTax.Calculate(-1, 800));
        Assert.Throws<ArgumentOutOfRangeException>(() => InclusiveTax.Calculate(100, 10_001));
    }

    [Theory]
    [InlineData(OrderStatus.PendingPayment, OrderStatus.Paid, true)]
    [InlineData(OrderStatus.PendingPayment, OrderStatus.PaymentFailed, true)]
    [InlineData(OrderStatus.Paid, OrderStatus.PendingPayment, false)]
    [InlineData(OrderStatus.PaymentFailed, OrderStatus.Paid, false)]
    [InlineData(OrderStatus.Paid, OrderStatus.PaymentFailed, false)]
    public void CanTransition_OnlyAllowsTerminalTransitionFromPending(
        OrderStatus current,
        OrderStatus next,
        bool expected)
    {
        Assert.Equal(expected, OrderTransitions.CanTransition(current, next));
    }
}
