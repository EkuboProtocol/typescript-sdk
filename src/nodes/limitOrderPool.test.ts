import { toSqrtRatio } from "../math";
import { LIMIT_ORDER_TICK_SPACING, LimitOrderPool } from "./limitOrderPool";
import { describe, expect, it } from "vitest";

describe("LimitOrderPool", () => {
  it("should handle swap one for zero partial", () => {
    const liquidity = 10000000n;

    const pool = new LimitOrderPool({
      token0: 0n,
      token1: 1n,
      tickSpacing: LIMIT_ORDER_TICK_SPACING,
      fee: 0n,
      sqrtRatio: toSqrtRatio(0),
      liquidity,
      tick: 0,
      sortedTicks: [
        {
          tick: 0,
          liquidityDelta: liquidity,
        },
        {
          tick: LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
      ],
    });

    const result = pool.quote({
      sqrtRatioLimit: undefined,
      tokenAmount: {
        amount: 10000n,
        token: 1n,
      },
      meta: { block: { number: 1, time: 2 } },
    });

    expect(result.feesPaid).toEqual(0n);
    expect(result.stateAfter.tickIndicesReached).toEqual([0, 1]);
    expect(result.consumedAmount).toEqual(641n);
    expect(result.calculatedAmount).toEqual(639n);
    expect(result.executionResources.ordersPulled).toEqual(1);
    expect(
      result.executionResources.basePoolResources.initializedTicksCrossed
    ).toEqual(1);
    expect(
      result.executionResources.basePoolResources.noOverridePriceChange,
    ).toEqual(1);
    expect(
      result.executionResources.basePoolResources.tickSpacingsCrossed
    ).toEqual(693147);
  });

  it("should handle swap one for zero crossing multiple ticks", () => {
    const liquidity = 10000000n;
    const pool = new LimitOrderPool({
      token0: 0n,
      token1: 1n,
      tickSpacing: LIMIT_ORDER_TICK_SPACING,
      fee: 0n,
      sqrtRatio: toSqrtRatio(0),
      liquidity,
      tick: 0,
      sortedTicks: [
        {
          tick: 0,
          liquidityDelta: liquidity,
        },
        {
          tick: LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
        {
          tick: LIMIT_ORDER_TICK_SPACING * 2,
          liquidityDelta: liquidity,
        },
        {
          tick: LIMIT_ORDER_TICK_SPACING * 3,
          liquidityDelta: -liquidity,
        },
      ],
    });

    const result = pool.quote({
      sqrtRatioLimit: undefined,
      tokenAmount: {
        amount: 1000n,
        token: 1n,
      },
      meta: null,
    });
    expect(result.feesPaid).toEqual(0n);
    expect(result.stateAfter.tickIndicesReached).toEqual([0, 2]);
    expect(result.consumedAmount).toEqual(1000n);
    expect(result.calculatedAmount).toEqual(997n);
    expect(result.executionResources.ordersPulled).toEqual(1);
    expect(
      result.executionResources.basePoolResources.initializedTicksCrossed
    ).toEqual(2);
    expect(
      result.executionResources.basePoolResources.noOverridePriceChange,
    ).toEqual(1);
    expect(
      result.executionResources.basePoolResources.tickSpacingsCrossed
    ).toEqual(2);
  });

  it("should only allow order sell token0 for token1 to be executed once", () => {
    const liquidity = 10000000n;
    const pool = new LimitOrderPool({
      token0: 0n,
      token1: 1n,
      tickSpacing: LIMIT_ORDER_TICK_SPACING,
      fee: 0n,
      sqrtRatio: toSqrtRatio(0),
      liquidity,
      tick: 0,
      sortedTicks: [
        {
          tick: 0,
          liquidityDelta: liquidity,
        },
        {
          tick: LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
      ],
    });

    const quote0 = pool.quote({
      sqrtRatioLimit: toSqrtRatio(LIMIT_ORDER_TICK_SPACING),
      tokenAmount: {
        amount: 1000n,
        token: 1n,
      },
      meta: null,
    });
    expect(quote0.stateAfter.basePoolState.activeTickIndex).toBe(1);
    expect(quote0.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(LIMIT_ORDER_TICK_SPACING)
    );
    expect(quote0.stateAfter.tickIndicesReached).toEqual([0, 1]);
    expect(quote0.executionResources.ordersPulled).toBe(1);

    const quote1 = pool.quote({
      overrideState: quote0.stateAfter,
      sqrtRatioLimit: toSqrtRatio(0),
      tokenAmount: {
        amount: 1000n,
        token: 0n,
      },
      meta: null,
    });

    const quote2 = pool.quote({
      overrideState: quote1.stateAfter,
      sqrtRatioLimit: toSqrtRatio(LIMIT_ORDER_TICK_SPACING),
      tokenAmount: {
        amount: 1000n,
        token: 1n,
      },
      meta: null,
    });
    expect(quote1.consumedAmount).toEqual(0n);
    expect(quote1.calculatedAmount).toEqual(0n);
    expect(quote2.consumedAmount).toEqual(0n);
    expect(quote2.calculatedAmount).toEqual(0n);
    expect(quote2.stateAfter.basePoolState.activeTickIndex).toBe(1);
    expect(quote2.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(LIMIT_ORDER_TICK_SPACING)
    );
    expect(quote2.stateAfter.tickIndicesReached).toEqual([0, 1]);
    expect(quote2.executionResources.ordersPulled).toBe(0);
  });

  it("should only allow order sell token1 for token0 to be executed once", () => {
    const liquidity = 10000000n;
    const pool = new LimitOrderPool({
      token0: 0n,
      token1: 1n,
      tickSpacing: LIMIT_ORDER_TICK_SPACING,
      fee: 0n,
      sqrtRatio: toSqrtRatio(LIMIT_ORDER_TICK_SPACING * 2),
      liquidity: 0n,
      tick: LIMIT_ORDER_TICK_SPACING * 2,
      sortedTicks: [
        {
          tick: LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        {
          tick: LIMIT_ORDER_TICK_SPACING * 2,
          liquidityDelta: -liquidity,
        },
      ],
    });

    const quote0 = pool.quote({
      sqrtRatioLimit: toSqrtRatio(LIMIT_ORDER_TICK_SPACING),
      tokenAmount: {
        amount: 1000n,
        token: 0n,
      },
      meta: null,
    });
    expect(quote0.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(LIMIT_ORDER_TICK_SPACING)
    );
    expect(quote0.stateAfter.basePoolState.activeTickIndex).toBeNull();
    expect(quote0.stateAfter.tickIndicesReached).toEqual([null, 1]);
    expect(quote0.executionResources.ordersPulled).toBe(1);

    const quote1 = pool.quote({
      overrideState: quote0.stateAfter,
      sqrtRatioLimit: toSqrtRatio(LIMIT_ORDER_TICK_SPACING * 2),
      tokenAmount: {
        amount: 1000n,
        token: 1n,
      },
      meta: null,
    });

    const quote2 = pool.quote({
      overrideState: quote1.stateAfter,
      sqrtRatioLimit: toSqrtRatio(LIMIT_ORDER_TICK_SPACING),
      tokenAmount: {
        amount: 1000n,
        token: 0n,
      },
      meta: null,
    });
    expect(quote1.consumedAmount).toEqual(0n);
    expect(quote1.calculatedAmount).toEqual(0n);
    expect(quote1.stateAfter.tickIndicesReached).toEqual([null, 1]);
    expect(quote1.stateAfter.basePoolState.liquidity).toEqual(0n);
    expect(quote1.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(LIMIT_ORDER_TICK_SPACING * 2)
    );
    expect(quote2.consumedAmount).toEqual(0n);
    expect(quote2.calculatedAmount).toEqual(0n);
  });

  it("should handle complex pool scenario", () => {
    const liquidity = 10000000n;
    const pool = new LimitOrderPool({
      token0: 0n,
      token1: 1n,
      tickSpacing: LIMIT_ORDER_TICK_SPACING,
      fee: 0n,
      sqrtRatio: toSqrtRatio(0),
      liquidity: liquidity,
      tick: 0,
      sortedTicks: [
        // order to sell token1 at tick -3
        {
          tick: -3 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        {
          tick: -2 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
        // order to sell token1 at tick -1
        {
          tick: -1 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        // -1 to 0 is canceled out with 0 to 1
        {
          tick: 0,
          liquidityDelta: 0n,
        },
        {
          tick: 1 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
        {
          tick: 4 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        {
          tick: 5 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
      ],
    });

    const quote0 = pool.quote({
      sqrtRatioLimit: toSqrtRatio(
        Math.floor((LIMIT_ORDER_TICK_SPACING * 9) / 2)
      ),
      tokenAmount: {
        amount: 1000000n,
        token: 1n,
      },
      meta: null,
    });

    expect(quote0.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(Math.floor((LIMIT_ORDER_TICK_SPACING * 9) / 2))
    );
    // Gets through the first order and then halfway through the second order
    expect(quote0.consumedAmount).toEqual(962n);
    expect(quote0.calculatedAmount).toEqual(958n);
    expect(quote0.stateAfter.basePoolState.activeTickIndex).toBe(5);
    expect(quote0.stateAfter.tickIndicesReached).toEqual([3, 5]);

    const quote1 = pool.quote({
      overrideState: quote0.stateAfter,
      sqrtRatioLimit: toSqrtRatio(
        Math.floor((LIMIT_ORDER_TICK_SPACING * -5) / 2)
      ),
      tokenAmount: {
        amount: 1000000n,
        token: 0n,
      },
      meta: null,
    });
    expect(quote1.stateAfter.tickIndicesReached).toEqual([0, 5]);
    expect(quote1.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(Math.floor((LIMIT_ORDER_TICK_SPACING * -5) / 2))
    );
    expect(quote1.consumedAmount).toEqual(1282n);
    expect(quote1.calculatedAmount).toEqual(1278n);

    const quote2 = pool.quote({
      overrideState: quote1.stateAfter,
      sqrtRatioLimit: toSqrtRatio(
        Math.floor((LIMIT_ORDER_TICK_SPACING * 9) / 2)
      ),
      tokenAmount: {
        amount: 1000000n,
        token: 1n,
      },
      meta: null,
    });
    expect(quote2.stateAfter.tickIndicesReached).toEqual([0, 5]);
    expect(quote2.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(Math.floor((LIMIT_ORDER_TICK_SPACING * 9) / 2))
    );
    // This should be ~1 order, half from -2.5 to -2 and half from 4 to 4.5
    expect(quote2.consumedAmount).toEqual(641n);
    expect(quote2.calculatedAmount).toEqual(639n);
  });

  it("should handle complex pool scenario in reverse order", () => {
    const liquidity = 10000000n;
    const pool = new LimitOrderPool({
      token0: 0n,
      token1: 1n,
      tickSpacing: LIMIT_ORDER_TICK_SPACING,
      fee: 0n,
      sqrtRatio: toSqrtRatio(0),
      liquidity: liquidity,
      tick: 0,
      sortedTicks: [
        // order to sell token1 at tick -3
        {
          tick: -3 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        {
          tick: -2 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
        // order to sell token1 at tick -1
        {
          tick: -1 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        // -1 to 0 is canceled out with 0 to 1
        {
          tick: 0,
          liquidityDelta: 0n,
        },
        {
          tick: 1 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
        {
          tick: 4 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: liquidity,
        },
        {
          tick: 5 * LIMIT_ORDER_TICK_SPACING,
          liquidityDelta: -liquidity,
        },
      ],
    });

    const quote0 = pool.quote({
      sqrtRatioLimit: toSqrtRatio(
        Math.floor((LIMIT_ORDER_TICK_SPACING * -5) / 2)
      ),
      tokenAmount: {
        amount: 1000000n,
        token: 0n,
      },
      meta: null,
    });
    expect(quote0.stateAfter.tickIndicesReached).toEqual([0, 3]);
    expect(quote0.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(Math.floor((LIMIT_ORDER_TICK_SPACING * -5) / 2))
    );
    expect(quote0.consumedAmount).toEqual(962n);
    expect(quote0.calculatedAmount).toEqual(958n);

    const quote1 = pool.quote({
      overrideState: quote0.stateAfter,
      sqrtRatioLimit: toSqrtRatio(
        Math.floor((LIMIT_ORDER_TICK_SPACING * 9) / 2)
      ),
      tokenAmount: {
        amount: 1000000n,
        token: 1n,
      },
      meta: null,
    });

    expect(quote1.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(Math.floor((LIMIT_ORDER_TICK_SPACING * 9) / 2))
    );
    expect(quote1.consumedAmount).toEqual(1282n);
    expect(quote1.calculatedAmount).toEqual(1278n);
    expect(quote1.stateAfter.basePoolState.activeTickIndex).toBe(5);
    expect(quote1.stateAfter.tickIndicesReached).toEqual([0, 5]);

    const quote2 = pool.quote({
      overrideState: quote1.stateAfter,
      sqrtRatioLimit: toSqrtRatio(
        Math.floor((LIMIT_ORDER_TICK_SPACING * -5) / 2)
      ),
      tokenAmount: {
        amount: 1000000n,
        token: 0n,
      },
      meta: null,
    });

    expect(quote2.stateAfter.basePoolState.sqrtRatio).toEqual(
      toSqrtRatio(Math.floor((LIMIT_ORDER_TICK_SPACING * -5) / 2))
    );
    expect(quote2.consumedAmount).toEqual(641n);
    expect(quote2.calculatedAmount).toEqual(639n);
    expect(quote2.stateAfter.basePoolState.activeTickIndex).toBe(0);
    expect(quote2.stateAfter.tickIndicesReached).toEqual([0, 5]);
  });
});
