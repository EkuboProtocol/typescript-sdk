# MEVCapture v2.1 (rev 6)

Implementation under [EKU-1576](/EKU/issues/EKU-1576), parent
[EKU-1023](/EKU/issues/EKU-1023), board origin [EKU-946](/EKU/issues/EKU-946).
Reference: merged contract `da368348238a46857d39b6db57bdb2b432c979df`, design
revision `ad3e6585-8135-431e-82af-7a177d7f5282` (rev 6). This is an unsigned,
pure quote model, not a deployment, publish, activation, or monitoring claim.

## Routing and units

- Explicitly route a known extension/version to `quoteMevCaptureV21`. A generic
  MEV flag is insufficient. No extension addresses or config defaults are shipped.
- Existing SDK math/protocol APIs are unchanged. Do not send v1 pools through this
  model. v1 surcharge/saved-balances semantics are different.
- All v2.1 numeric inputs/outputs are `bigint`. Fees are **0.16**, anchor is signed
  **Q48.16**, times wrap to uint32, and sqrt ratios are **raw compact uint96**.
  The old `computeStep` API uses Q128 fees/fixed prices and is not a substitute.
- Config, anchor, Core state, and the COMPLETE initialized-tick snapshot must be
  read at the same pinned block. Refresh the snapshot after position mutations.
  Zero-net ticks with nonzero gross liquidity remain initialized and must be kept.

## Read contract config/state, then quote

`MEV_CAPTURE_V21_ABI` exposes `getConfig`, `getAnchor`, and the indexed-poolId
`AnchorGateFailed` event. For a viem-style client, whose small integers decode as
numbers, convert them to bigint explicitly (all ABI small ints fit safely):

```ts
import {
  MEV_CAPTURE_V21_ABI,
  mevCaptureV21ConfigFromTuple,
  mevCaptureV21StateFromTuple,
  createEvmConcentratedCoreSwap,
  quoteMevCaptureV21,
} from "@ekubo/sdk";

// extension, poolId and blockNumber come from the caller's verified pool identity.
const c = await client.readContract({
  address: extension, abi: MEV_CAPTURE_V21_ABI,
  functionName: "getConfig", blockNumber,
});
const a = await client.readContract({
  address: extension, abi: MEV_CAPTURE_V21_ABI,
  functionName: "getAnchor", args: [poolId], blockNumber,
});
const config = mevCaptureV21ConfigFromTuple([
  BigInt(c.halfLife), BigInt(c.slopeK), BigInt(c.segmentExp), BigInt(c.jLin),
  BigInt(c.maxFee), BigInt(c.clampTicks), BigInt(c.mGate), BigInt(c.maxSegments),
]);
const state = mevCaptureV21StateFromTuple([
  BigInt(a[0]), BigInt(a[1]), BigInt(a[2]), BigInt(a[3]),
  BigInt(a[4]), BigInt(a[5]), a[6],
]);

// pool = { sqrtRatio, tick, liquidity }; ticks = [{ tick, liquidityDelta }, ...].
// All are fetched at blockNumber; coverage is an explicit completeness assertion.
const coreSwap = createEvmConcentratedCoreSwap({
  poolFee, spacingExp, ticks, coverage: "complete",
});
const quote = quoteMevCaptureV21({
  version: "2.1", poolType: "concentrated", config, state, pool,
  poolFee, spacingExp, timestamp: quoteTimestamp,
  params: { amount, isToken1, sqrtRatioLimit: 0n, minFee: 0n, skipAhead: 0n },
  coreSwap,
});
// quote.delta0 / delta1 are signed Core token deltas; positive = input.
// remainingAmount can be nonzero at the user's limit or an empty pool.
// Persist quote.pool and quote.state only in the local simulated journey.
```

`coreSwap` may instead be a caller's exact pure Core simulator with the same
typed contract. The supplied Core model handles price, tick, active liquidity,
bitmap-word traversal/skipAhead, token deltas and compact-price rounding; it does
not calculate LP fee-growth storage, position fees, gas, or v1 side effects.
No RPC requests, wallet calls or transaction submission occur in these functions.

## Position changes and sequential quotes

Before changing liquidity in a simulated timestamp, call
`snapshotMevCaptureV21(state, activeLiquidityBeforeChange, timestamp)`, then update
the Core state and complete tick snapshot. The first snapshot is retained for
the whole timestamp, including position changes after a swap. Pass each quote's
returned state/pool into the next quote. `quoteMevCaptureV21` performs the
first-of-timestamp anchor update and the post-swap reference refresh itself.

`gate` is null for a same-timestamp swap, otherwise `{ passed, lObs, eRef }`.
A failed gate corresponds to one `AnchorGateFailed` event. Q1 pass restoration
uses `max(eRef, min(stored lRefBits, lObs))` BEFORE the capped H1 raise. Failure
does not restore or reset the reference clock. A post-swap refresh can separately
raise the decayed reference if no position changed in that timestamp.

## Schedule and call trace

Toward travel uses one call to the rounded anchor (floor from below, ceil from
above), or the nearer user limit, without spending away-call budget. Its raw
Core minFee is the caller minFee; Core makes the effective fee at least poolFee.
The N1 sliver then pays the first away fee using the exact fractional anchor.
Away membership is selected by compact sqrt ratio, not Core's asymmetric tick.
Widths double after jLin. The remaining path merges at the schedule cap or final
budget call. Caller minFee can exceed the schedule cap: it is not clipped.

`coreCalls` includes rebuilt parameters (remaining amount, raw minFee, raw limit,
skipAhead) and each result. `mevCaptureV21Segment` exposes exact grid/fee geometry;
`mevCaptureV21CandidateSegment` exposes only a tick-based candidate for diagnostics,
not executable membership. Use `nextMevCaptureV21Segment` for price membership.

## Invalid / unsupported states

- `RangeError`: invalid config, integer/range errors, invalid compact ratio,
  zero poolFee or poolFee >= maxFee, spacing exponent outside 0..19, wrong limit
  direction, invalid initialized ticks, int128 sums/amounts or uint128 overflow.
- `Error`: unsupported version or stableswap, missing Core simulator, incomplete
  tick coverage, inconsistent active liquidity, or a nonterminating Core adapter.
- Partial tick snapshots are **not** interpreted as empty ranges. The caller must
  not label a partial dataset complete. Snapshot completeness/identity is the
  backend's responsibility; active-liquidity consistency checks cannot prove it.
- No mutating input state; errors return no partial quote. Decimal-string JSON
  must be parsed to bigint, and JSON outputs need a bigint-aware serializer.

## Verification

`bun run lint`, `bunx tsc --noEmit`, and `bun test`. Golden files and SHA-256 pins
are in `test/data/mevcapture-v21/`; stale rev5 labels are preserved for provenance.
Replay covers 120 anchor updates, 24 gate scenarios / 1785 steps (including Q1),
288 schedules, six sequential swap scenarios / 32 swaps / 152 Core calls. Swap
tests compute Core results from position events, not from expected deltas, and
compare both token deltas, remaining amounts, every call's amount/fee/limit, all
three Core pool fields and all seven anchor fields. Local parity does not imply
parent/service/indexer integration acceptance or a live extension.
