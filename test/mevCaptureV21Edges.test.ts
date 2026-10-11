import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import source from "./data/mevcapture-v21/source.json";
import mergedAbi from "./data/mevcapture-v21/merged-abi.json";
import {
  MEV_CAPTURE_V21_ABI, createEvmConcentratedCoreSwap,
  initializeMevCaptureV21, mevCaptureV21ConfigFromTuple, mevCaptureV21Segment,
  quoteMevCaptureV21, type MevCaptureV21CoreSwap, type MevCaptureV21QuoteInput,
} from "../src";
import { fixedSqrtRatioToFloat, toSqrtRatio } from "../src/math/tick";

const config = mevCaptureV21ConfigFromTuple([300n, 1n, 2n, 2n, 10000n, 42n, 0n, 26n]);
const ticks = [{ tick: -8000n, liquidityDelta: 1n << 64n }, { tick: 8000n, liquidityDelta: -(1n << 64n) }];
const poolFee = 100n;
const spacingExp = 3n;
const ratio = (tick: number) => fixedSqrtRatioToFloat(toSqrtRatio(tick, "evm"));
const coreSwap = createEvmConcentratedCoreSwap({ poolFee, spacingExp, ticks, coverage: "complete" });

function input(): MevCaptureV21QuoteInput {
  return {
    version: "2.1", poolType: "concentrated", config,
    state: { ...initializeMevCaptureV21(config, 10n, 1000n), anchorX16: (10n << 16n) + 32768n },
    pool: { sqrtRatio: ratio(0), tick: 0n, liquidity: 1n << 64n },
    poolFee, spacingExp, timestamp: 1000n,
    params: { amount: 1n << 100n, isToken1: true, minFee: 700n, sqrtRatioLimit: ratio(32), skipAhead: 0n },
    coreSwap,
  };
}

test("all five handoff files retain authoritative SHA-256 hashes", async () => {
  for (const [file, hash] of Object.entries(source.sha256)) {
    const bytes = await Bun.file(new URL(`data/mevcapture-v21/${file}`, import.meta.url)).arrayBuffer();
    expect(createHash("sha256").update(new Uint8Array(bytes)).digest("hex")).toBe(hash);
  }
});

test("read/event ABI matches merged contract including indexed poolId", () => {
  const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (key, value) => key === "internalType" ? undefined : value));
  for (const entry of MEV_CAPTURE_V21_ABI) {
    expect(strip(entry)).toEqual(strip(mergedAbi.find(x => x.type === entry.type && "name" in x && x.name === entry.name)));
  }
});

test("nondefault geometry: fractional first segment, doubled widths, rounded fees", () => {
  const i = input();
  const s = { config, anchorX16: i.state.anchorX16, increasing: true, poolFee, spacingExp };
  expect([1n, 2n, 3n, 4n].map(k => mevCaptureV21Segment(s, k).hiTick)).toEqual([32n, 64n, 128n, 256n]);
  expect([1n, 2n, 3n, 4n].map(k => mevCaptureV21Segment(s, k).fee)).toEqual([168n, 335n, 635n, 1235n]);
});

test("nondefault quote with N1 sliver and caller minFee matches independent two-call replay", () => {
  const i = input();
  const before = structuredClone({ config: i.config, state: i.state, pool: i.pool, params: i.params });
  const toward = coreSwap(i.pool, { ...i.params, sqrtRatioLimit: ratio(10) });
  const away = coreSwap(toward.pool, { ...i.params, amount: i.params.amount - toward.delta1, sqrtRatioLimit: ratio(32) });
  const q = quoteMevCaptureV21(i);
  expect(q.coreCalls).toHaveLength(2);
  expect(q.coreCalls.map(c => c.params.minFee)).toEqual([700n, 700n]);
  expect(q.delta0).toBe(toward.delta0 + away.delta0);
  expect(q.delta1).toBe(toward.delta1 + away.delta1);
  expect(q.pool).toEqual(away.pool);
  expect(q.remainingAmount).toBe(i.params.amount - toward.delta1 - away.delta1);
  expect({ config: i.config, state: i.state, pool: i.pool, params: i.params }).toEqual(before);
});

test("caller minimum above schedule cap is not clipped", () => {
  const i = input();
  i.state.anchorX16 = 0n;
  i.params.minFee = 65535n;
  const q = quoteMevCaptureV21(i);
  expect(q.coreCalls.map(c => c.params.minFee)).toEqual([65535n]);
  expect(q.delta1).toBeGreaterThan(0n);
});

test("zero amount and equal price-limit swaps preserve original Core call", () => {
  const i = input();
  i.params.amount = 0n;
  const q = quoteMevCaptureV21(i);
  expect(q.coreCalls).toHaveLength(1);
  expect(q.coreCalls[0]!.params).toEqual(i.params);
  expect(q.delta0).toBe(0n);
  expect(q.delta1).toBe(0n);
  i.params.amount = 1n;
  i.params.sqrtRatioLimit = i.pool.sqrtRatio;
  expect(quoteMevCaptureV21(i).coreCalls[0]!.params).toEqual(i.params);
});

