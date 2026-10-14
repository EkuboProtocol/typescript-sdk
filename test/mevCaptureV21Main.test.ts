// Differential replay of the MEVCapture v2.1 `main` contract traces, ported from
// rust-sdk `tests/mev_capture_v21_main_vectors.rs`. Every Core call, surcharge,
// total and final state must match with no tolerance.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isValidMevCaptureV21MainSqrtRatio,
  MevCaptureV21MainModel,
  MevCaptureV21MainPool,
  predSqrtRatio,
  sqrtRatioFromRaw,
  sqrtRatioToRaw,
  succSqrtRatio,
  type MevCaptureV21MainAnchor,
  type MevCaptureV21MainConfig,
  type MevCaptureV21MainCoreState,
  type MevCaptureV21MainTick,
} from "../src";

const DATA = join(import.meta.dir, "data", "mevcapture-v21-main");
const read = (name: string) => readFileSync(join(DATA, name));
const json = (name: string) => JSON.parse(read(name).toString("utf8"));

// rust-sdk main 622e31b, tests/data/mevcapture-v21-main/SHA256SUMS
const RUST_SDK_SHA256: Record<string, string> = {
  "anchorUpdates.json":
    "386c4083e39526b8b175ea579b24429c0df679185dcf22283c8eea8a3a65aa59",
  "gateScenarios.json":
    "db05764df2d8c4e36088058b92ec39ad2076581315e5da83187f8ee0b05fcaad",
  "v21-main-quoter-vectors.json":
    "3dee8af33d1624e39a7e36ae51fc1d247fa87904caf7281877910589ebbc19b5",
};

const S = 4096;
const L66 = 1n << 66n;

// Parsed fixture JSON; every field is checked by value in the assertions.
type Json = any;

/**
 * Positions minted by the contract test that produced each vector
 * (`test_vectors_*` in `test/extensions/MEVCaptureV21Rules.t.sol`).
 */
const WIDE: [number, number, bigint] = [-40 * S, 40 * S, L66];
const POSITIONS: Record<string, [number, number, bigint][]> = {};
const layout = (names: string[], positions: [number, number, bigint][]) => {
  for (const name of names) POSITIONS[name] = positions;
};
layout(
  [
    "inc_exact_in_cut_bridge_rate",
    "dec_toward_then_away_exact_in",
    "inc_exact_out_after_anchor_update",
    "dec_exact_out_partial",
    "inc_exact_in_partial_mid_segment",
  ],
  [WIDE, [3 * S, 7 * S, L66], [-7 * S, -3 * S, L66]],
);
layout(
  [
    "exact_tick_state_dec_from_tick_T",
    "inc_through_T_toward_uncut",
    "dec_onto_T_tick_T_minus_1",
    "exact_tick_state_inc_from_tick_T_minus_1",
    "dec_onto_T_again",
    "fee_only_1_wei_exact_in_at_T",
  ],
  [WIDE, [3 * S, 7 * S, L66]],
);
layout(
  [
    "bridge_25pct_exact_in",
    "bridge_25pct_exact_out_dec",
    "bridge_1ulp_exact_in",
  ],
  [WIDE, [2 * S, 3 * S, L66]],
);
layout(
  ["empty_words_skip0", "return_toward_skip0", "empty_words_skip3"],
  [
    [-S, S, L66],
    [1000 * S, 1001 * S, L66],
  ],
);
layout(
  ["cap_tail_to_max"],
  [
    [-20_000 * S, 20_000 * S, 1n << 40n],
    [3000 * S, 3001 * S, 1_000_000_000n],
  ],
);
layout(
  ["segexp2_offgrid_ticks_inc"],
  [WIDE, [3 * S, 7 * S, L66 * 2n], [8 * S, 9 * S, L66]],
);
layout(
  ["spacing3000_negative_anchor_dec", "spacing3000_negative_anchor_inc"],
  [
    [-200 * 3000, 100 * 3000, L66],
    [-50 * 3000, -30 * 3000, L66],
  ],
);

function ticks(name: string): MevCaptureV21MainTick[] {
  const positions = POSITIONS[name];
  if (!positions) throw new Error(`no position layout for ${name}`);
  const net = new Map<number, bigint>();
  for (const [lo, hi, l] of positions) {
    net.set(lo, (net.get(lo) ?? 0n) + l);
    net.set(hi, (net.get(hi) ?? 0n) - l);
  }
  return [...net.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, liquidityDelta]) => ({ index, liquidityDelta }));
}

const coreState = (v: Json): MevCaptureV21MainCoreState => ({
  sqrtRatio: sqrtRatioFromRaw(BigInt(v.sqrtRatio)),
  tick: Number(v.tick),
  liquidity: BigInt(v.liquidity),
});

