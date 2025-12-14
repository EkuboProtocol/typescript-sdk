import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  amountsFromSpecifiedAmount,
  liquidityToAmountBase,
  liquidityToAmountQuote,
  maxLiquidityForBaseToken,
  maxLiquidityForQuoteToken,
  maxLiquidityForSpecifiedAmount,
  maxLiquidityForTokenAmounts,
} from "./liquidity";
import { MAX_TICK, MIN_TICK, toSqrtRatio } from "./tick";

const MAX_AMOUNT = (1n << 128n) - 1n;

describe("maxLiquidityForBaseToken", () => {
  it("half range", () => {
    const liquidity = maxLiquidityForBaseToken({
      sqrtPriceLower: toSqrtRatio(MIN_TICK),
      sqrtPriceUpper: toSqrtRatio(0),
      amount: MAX_AMOUNT,
    });
    assert.strictEqual(liquidity, 18447191164202170525n);
  });

  it("full range", () => {
    const liquidity = maxLiquidityForBaseToken({
      sqrtPriceLower: toSqrtRatio(MIN_TICK),
      sqrtPriceUpper: toSqrtRatio(MAX_TICK),
      amount: MAX_AMOUNT,
    });
    assert.strictEqual(liquidity, 18447191164202170524n);
  });
});

describe("maxLiquidityForQuoteToken", () => {
  it("half range", () => {
    const liquidity = maxLiquidityForQuoteToken({
      sqrtPriceLower: toSqrtRatio(0),
      sqrtPriceUpper: toSqrtRatio(MAX_TICK),
      amount: MAX_AMOUNT,
    });
    assert.strictEqual(liquidity, 18447191164202170527n);
  });

  it("full range", () => {
    const liquidity = maxLiquidityForQuoteToken({
      sqrtPriceLower: toSqrtRatio(MIN_TICK),
      sqrtPriceUpper: toSqrtRatio(MAX_TICK),
      amount: MAX_AMOUNT,
    });
    assert.strictEqual(liquidity, 18447191164202170526n);
  });
});

describe("maxLiquidityForTokenAmounts", () => {
  it("chooses minimum liquidity between tokens mid-range", () => {
    const sqrtPriceLower = toSqrtRatio(-1000);
    const sqrtPriceUpper = toSqrtRatio(1000);
    const sqrtPrice = toSqrtRatio(0);
    const amountBase = 1_000_000n;
    const amountQuote = 1_000_000n;
    const liquidity = maxLiquidityForTokenAmounts({
      sqrtPrice,
      sqrtPriceLower,
      sqrtPriceUpper,
      amountBase,
      amountQuote,
    });

    const liquidityFromBase = maxLiquidityForBaseToken({
      sqrtPriceLower: sqrtPrice,
      sqrtPriceUpper,
      amount: amountBase,
    });
    const liquidityFromQuote = maxLiquidityForQuoteToken({
      sqrtPriceLower,
      sqrtPriceUpper: sqrtPrice,
      amount: amountQuote,
    });
    const expected = liquidityFromBase < liquidityFromQuote ? liquidityFromBase : liquidityFromQuote;
    assert.strictEqual(liquidity, expected);

    const baseRequired = liquidityToAmountBase({
      sqrtPriceLower,
      sqrtPriceUpper: sqrtPrice,
      liquidity,
    });
    const quoteRequired = liquidityToAmountQuote({
      sqrtPriceLower: sqrtPrice,
      sqrtPriceUpper,
      liquidity,
    });

  });
});

describe("maxLiquidityForSpecifiedAmount", () => {
  it("base provided below range", () => {
    const liq = maxLiquidityForSpecifiedAmount({
      sqrtPrice: toSqrtRatio(MIN_TICK),
      sqrtPriceLower: toSqrtRatio(0),
      sqrtPriceUpper: toSqrtRatio(MAX_TICK),
      amount: { base: 1_000_000n },
    });
    assert(liq > 0n);
  });

  it("quote provided above range", () => {
    const liq = maxLiquidityForSpecifiedAmount({
      sqrtPrice: toSqrtRatio(MAX_TICK),
      sqrtPriceLower: toSqrtRatio(MIN_TICK),
      sqrtPriceUpper: toSqrtRatio(0),
      amount: { quote: 1_000_000n },
    });
    assert(liq > 0n);
  });
});

describe("amountsFromSpecifiedAmount", () => {
  it("base specified mid-range returns consistent deltas", () => {
    const sqrtPriceLower = toSqrtRatio(-5000);
    const sqrtPriceUpper = toSqrtRatio(5000);
    const sqrtPrice = toSqrtRatio(0);
    const amountBase = 1_000_000n;

    const { maxLiquidity, base, quote } = amountsFromSpecifiedAmount({
      sqrtPrice,
      sqrtPriceLower,
      sqrtPriceUpper,
      amount: { base: amountBase },
    });

    assert.strictEqual(base, amountBase);
    const requiredQuote = liquidityToAmountQuote({
      liquidity: maxLiquidity,
      sqrtPriceLower: sqrtPrice,
      sqrtPriceUpper,
    });
    assert.strictEqual(quote, requiredQuote);
  });

  it("quote specified mid-range returns consistent deltas", () => {
    const sqrtPriceLower = toSqrtRatio(-5000);
    const sqrtPriceUpper = toSqrtRatio(5000);
    const sqrtPrice = toSqrtRatio(0);
    const amountQuote = 5_000_000n;

    const { maxLiquidity, base, quote } = amountsFromSpecifiedAmount({
      sqrtPrice,
      sqrtPriceLower,
      sqrtPriceUpper,
      amount: { quote: amountQuote },
    });

    assert.strictEqual(quote, amountQuote);
    const requiredBase = liquidityToAmountBase({
      liquidity: maxLiquidity,
      sqrtPriceLower,
      sqrtPriceUpper: sqrtPrice,
    });
    assert.strictEqual(base, requiredBase);
  });
});