test("user limit before rounded anchor stays one toward call", () => {
  const i = input();
  i.params.sqrtRatioLimit = ratio(5);
  expect(quoteMevCaptureV21(i).coreCalls.map(c => c.params.sqrtRatioLimit)).toEqual([ratio(5)]);
});

test("worst-case configuration budget reaches schedule cap", () => {
  for (const jLin of [1n, 16n, 64n]) {
    for (const segmentExp of [0n, 8n]) {
      for (const anchorX16 of [-1n, 0n, 65535n]) {
        const c = { ...config, jLin, segmentExp, maxSegments: jLin + 24n, maxFee: 32768n, slopeK: 1n };
        for (const increasing of [false, true]) {
          expect(mevCaptureV21Segment({ config: c, anchorX16, increasing, poolFee: 1n, spacingExp: 0n }, c.maxSegments).fee).toBe(32768n);
        }
      }
    }
  }
});

test("skipAhead traverses multiple bitmap words without losing initialized ticks", () => {
  const i = input();
  i.params.sqrtRatioLimit = ratio(10000);
  const normal = quoteMevCaptureV21(i);
  i.params.skipAhead = 32767n;
  const skipped = quoteMevCaptureV21(i);
  // Empty bitmap-word stops can cause rounding differences; use actual state/deltas.
  expect(skipped.pool).toEqual(normal.pool);
  expect(skipped.coreCalls.every(c => c.params.skipAhead === 32767n)).toBe(true);
});

test("unsupported, incomplete and inconsistent inputs fail closed", () => {
  expect(() => quoteMevCaptureV21({ ...input(), version: "1" } as unknown as MevCaptureV21QuoteInput)).toThrow("unsupported");
  expect(() => quoteMevCaptureV21({ ...input(), poolType: "stableswap" } as unknown as MevCaptureV21QuoteInput)).toThrow("unsupported");
  expect(() => quoteMevCaptureV21({ ...input(), coreSwap: undefined } as unknown as MevCaptureV21QuoteInput)).toThrow("missing Core");
  expect(() => createEvmConcentratedCoreSwap({ poolFee, spacingExp, ticks, coverage: "partial" } as never)).toThrow("incomplete");
  const i = input();
  i.pool.liquidity += 1n;
  expect(() => quoteMevCaptureV21(i)).toThrow("inconsistent");
});

test("bad fees, limits, spacing and initialized ticks are rejected", () => {
  const i = input();
  expect(() => quoteMevCaptureV21({ ...i, poolFee: config.maxFee })).toThrow("pool fee");
  expect(() => quoteMevCaptureV21({ ...i, spacingExp: 20n })).toThrow("spacingExp");
  expect(() => quoteMevCaptureV21({ ...i, params: { ...i.params, sqrtRatioLimit: ratio(-1) } })).toThrow("direction");
  expect(() => quoteMevCaptureV21({ ...i, params: { ...i.params, sqrtRatioLimit: 1n } })).toThrow("compact sqrt");
  expect(() => quoteMevCaptureV21({ ...i, params: { ...i.params, skipAhead: 32768n } })).toThrow("skipAhead");
  expect(() => createEvmConcentratedCoreSwap({ poolFee, spacingExp, coverage: "complete", ticks: [...ticks, ticks[0]!] })).toThrow("duplicate");
  expect(() => createEvmConcentratedCoreSwap({ poolFee, spacingExp, coverage: "complete", ticks: [{ tick: 1n, liquidityDelta: 1n }] })).toThrow("initialized tick");
});

test("int128 accumulation overflow returns no partial quote", () => {
  const i = input();
  let calls = 0;
  const overflowing: MevCaptureV21CoreSwap = (pool, params) => ({
    delta0: calls++ === 0 ? (1n << 127n) - 1n : 1n,
    delta1: 1n,
    pool: { ...pool, sqrtRatio: params.sqrtRatioLimit, tick: 10n },
  });
  expect(() => quoteMevCaptureV21({ ...i, coreSwap: overflowing })).toThrow("int128 overflow");
  expect(calls).toBe(2);
});

test("runtime Number fields are rejected, never converted approximately", () => {
  const i = input();
  expect(() => quoteMevCaptureV21({ ...i, params: { ...i.params, amount: Number.MAX_SAFE_INTEGER + 1 } } as unknown as MevCaptureV21QuoteInput)).toThrow("bigint");
  expect(() => quoteMevCaptureV21({ ...i, config: { ...config, halfLife: 300 } } as unknown as MevCaptureV21QuoteInput)).toThrow("halfLife");
  expect(() => createEvmConcentratedCoreSwap({ poolFee: 100, spacingExp, ticks, coverage: "complete" } as never)).toThrow("bigint");
});