const vectorConfig = (c: Json): MevCaptureV21MainConfig => ({
  halfLife: Number(c.tau),
  slopeK: Number(c.slopeK),
  segmentExp: Number(c.segExp),
  jLin: Number(c.jLin),
  maxFee: BigInt(c.maxFee),
  clampTicks: Number(c.clampTicks),
  mGate: Number(c.mGate),
});

function pool(v: Json): MevCaptureV21MainPool {
  const config = vectorConfig(v.cfg);
  const core = coreState(v.before);
  return new MevCaptureV21MainPool({
    poolFee: BigInt(v.pool.fee),
    tickSpacing: Number(v.pool.tickSpacing),
    config,
    state: {
      core,
      anchor: new MevCaptureV21MainModel(config).initialize(core.tick, 1),
    },
    sortedTicks: ticks(v.name),
  });
}

function vectors(): Json[] {
  const v = json("v21-main-quoter-vectors.json");
  expect(v.branch).toBe("eku-1582/mevcapture-v21-main");
  return v.vectors;
}

describe("MEVCapture v2.1 main fixtures", () => {
  test("match the rust-sdk copy byte for byte", () => {
    const sums = read("SHA256SUMS").toString("utf8").trim().split("\n");
    expect(sums.length).toBe(3);
    for (const line of sums) {
      const [sum, name] = line.split(/\s+/);
      expect(RUST_SDK_SHA256[name]).toBe(sum);
      expect(createHash("sha256").update(read(name)).digest("hex")).toBe(sum);
    }
  });
});

describe("MEVCapture v2.1 main contract vectors", () => {
  test("replay every Core call exactly", () => {
    const all = vectors();
    expect(all.length).toBe(21);
    let callsChecked = 0;
    const coverage = { exactIn: 0, exactOut: 0, token0: 0, token1: 0, skip: 0 };
    for (const v of all) {
      const p = v.params;
      const params = {
        isToken1: p.isToken1 as boolean,
        amount: BigInt(p.amount),
        sqrtRatioLimit: sqrtRatioFromRaw(BigInt(p.sqrtRatioLimit)),
        skipAhead: Number(p.skipAhead),
      };
      coverage[params.amount < 0n ? "exactOut" : "exactIn"]++;
      coverage[params.isToken1 ? "token1" : "token0"]++;
      if (params.skipAhead !== 0) coverage.skip++;
      const swap = pool(v).swapThroughSegments(
        coreState(v.before),
        params,
        BigInt(v.anchorX16),
      );

      const actual = swap.calls.map((c) => ({
        limit: sqrtRatioToRaw(c.sqrtRatioLimit),
        amount: c.amount,
        kind: c.kind.kind,
        surcharge: c.kind.kind === "charged" ? c.kind.surcharge : 0n,
        before: c.stateBefore,
        after: c.stateAfter,
        delta0: c.delta0,
        delta1: c.delta1,
        fee0: c.surcharge0,
        fee1: c.surcharge1,
      }));
      const expected = (v.calls as Json[]).map((e) => ({
        limit: BigInt(e.limit),
        amount: BigInt(e.amount),
        kind: e.kind,
        surcharge: BigInt(e.surcharge),
        before: coreState(e.before),
        after: coreState(e.after),
        delta0: BigInt(e.delta0),
        delta1: BigInt(e.delta1),
        fee0: BigInt(e.fee0),
        fee1: BigInt(e.fee1),
      }));
      expect({ name: v.name, calls: actual }).toEqual({
        name: v.name,
        calls: expected,
      });
      callsChecked += actual.length;

      expect({
        name: v.name,
        delta0: swap.delta0,
        delta1: swap.delta1,
        after: swap.stateAfter.core,
      }).toEqual({
        name: v.name,
        delta0: BigInt(v.total.delta0),
        delta1: BigInt(v.total.delta1),
        after: coreState(v.after),
      });
      const sum = swap.calls.reduce(
        (s, c) => s + c.surcharge0 + c.surcharge1,
        0n,
      );
      expect(swap.surcharge0 + swap.surcharge1).toBe(sum);
    }
    expect(callsChecked).toBe(266);
    for (const n of Object.values(coverage)) expect(n).toBeGreaterThan(0);
  });

  // Every charged call with a nonzero fee is one `FeesAccumulated` event on the
  // calculated token; bridges and toward calls never are.
  test("surcharge events match charged calls", () => {
    for (const v of vectors()) {
      for (const e of v.calls as Json[]) {
        const [f0, f1] = [BigInt(e.fee0), BigInt(e.fee1)];
        if (e.kind !== "charged") expect(f0 + f1).toBe(0n);
        expect(v.params.isToken1 ? f1 : f0).toBe(0n);
      }
    }
  });

  test("pred and succ cross regions", () => {
    for (const raw of [
      (1n << 94n) | (1n << 62n),
      (2n << 94n) | (1n << 62n),
      (3n << 94n) | (1n << 62n),
      1n << 63n,
    ]) {
      const x = sqrtRatioFromRaw(raw);
      expect(succSqrtRatio(predSqrtRatio(x))).toBe(x);
      expect(predSqrtRatio(x) < x).toBe(true);
      expect(isValidMevCaptureV21MainSqrtRatio(predSqrtRatio(x))).toBe(true);
      expect(succSqrtRatio(x) > x).toBe(true);
      expect(isValidMevCaptureV21MainSqrtRatio(succSqrtRatio(x))).toBe(true);
      expect(sqrtRatioToRaw(x)).toBe(raw);
    }
  });

  // `quote` runs the first-touch anchor update before the segments and the refresh after.
  test("quote runs the anchor update, then the segments", () => {
    const v = vectors().find((x) => x.name === "inc_exact_in_cut_bridge_rate");
    const p = pool(v);
    const amount = 1_000_000_000_000_000_000n;
    const quote = (now: number) => p.quote({ isToken1: true, amount, now });
    // same timestamp as initialization: no update, anchor at the initial tick (0)
    const same = quote(1);
    const direct = p.swapThroughSegments(
      p.state.core,
      { isToken1: true, amount },
      0n,
    );
    expect(same.consumedAmount).toBe(direct.delta1);
    expect(same.calculatedAmount).toBe(-direct.delta0);
    expect(same.resources.anchorUpdates).toBe(0);
    expect(direct.surcharge0 > 0n).toBe(true);
    // a later timestamp runs the gate (passes: lObs 67 + mGate >= eRef 0)
    const later = quote(13);
    expect(later.resources.anchorUpdates).toBe(1);
    expect(later.stateAfter.anchor.lastUpdateTime).toBe(13);
  });
});

