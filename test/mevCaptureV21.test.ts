import { describe, expect, test } from "bun:test";
import anchors from "./data/mevcapture-v21/anchorUpdates.json";
import gates from "./data/mevcapture-v21/gateScenarios.json";
import schedules from "./data/mevcapture-v21/schedules.json";
import {
  initializeMevCaptureV21, mevCaptureV21ConfigFromTuple, mevCaptureV21StateFromTuple,
  refreshMevCaptureV21, snapshotMevCaptureV21, updateMevCaptureV21Anchor,
  validateMevCaptureV21Config, type MevCaptureV21State,
  mevCaptureV21CandidateSegment, mevCaptureV21Segment, mevCaptureV21TowardTick,
  nextMevCaptureV21Segment,
} from "../src";
import { mevCaptureExp2 } from "../src/math/mevCaptureExp2";
import { fixedSqrtRatioToFloat, toSqrtRatio } from "../src/math/tick";

function integers<T extends Record<string, string>>(x: T): { [K in keyof T]: bigint } {
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, BigInt(v)])) as { [K in keyof T]: bigint };
}

const config = integers(anchors.config);

describe("MEVCapture v2.1 rev 6 contract vectors", () => {
  test("120 anchor updates: every field and gate result", () => {
    expect(anchors.anchorUpdates).toHaveLength(120);
    for (const row of anchors.anchorUpdates) {
      const result = updateMevCaptureV21Anchor(config, integers(row.stateIn), BigInt(row.tick), BigInt(row.liquidity), BigInt(row.timestamp));
      expect(result.first).toBe(true);
      expect(result.gate).toEqual({ passed: row.passed, lObs: BigInt(row.lObs), eRef: BigInt(row.eRef) });
      expect(result.state).toEqual(integers(row.expected));
    }
  });

  test("24 gate scenarios / 1785 sequential steps including rev6 Q1", () => {
    expect(gates.gateScenarios).toHaveLength(24);
    let steps = 0;
    for (const scenario of gates.gateScenarios) {
      let state: MevCaptureV21State = integers(scenario.initial);
      for (const row of scenario.steps) {
        const now = BigInt(row.timestamp);
        if (row.op === "position") {
          state = snapshotMevCaptureV21(state, BigInt(row.activeLiquidity), now);
        } else {
          const result = updateMevCaptureV21Anchor(config, state, BigInt(row.tick), BigInt(row.liquidity), now);
          expect(result.first).toBe(row.first);
          if (row.first) expect(result.gate).toEqual({ passed: row.passed, lObs: BigInt(row.lObs), eRef: BigInt(row.eRef) });
          else expect(result.gate).toBeNull();
          state = refreshMevCaptureV21(config, result.state, BigInt(row.liquidityAfter), now);
        }
        expect(state).toEqual(integers(row.expected));
        steps++;
      }
    }
    expect(steps).toBe(1785);
    expect(gates.gateScenarios.filter(x => x.name.startsWith("q1_")).length).toBeGreaterThan(0);
  });

  test("288 schedules: candidate, midpoint fee, boundaries, toward rounding", () => {
    expect(schedules.schedules).toHaveLength(288);
    for (const row of schedules.schedules) {
      const jLin = BigInt(row.jLin);
      const input = {
        config: { ...config, jLin, maxSegments: jLin + 24n },
        anchorX16: BigInt(row.anchorX16), increasing: row.increasing,
        poolFee: BigInt(row.poolFee), spacingExp: BigInt(row.spacingExp),
      };
      expect(mevCaptureV21CandidateSegment(input, BigInt(row.coreTick))).toBe(BigInt(row.segments[0]!.k));
      expect(mevCaptureV21TowardTick(input.anchorX16, input.increasing)).toBe(BigInt(row.towardTick));
      for (const segment of row.segments) {
        expect(mevCaptureV21Segment(input, BigInt(segment.k))).toEqual(integers(segment));
      }
    }
  });
});

