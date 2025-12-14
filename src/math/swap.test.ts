import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amountBeforeFee,
  computeFee,
  computeStep,
  isPriceIncreasing,
} from "./swap";
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO } from "./tick";

describe("isPriceIncreasing", () => {
  it("many cases", () => {
    assert.strictEqual(isPriceIncreasing(0n, false), false);
    assert.strictEqual(isPriceIncreasing(1n, false), false);
    assert.strictEqual(isPriceIncreasing(-1n, false), true);
    assert.strictEqual(isPriceIncreasing(0n, true), true);
    assert.strictEqual(isPriceIncreasing(1n, true), true);
    assert.strictEqual(isPriceIncreasing(-1n, true), false);
  });
});

describe("amountBeforeFee", () => {
  it("rounds up", () => {
    assert.strictEqual(amountBeforeFee(105n, (1n << 128n) / 100n), 107n);
  });
});

describe("computeFee", () => {
  it("rounds up", () => {
    assert.strictEqual(computeFee(105n, (1n << 128n) / 100n), 2n);
  });
  it("rounds evenly", () => {
    assert.strictEqual(computeFee(100n, (1n << 128n) / 100n), 1n);
  });
});

describe("computeStep", () => {
  it("zero_amount_token0", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0n,
        amount: 0n,
        isToken1: false,
        fee: 0n,
      }),
      {
        calculatedAmount: 0n,
        consumedAmount: 0n,
        feeAmount: 0n,
        sqrtRatioNext: 340282366920938463463374607431768211456n,
      },
    );
  });
  it("zero_amount_token1", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0n,
        amount: 0n,
        isToken1: true,
        fee: 0n,
      }),
      {
        calculatedAmount: 0n,
        consumedAmount: 0n,
        feeAmount: 0n,
        sqrtRatioNext: 340282366920938463463374607431768211456n,
      },
    );
  });
  it("swap_ratio_equal_limit_token1", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 0x100000000000000000000000000000000n,
        amount: 10000n,
        isToken1: true,
        fee: 0n,
      }),
      {
        calculatedAmount: 0n,
        consumedAmount: 0n,
        feeAmount: 0n,
        sqrtRatioNext: 340282366920938463463374607431768211456n,
      },
    );
  });

  it("max limit token0 input", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MIN_SQRT_RATIO,
        amount: 10000n,
        isToken1: false,
        fee: 1n << 127n,
      }),
      {
        calculatedAmount: 4761n,
        consumedAmount: 10000n,
        feeAmount: 5000n,
        sqrtRatioNext: 324078444686608060441309149935017344244n,
      },
    );
  });

  it("max limit token1 input", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MAX_SQRT_RATIO,
        amount: 10000n,
        isToken1: true,
        fee: 1n << 127n,
      }),
      {
        calculatedAmount: 4761n,
        consumedAmount: 10000n,
        feeAmount: 5000n,
        sqrtRatioNext: 357296485266985386636543337803356622028n,
      },
    );
  });

  it("max limit token0 output", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MAX_SQRT_RATIO,
        amount: -10000n,
        isToken1: false,
        fee: 1n << 127n,
      }),
      {
        calculatedAmount: 22224n,
        consumedAmount: -10000n,
        feeAmount: 11112n,
        sqrtRatioNext: 378091518801042737181527341590853568285n,
      },
    );
  });

  it("max limit token1 output", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: MIN_SQRT_RATIO,
        amount: -10000n,
        isToken1: true,
        fee: 1n << 127n,
      }),
      {
        calculatedAmount: 22224n,
        consumedAmount: -10000n,
        feeAmount: 11112n,
        sqrtRatioNext: 306254130228844617117037146688591390310n,
      },
    );
  });

  it("limited token0 output", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 359186942860990600322450974511310889870n,
        amount: -10000n,
        isToken1: false,
        fee: 1n << 127n,
      }),
      {
        calculatedAmount: 11112n,
        consumedAmount: -5263n,
        feeAmount: 5556n,
        sqrtRatioNext: 359186942860990600322450974511310889870n,
      },
    );
  });

  it("limited token1 output", () => {
    assert.deepStrictEqual(
      computeStep({
        sqrtRatio: 0x100000000000000000000000000000000n,
        liquidity: 100000n,
        sqrtRatioLimit: 323268248574891540290205877060179800883n,
        amount: -10000n,
        isToken1: true,
        fee: 1n << 127n,
      }),
      {
        calculatedAmount: 10528n,
        consumedAmount: -5000n,
        feeAmount: 5264n,
        sqrtRatioNext: 323268248574891540290205877060179800883n,
      },
    );
  });
});