const anchor = (v: Json): MevCaptureV21MainAnchor => ({
  lastUpdateTime: Number(v.lastUpdateTime),
  lRefTime: Number(v.lRefTime),
  lastPosTime: Number(v.lastPosTime),
  lRefBits: Number(v.lRefBits),
  snapBits: Number(v.snapBits),
  lRefRaiseTime: Number(v.lRefRaiseTime),
  anchorX16: BigInt(v.anchorX16),
});

const anchorModel = (c: Json) =>
  new MevCaptureV21MainModel({
    halfLife: Number(c.halfLife),
    slopeK: Number(c.slopeK),
    segmentExp: Number(c.segmentExp),
    jLin: Number(c.jLin),
    // the `next` tuple's Q0.16 maxFee; the anchor update does not read it
    maxFee: BigInt(c.maxFee) << 48n,
    clampTicks: Number(c.clampTicks),
    mGate: Number(c.mGate),
  });

describe("MEVCapture v2.1 main anchor state machine", () => {
  // `_refresh` and `beforeUpdatePosition` are identical between the `main`
  // extension and the merged `next` one (`da368348`). `_anchorUpdate` differs
  // only in the movement allowance, which `main` rounds up (EKU-1582 `17b5e50`,
  // V12 F-13) where `next` floors. Cases whose `next` move was bound by a
  // fractional floored allowance must move exactly one more unit; every other
  // case and field replays unchanged.
  test("anchor updates replay all seven fields with the F-13 ceiling", () => {
    const v = json("anchorUpdates.json");
    const m = anchorModel(v.config);
    expect(v.anchorUpdates.length).toBe(120);
    const halfLife = BigInt(m.config.halfLife);
    const clamp = BigInt(m.config.clampTicks);
    let roundedUp = 0;
    (v.anchorUpdates as Json[]).forEach((c, i) => {
      const stateIn = anchor(c.stateIn);
      const expected = anchor(c.expected);
      const now = Number(c.timestamp);
      const elapsed = BigInt((now - stateIn.lastUpdateTime) >>> 0);
      const dt = elapsed < halfLife ? elapsed : halfLife;
      const floored = ((clamp << 16n) * dt) / halfLife;
      const nextMove = expected.anchorX16 - stateIn.anchorX16;
      const absMove = nextMove < 0n ? -nextMove : nextMove;
      if (
        c.passed &&
        ((clamp << 16n) * dt) % halfLife !== 0n &&
        absMove === floored
      ) {
        // the `next` limit bound this move; on `main` the limit is one unit larger
        expected.anchorX16 += nextMove < 0n ? -1n : 1n;
        roundedUp++;
      }
      const state = { ...stateIn };
      const gate = m.beforeSwap(
        state,
        Number(c.tick),
        BigInt(c.liquidity),
        now,
      );
      expect({ i, gate, state }).toEqual({
        i,
        gate: { passed: c.passed, lObs: Number(c.lObs), eRef: Number(c.eRef) },
        state: expected,
      });
    });
    expect(roundedUp).toBeGreaterThan(0);
  });

  test("gate scenarios replay every step", () => {
    const v = json("gateScenarios.json");
    const m = anchorModel(v.config);
    let count = 0;
    for (const c of v.gateScenarios as Json[]) {
      const state = anchor(c.initial);
      (c.steps as Json[]).forEach((st, i) => {
        const now = Number(st.timestamp);
        if (st.op === "position") {
          m.beforePosition(state, BigInt(st.activeLiquidity), now);
        } else {
          const gate = m.beforeSwap(
            state,
            Number(st.tick),
            BigInt(st.liquidity),
            now,
          );
          expect(gate !== null).toBe(st.first);
          if (gate) {
            expect(gate).toEqual({
              passed: st.passed,
              lObs: Number(st.lObs),
              eRef: Number(st.eRef),
            });
          }
          m.afterSwap(state, BigInt(st.liquidityAfter), now);
        }
        expect({ scenario: c.name, i, state }).toEqual({
          scenario: c.name,
          i,
          state: anchor(st.expected),
        });
        count++;
      });
    }
    expect(count).toBe(1785);
  });

  // Initialized at tick 0 at time 0 with the gate open; the callers push the pool tick away.
  const displaced = (): MevCaptureV21MainAnchor => ({
    lastUpdateTime: 0,
    lRefTime: 0,
    lastPosTime: 0,
    lRefBits: 0,
    snapBits: 0,
    lRefRaiseTime: 0,
    anchorX16: 0n,
  });
  const clampModel = (halfLife: number, clampTicks: number) =>
    new MevCaptureV21MainModel({
      halfLife,
      slopeK: 4,
      segmentExp: 0,
      jLin: 16,
      maxFee: 1n << 63n,
      clampTicks,
      mGate: 3,
    });
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

  // Ports `test_f13_zero_amount_forwards_every_second_cannot_freeze_anchor`:
  // with CLAMP_TICKS = 1 and HALF_LIFE = 2^20 each per-second update grants one
  // unit, and a single update over the same 32 s grants ceil(2^16 * 32 / 2^20) = 2.
  test("F-13: per-second updates cannot freeze the anchor", () => {
    const m = clampModel(1 << 20, 1);
    const touched = displaced();
    for (let i = 1; i <= 32; i++) {
      m.beforeSwap(touched, 1000, L66, i);
      expect(touched.lastUpdateTime).toBe(i);
      expect(touched.anchorX16).toBe(BigInt(i));
    }
    const single = displaced();
    m.beforeSwap(single, 1000, L66, 32);
    expect(single.anchorX16).toBe(2n);
  });

  // Ports `test_park_with_dust_allowance_rounds_up`.
  test("F-13: dust allowance rounds up", () => {
    const m = clampModel(120, 2500);
    const state = displaced();
    m.beforeSwap(state, 1_000_000, L66, 7);
    expect(state.anchorX16).toBe(ceilDiv((2500n << 16n) * 7n, 120n));
  });

  // Ports `test_fuzz_frequent_updates_never_slow_anchor` over a deterministic grid.
  test("F-13: frequent updates never slow the anchor", () => {
    for (const tau of [1, 2, 3, 7, 120, 1000, 65_537, 1 << 20]) {
      for (const clamp of [1, 2, 5, 2500, 4096]) {
        for (const n of [1, 2, 17, 48]) {
          const m = clampModel(tau, clamp);
          const tick = 70 * clamp + 128;
          const units = BigInt(clamp) << 16n;
          const tau64 = BigInt(tau);
          const N = BigInt(n);
          const touched = displaced();
          for (let t = 1; t <= n; t++) m.beforeSwap(touched, tick, L66, t);
          expect(touched.anchorX16).toBe(N * ceilDiv(units, tau64));
          const single = displaced();
          m.beforeSwap(single, tick, L66, n);
          expect(single.anchorX16).toBe(
            ceilDiv(units * (N < tau64 ? N : tau64), tau64),
          );
          expect(touched.anchorX16 >= single.anchorX16).toBe(true);
          expect(touched.anchorX16 * tau64 <= N * units + N * tau64).toBe(true);
        }
      }
    }
  });
});