describe("MEVCapture v2.1 validation and edge cases", () => {
  test("config/anchor tuples preserve ABI order; nondefaults have no fallback", () => {
    const custom = mevCaptureV21ConfigFromTuple([300n, 1n, 8n, 64n, 10000n, 42n, 16n, 88n]);
    const state = initializeMevCaptureV21(custom, -17n, (1n << 32n) + 5n);
    expect(state.lastUpdateTime).toBe(5n);
    expect(state.lRefRaiseTime).toBe((1n << 32n) - 295n);
    expect(mevCaptureV21StateFromTuple([5n, 5n, 0n, 0n, 0n, state.lRefRaiseTime, -17n << 16n])).toEqual(state);
    const result = updateMevCaptureV21Anchor(custom, state, 1000000n, 1n << 127n, 305n);
    expect(result.state.anchorX16).toBe(25n << 16n);
    expect(result.state.lRefBits).toBe(1n);
  });

  test("uint32 elapsed wraps; same timestamp emits no gate", () => {
    const state = initializeMevCaptureV21(config, 0n, (1n << 32n) - 60n);
    const result = updateMevCaptureV21Anchor(config, state, 10000n, 1n, 60n);
    expect(result.state.anchorX16).toBe(2500n << 16n);
    expect(result.state.lRefRaiseTime).toBe(60n);
    expect(updateMevCaptureV21Anchor(config, result.state, 0n, 0n, 60n).gate).toBeNull();
  });

  test("snapshot is immutable within timestamp, suppresses refresh", () => {
    const state = snapshotMevCaptureV21(initializeMevCaptureV21(config, 0n, 1n), 0n, 2n);
    expect(snapshotMevCaptureV21(state, 1n << 127n, 2n)).toEqual(state);
    expect(refreshMevCaptureV21(config, state, 1n << 127n, 2n)).toEqual(state);
  });

  test("exp2 integer, half and near-one fractional inputs; reject overflow", () => {
    expect(mevCaptureExp2(0n)).toBe(1n << 64n);
    expect(mevCaptureExp2(1n << 64n)).toBe(2n << 64n);
    expect(mevCaptureExp2(1n << 63n)).toBe(26087635650665564424n);
    expect(mevCaptureExp2((1n << 64n) - 1n)).toBe((2n << 64n) - 2n);
    expect(() => mevCaptureExp2(-1n)).toThrow();
    expect(() => mevCaptureExp2(64n << 64n)).toThrow();
  });

  test("sqrt-ratio membership skips an exact decreasing boundary", () => {
    const input = { config, anchorX16: 0n, increasing: false, poolFee: 196n, spacingExp: 12n };
    const ratio = fixedSqrtRatioToFloat(toSqrtRatio(-4096, "evm"));
    expect(mevCaptureV21CandidateSegment(input, -4097n)).toBe(2n);
    expect(nextMevCaptureV21Segment(input, ratio).k).toBe(2n);
    // Even a misleading tick hint cannot make actual price membership use segment 1.
    expect(mevCaptureV21CandidateSegment(input, -4096n)).toBe(1n);
    expect(nextMevCaptureV21Segment(input, ratio).fee).toBe(784n);
  });

  test("invalid and unsupported inputs fail rather than guessing defaults", () => {
    expect(() => validateMevCaptureV21Config({ ...config, halfLife: 0n })).toThrow("halfLife");
    expect(() => validateMevCaptureV21Config({ ...config, maxSegments: 41n })).toThrow("maxSegments");
    expect(() => snapshotMevCaptureV21(initializeMevCaptureV21(config, 0n, 1n), 1n << 128n, 2n)).toThrow("liquidity");
    expect(() => initializeMevCaptureV21(config, 88722836n, 1n)).toThrow("tick");
    expect(() => mevCaptureV21Segment({ config, anchorX16: 0n, increasing: true, poolFee: 0n, spacingExp: 12n }, 1n)).toThrow("pool fee");
  });
});
