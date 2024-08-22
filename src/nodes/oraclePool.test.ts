import { toSqrtRatio } from "../math/tick";
import { OraclePool } from "./oraclePool";

import { describe, expect, it } from "vitest";
import { MAX_BOUND_USABLE_TICK_MAGNITUDE } from "./twammPool";

function toSortedTicks(liquidity: bigint) {
  return [
    { tick: -MAX_BOUND_USABLE_TICK_MAGNITUDE, liquidityDelta: liquidity },
    { tick: MAX_BOUND_USABLE_TICK_MAGNITUDE, liquidityDelta: -liquidity },
  ];
}

describe("oraclePool", () => {
  describe("quote", () => {
    it("quote token0", () => {
      const pool = new OraclePool({
        token0: 0n,
        token1: 1n,
        sqrtRatio: toSqrtRatio(1),
        liquidity: 1000000000n,
        tick: 0,
        extension: 1n,
        sortedTicks: toSortedTicks(1000000000n),
        lastSnapshotTime: 0n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        tokenAmount: {
          amount: 1000n,
          token: 0n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(calculatedAmount).toMatchSnapshot();
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.snapshotUpdated).toEqual(true);
    });

    it("quote production example", () => {
      const pool = new OraclePool({
        token0: 0n,
        token1: 1n,
        sqrtRatio: 20685032069219899469794685553443565n,
        liquidity: 1825741529166n,
        tick: -19416252,
        extension: 1n,
        sortedTicks: toSortedTicks(1825741529166n),
        lastSnapshotTime: 0n,
      });

      const baseQuote = pool.basePool.quote({
        tokenAmount: {
          amount: 10n ** 6n,
          token: 1n,
        },
        meta: { block: { number: 1, time: 32 } },
      });

      expect(
        pool.quote({
          tokenAmount: {
            amount: 10n ** 6n,
            token: 1n,
          },
          meta: { block: { number: 1, time: 32 } },
        })
      ).toEqual({
        ...baseQuote,
        executionResources: {
          ...baseQuote.executionResources,
          snapshotUpdated: true,
        },
        stateAfter: { ...baseQuote.stateAfter, lastSnapshotTime: 32n },
      });
    });
  });
});
