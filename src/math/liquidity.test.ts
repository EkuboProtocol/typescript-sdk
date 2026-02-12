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
import {
  EVM_MAX_TICK,
  EVM_MIN_TICK,
  STARKNET_MAX_TICK,
  STARKNET_MIN_TICK,
  toSqrtRatio,
} from "./tick";

const MAX_AMOUNT = (1n << 128n) - 1n;

const CHAIN_CASES = [
  {
    chain: "evm",
    minTick: EVM_MIN_TICK,
    maxTick: EVM_MAX_TICK,
    expected: {
      baseHalf: 18447191164202170525n,
      baseFull: 18447191164202170524n,
      quoteHalf: 18447191164202170527n,
      quoteFull: 18447191164202170526n,
    },
  },
  {
    chain: "starknet",
    minTick: STARKNET_MIN_TICK,
    maxTick: STARKNET_MAX_TICK,
    expected: {
      baseHalf: 18446748437148339062n,
      baseFull: 18446748437148339061n,
      quoteHalf: 18446748437148339062n,
      quoteFull: 18446748437148339061n,
    },
  },
] as const;

describe("maxLiquidityForBaseToken", () => {
  for (const { chain, minTick, maxTick, expected } of CHAIN_CASES) {
    it(`${chain}: half range`, () => {
      const liquidity = maxLiquidityForBaseToken({
        sqrtPriceLower: toSqrtRatio(minTick, chain),
        sqrtPriceUpper: toSqrtRatio(0, chain),
        amount: MAX_AMOUNT,
      });
      assert.strictEqual(liquidity, expected.baseHalf);
    });

    it(`${chain}: full range`, () => {
      const liquidity = maxLiquidityForBaseToken({
        sqrtPriceLower: toSqrtRatio(minTick, chain),
        sqrtPriceUpper: toSqrtRatio(maxTick, chain),
        amount: MAX_AMOUNT,
      });
      assert.strictEqual(liquidity, expected.baseFull);
    });
  }
});

describe("maxLiquidityForQuoteToken", () => {
  for (const { chain, minTick, maxTick, expected } of CHAIN_CASES) {
    it(`${chain}: half range`, () => {
      const liquidity = maxLiquidityForQuoteToken({
        sqrtPriceLower: toSqrtRatio(0, chain),
        sqrtPriceUpper: toSqrtRatio(maxTick, chain),
        amount: MAX_AMOUNT,
      });
      assert.strictEqual(liquidity, expected.quoteHalf);
    });

    it(`${chain}: full range`, () => {
      const liquidity = maxLiquidityForQuoteToken({
        sqrtPriceLower: toSqrtRatio(minTick, chain),
        sqrtPriceUpper: toSqrtRatio(maxTick, chain),
        amount: MAX_AMOUNT,
      });
      assert.strictEqual(liquidity, expected.quoteFull);
    });
  }
});

describe("maxLiquidityForTokenAmounts", () => {
  for (const { chain } of CHAIN_CASES) {
    it(`${chain}: chooses minimum liquidity between tokens mid-range`, () => {
      const sqrtPriceLower = toSqrtRatio(-1000, chain);
      const sqrtPriceUpper = toSqrtRatio(1000, chain);
      const sqrtPrice = toSqrtRatio(0, chain);
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
  }
});

describe("maxLiquidityForSpecifiedAmount", () => {
  for (const { chain, minTick, maxTick } of CHAIN_CASES) {
    it(`${chain}: base provided below range`, () => {
      const liq = maxLiquidityForSpecifiedAmount({
        sqrtPrice: toSqrtRatio(minTick, chain),
        sqrtPriceLower: toSqrtRatio(0, chain),
        sqrtPriceUpper: toSqrtRatio(maxTick, chain),
        amount: { base: 1_000_000n },
      });
      assert(liq > 0n);
    });

    it(`${chain}: quote provided above range`, () => {
      const liq = maxLiquidityForSpecifiedAmount({
        sqrtPrice: toSqrtRatio(maxTick, chain),
        sqrtPriceLower: toSqrtRatio(minTick, chain),
        sqrtPriceUpper: toSqrtRatio(0, chain),
        amount: { quote: 1_000_000n },
      });
      assert(liq > 0n);
    });
  }
});

describe("amountsFromSpecifiedAmount", () => {
  for (const { chain } of CHAIN_CASES) {
    it(`${chain}: base specified mid-range returns consistent deltas`, () => {
      const sqrtPriceLower = toSqrtRatio(-5000, chain);
      const sqrtPriceUpper = toSqrtRatio(5000, chain);
      const sqrtPrice = toSqrtRatio(0, chain);
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

    it(`${chain}: quote specified mid-range returns consistent deltas`, () => {
      const sqrtPriceLower = toSqrtRatio(-5000, chain);
      const sqrtPriceUpper = toSqrtRatio(5000, chain);
      const sqrtPrice = toSqrtRatio(0, chain);
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
  }
});
