import { amount0Delta, amount1Delta } from "./delta";

const Q128 = 1n << 128n;

function orderBounds(a: bigint, b: bigint): [bigint, bigint] {
  return a < b ? [a, b] : [b, a];
}

export function maxLiquidityForBaseToken({
  sqrtPriceLower,
  sqrtPriceUpper,
  amount,
}: {
  amount: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
}): bigint {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);
  if (amount === 0n || lower === upper) return 0n;
  return (amount * lower * upper) / (upper - lower) / Q128;
}

export function maxLiquidityForQuoteToken({
  sqrtPriceLower,
  sqrtPriceUpper,
  amount,
}: {
  amount: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
}): bigint {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);
  if (amount === 0n || lower === upper) return 0n;
  return (amount * Q128) / (upper - lower);
}

export function maxLiquidityForTokenAmounts({
  sqrtPrice,
  sqrtPriceLower,
  sqrtPriceUpper,
  amountBase,
  amountQuote,
}: {
  sqrtPrice: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
  amountBase: bigint;
  amountQuote: bigint;
}): bigint {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);

  if (sqrtPrice <= lower) {
    return maxLiquidityForBaseToken({ sqrtPriceLower: lower, sqrtPriceUpper: upper, amount: amountBase });
  } else if (sqrtPrice < upper) {
    const liquidityBase = maxLiquidityForBaseToken({
      sqrtPriceLower: sqrtPrice,
      sqrtPriceUpper: upper,
      amount: amountBase,
    });
    const liquidityQuote = maxLiquidityForQuoteToken({
      sqrtPriceLower: lower,
      sqrtPriceUpper: sqrtPrice,
      amount: amountQuote,
    });
    return liquidityBase < liquidityQuote ? liquidityBase : liquidityQuote;
  } else {
    return maxLiquidityForQuoteToken({ sqrtPriceLower: lower, sqrtPriceUpper: upper, amount: amountQuote });
  }
}

export function liquidityToAmountBase({
  sqrtPriceLower,
  sqrtPriceUpper,
  liquidity,
}: {
  liquidity: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
}): bigint {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);
  return amount0Delta(lower, upper, liquidity, false);
}

export function liquidityToAmountQuote({
  sqrtPriceLower,
  sqrtPriceUpper,
  liquidity,
}: {
  liquidity: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
}): bigint {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);
  return amount1Delta(lower, upper, liquidity, false);
}

export function maxLiquidityForSpecifiedAmount({
  sqrtPrice,
  sqrtPriceUpper,
  sqrtPriceLower,
  amount,
}: {
  amount: { base: bigint } | { quote: bigint };
  sqrtPrice: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
}): bigint {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);

  if (sqrtPrice <= lower) {
    return "base" in amount
      ? maxLiquidityForBaseToken({ sqrtPriceLower: lower, sqrtPriceUpper: upper, amount: amount.base })
      : 0n;
  } else if (sqrtPrice < upper) {
    return "base" in amount
      ? maxLiquidityForBaseToken({ sqrtPriceLower: sqrtPrice, sqrtPriceUpper: upper, amount: amount.base })
      : maxLiquidityForQuoteToken({ sqrtPriceLower: lower, sqrtPriceUpper: sqrtPrice, amount: amount.quote });
  } else {
    return "quote" in amount
      ? maxLiquidityForQuoteToken({ sqrtPriceLower: lower, sqrtPriceUpper: upper, amount: amount.quote })
      : 0n;
  }
}

export function amountsFromSpecifiedAmount({
  sqrtPrice,
  sqrtPriceUpper,
  sqrtPriceLower,
  amount,
}: {
  amount: { base: bigint } | { quote: bigint };
  sqrtPrice: bigint;
  sqrtPriceLower: bigint;
  sqrtPriceUpper: bigint;
}): { base: bigint; quote: bigint; maxLiquidity: bigint } {
  const [lower, upper] = orderBounds(sqrtPriceLower, sqrtPriceUpper);
  const maxLiquidity = maxLiquidityForSpecifiedAmount({
    sqrtPrice,
    sqrtPriceLower: lower,
    sqrtPriceUpper: upper,
    amount,
  });

  if ("base" in amount) {
    if (sqrtPrice < lower) {
      return {
        maxLiquidity,
        base: amount.base,
        quote: liquidityToAmountQuote({ liquidity: maxLiquidity, sqrtPriceLower: lower, sqrtPriceUpper: upper }),
      };
    } else if (sqrtPrice < upper) {
      return {
        maxLiquidity,
        base: amount.base,
        quote: liquidityToAmountQuote({ liquidity: maxLiquidity, sqrtPriceLower: sqrtPrice, sqrtPriceUpper: upper }),
      };
    } else {
      return { maxLiquidity, base: amount.base, quote: 0n };
    }
  } else {
    if (sqrtPrice < lower) {
      return { maxLiquidity, quote: amount.quote, base: 0n };
    } else if (sqrtPrice < upper) {
      return {
        maxLiquidity,
        quote: amount.quote,
        base: liquidityToAmountBase({ liquidity: maxLiquidity, sqrtPriceLower: lower, sqrtPriceUpper: sqrtPrice }),
      };
    } else {
      return {
        maxLiquidity,
        quote: amount.quote,
        base: liquidityToAmountBase({ liquidity: maxLiquidity, sqrtPriceLower: lower, sqrtPriceUpper: upper }),
      };
    }
  }
}
