import { expect, test } from "bun:test";
import vectors from "./data/mevcapture-v21/swaps.json";
import {
  createEvmConcentratedCoreSwap, initializeMevCaptureV21, quoteMevCaptureV21,
  snapshotMevCaptureV21, type EvmConcentratedTick,
  type MevCaptureV21PoolState,
} from "../src";
import { fixedSqrtRatioToFloat, toSqrtRatio } from "../src/math/tick";

function integers<T extends Record<string, string>>(x: T): { [K in keyof T]: bigint } {
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, BigInt(v)])) as { [K in keyof T]: bigint };
}

const config = integers(vectors.config);

for (const scenario of vectors.scenarios) {
  test(`merged Core replay: ${scenario.name}`, () => {
    let state = initializeMevCaptureV21(config, BigInt(scenario.initialTick), BigInt(scenario.initTimestamp));
    let pool: MevCaptureV21PoolState = {
      sqrtRatio: fixedSqrtRatioToFloat(toSqrtRatio(Number(scenario.initialTick), "evm")),
      tick: BigInt(scenario.initialTick), liquidity: 0n,
    };
    const ticks = new Map<bigint, bigint>();
    for (const event of scenario.events) {
      const now = BigInt(event.timestamp);
      if (event.type === "position") {
        state = snapshotMevCaptureV21(state, pool.liquidity, now);
        const lower = BigInt(event.tickLower!);
        const upper = BigInt(event.tickUpper!);
        const change = BigInt(event.liquidityDelta!);
        ticks.set(lower, (ticks.get(lower) ?? 0n) + change);
        ticks.set(upper, (ticks.get(upper) ?? 0n) - change);
        if (lower <= pool.tick && pool.tick < upper) pool.liquidity += change;
        continue;
      }
      expect(pool).toEqual(integers(event.poolBefore!));
      expect(state).toEqual(integers(event.stateBefore!));
      const tickList: EvmConcentratedTick[] = [...ticks].map(([tick, liquidityDelta]) => ({ tick, liquidityDelta }));
      const result = quoteMevCaptureV21({
        version: "2.1", poolType: "concentrated", config, state, pool,
        poolFee: BigInt(scenario.poolFee), spacingExp: BigInt(scenario.spacingExp), timestamp: now,
        params: {
          amount: BigInt(event.amount!), isToken1: event.isToken1 === "true",
          sqrtRatioLimit: BigInt(event.sqrtRatioLimit!), minFee: BigInt(event.minFee!), skipAhead: 0n,
        },
        coreSwap: createEvmConcentratedCoreSwap({
          poolFee: BigInt(scenario.poolFee), spacingExp: BigInt(scenario.spacingExp), ticks: tickList, coverage: "complete",
        }),
      });
      expect(result.coreCalls.map(c => ({
        sqrtRatioLimit: c.params.sqrtRatioLimit, minFee: c.params.minFee, amount: c.params.amount,
      }))).toEqual(event.coreCalls!.map(integers));
      expect(result.delta0).toBe(BigInt(event.delta0!));
      expect(result.delta1).toBe(BigInt(event.delta1!));
      const specified = event.isToken1 === "true" ? result.delta1 : result.delta0;
      expect(result.remainingAmount).toBe(BigInt(event.amount!) - specified);
      expect(result.pool).toEqual(integers(event.poolAfter!));
      expect(result.state).toEqual(integers(event.stateAfter!));
      expect(result.firstOfTimestamp).toBe(event.firstOfTimestamp === "true");
      expect(result.gate !== null && !result.gate.passed).toBe(event.gateFailed === "true");
      pool = result.pool;
      state = result.state;
    }
  });
}

test("golden swap coverage is 6 scenarios / 32 swaps / 152 Core calls", () => {
  const swaps = vectors.scenarios.flatMap(s => s.events).filter(e => e.type === "swap");
  expect(vectors.scenarios).toHaveLength(6);
  expect(swaps).toHaveLength(32);
  expect(swaps.reduce((n, s) => n + s.coreCalls!.length, 0)).toBe(152);
});
