import type { Hex } from "./evmPoolKey";
import { amountBeforeFee, computeFee } from "./math/swap";

const UINT24_MAX = (1n << 24n) - 1n;
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT112_MAX = (1n << 112n) - 1n;
const UINT192_MASK = (1n << 192n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const INT128_MAX = (1n << 127n) - 1n;

export type EvmAuctionConfigInput = Hex | bigint;

export interface ParsedEvmAuctionConfig {
  creatorFee: number;
  isSellingToken1: boolean;
  minBoostDuration: number;
  graduationPoolFee: bigint;
  graduationPoolTickSpacing: number;
  startTime: bigint;
  auctionDuration: number;
  endTime: bigint;
}

export interface EvmTwammOrderConfig {
  fee: bigint;
  isSellingToken1: boolean;
  startTime: bigint;
  endTime: bigint;
}

/** A bid of the EVM continuous auction extension, as returned by `auctions(poolId)`. */
export interface EvmContinuousAuctionBid {
  bidder: Hex;
  rate: bigint;
  executor: Hex;
  /** First second in which the bid holds the pool. */
  start: bigint;
  /** First second in which the bid no longer holds the pool. */
  end: bigint;
  /** Fee charged to swappers other than the executor, as a 0.32 fixed-point fraction. */
  fee: bigint;
}

/** The settled bid schedule of a continuous auction pool. */
export interface EvmContinuousAuctionState {
  current: EvmContinuousAuctionBid;
  /** The next bid, starting at `lastSettled + 1`, or null if none is scheduled. */
  next: EvmContinuousAuctionBid | null;
  lastSettled: bigint;
}

type EvmContinuousAuctionBidInput = {
  [
    K in keyof EvmContinuousAuctionBid
  ]: EvmContinuousAuctionBid[K] extends bigint
    ? bigint | number
    : EvmContinuousAuctionBid[K];
};

export interface EvmSaltedTokenInput {
  minter: Hex;
  salt: Hex;
  chainId: bigint;
  contract: Hex;
}

/** Packs the bytes32 config used by an Ekubo EVM v3 auction key. */
export function encodeEvmAuctionConfig({
  creatorFee,
  isSellingToken1,
  minBoostDuration,
  graduationPoolFee,
  graduationPoolTickSpacing,
  startTime,
  auctionDuration,
  endTime,
}: Omit<ParsedEvmAuctionConfig, "endTime"> & {
  endTime?: bigint;
}): Hex {
  assertNumberUint(creatorFee, UINT32_MAX, "creatorFee", 32);
  assertNumberUint(minBoostDuration, UINT24_MAX, "minBoostDuration", 24);
  assertBigintUint(graduationPoolFee, UINT64_MAX, "graduationPoolFee", 64);
  assertNumberUint(
    graduationPoolTickSpacing,
    UINT32_MAX,
    "graduationPoolTickSpacing",
    32,
  );
  assertBigintUint(startTime, UINT64_MAX, "startTime", 64);
  assertNumberUint(auctionDuration, UINT32_MAX, "auctionDuration", 32);

  if (
    endTime !== undefined &&
    endTime !== startTime + BigInt(auctionDuration)
  ) {
    throw new Error("endTime must equal startTime + auctionDuration");
  }

  return toSizedHex(
    (BigInt(creatorFee) << 224n) |
      (BigInt(isSellingToken1 ? 1 : 0) << 216n) |
      (BigInt(minBoostDuration) << 192n) |
      (graduationPoolFee << 128n) |
      (BigInt(graduationPoolTickSpacing) << 96n) |
      (startTime << 32n) |
      BigInt(auctionDuration),
    32,
  );
}

/** Decodes an Ekubo EVM v3 auction-key config. */
export function decodeEvmAuctionConfig(
  auctionConfig: EvmAuctionConfigInput,
): ParsedEvmAuctionConfig {
  const config = uint256Input(auctionConfig, "auctionConfig");
  const creatorFee = Number((config >> 224n) & UINT32_MAX);
  const isSellingToken1 = ((config >> 216n) & 0xffn) !== 0n;
  const minBoostDuration = Number((config >> 192n) & UINT24_MAX);
  const graduationPoolFee = (config >> 128n) & UINT64_MAX;
  const graduationPoolTickSpacing = Number((config >> 96n) & UINT32_MAX);
  const startTime = (config >> 32n) & UINT64_MAX;
  const auctionDuration = Number(config & UINT32_MAX);

  return {
    creatorFee,
    isSellingToken1,
    minBoostDuration,
    graduationPoolFee,
    graduationPoolTickSpacing,
    startTime,
    auctionDuration,
    endTime: startTime + BigInt(auctionDuration),
  };
}

/** Packs the bytes32 config used by an Ekubo EVM v3 TWAMM order key. */
export function encodeEvmTwammOrderConfig({
  fee,
  isSellingToken1,
  startTime,
  endTime,
}: EvmTwammOrderConfig): Hex {
  assertBigintUint(fee, UINT64_MAX, "fee", 64);
  assertBigintUint(startTime, UINT64_MAX, "startTime", 64);
  assertBigintUint(endTime, UINT64_MAX, "endTime", 64);

  return toSizedHex(
    (fee << 192n) |
      (BigInt(isSellingToken1 ? 1 : 0) << 184n) |
      (startTime << 64n) |
      endTime,
    32,
  );
}

/** Decodes an Ekubo EVM v3 TWAMM order-key config. */
export function decodeEvmTwammOrderConfig(config: Hex): EvmTwammOrderConfig {
  const packed = sizedHexToBigInt(config, 32, "config");
  return {
    fee: (packed >> 192n) & UINT64_MAX,
    isSellingToken1: ((packed >> 184n) & 0xffn) !== 0n,
    startTime: (packed >> 64n) & UINT64_MAX,
    endTime: packed & UINT64_MAX,
  };
}

/**
 * Computes the maximum Q32 sale rate accepted by the EVM v3 TWAMM manager.
 * The effective start includes the caller's pending-block deadline buffer.
 */
export function calculateEvmTwammMaxSaleRate(input: {
  amount: bigint;
  startTime: bigint;
  endTime: bigint;
  pendingTimestamp: bigint;
  deadlineSeconds?: bigint;
}): bigint {
  const deadlineSeconds = input.deadlineSeconds ?? 120n;
  for (const [label, value] of Object.entries({
    amount: input.amount,
    startTime: input.startTime,
    endTime: input.endTime,
    pendingTimestamp: input.pendingTimestamp,
    deadlineSeconds,
  })) {
    if (value < 0n) throw new Error(`${label} must be non-negative`);
  }
  const effectiveStart = maxBigint(
    input.startTime,
    input.pendingTimestamp + deadlineSeconds,
  );
  const duration =
    input.endTime > effectiveStart ? input.endTime - effectiveStart : 1n;
  const result = (input.amount << 32n) / duration;
  if (result > UINT112_MAX) {
    throw new Error("max sale rate must fit uint112");
  }
  return result;
}

/** Returns the exact 128-byte ABI encoding hashed by salted EVM NFT managers. */
export function encodeEvmSaltedTokenPreimage({
  minter,
  salt,
  chainId,
  contract,
}: EvmSaltedTokenInput): Hex {
  assertBigintUint(chainId, UINT256_MAX, "chainId", 256);
  return `0x${toSizedHex(sizedHexToBigInt(minter, 20, "minter"), 32).slice(2)}${toSizedHex(sizedHexToBigInt(salt, 32, "salt"), 32).slice(2)}${toSizedHex(chainId, 32).slice(2)}${toSizedHex(sizedHexToBigInt(contract, 20, "contract"), 32).slice(2)}`;
}

/** Derives the full uint256 salted token ID used by the auctions manager. */
export function deriveEvmAuctionTokenId(
  input: EvmSaltedTokenInput,
  keccak256: (value: Hex) => Hex,
): bigint {
  return hashSaltedTokenInput(input, keccak256);
}

/** Derives the upper uint128 salted token ID used by the TWAMM orders manager. */
export function deriveEvmTwammOrderTokenId(
  input: EvmSaltedTokenInput,
  keccak256: (value: Hex) => Hex,
): bigint {
  return hashSaltedTokenInput(input, keccak256) >> 128n;
}

/** Derives the lower uint192 salted token ID used by VeToken. */
export function deriveEvmVeTokenId(
  input: EvmSaltedTokenInput,
  keccak256: (value: Hex) => Hex,
): bigint {
  return hashSaltedTokenInput(input, keccak256) & UINT192_MASK;
}

/** Derives a deterministic bytes32 child salt from a nonce and uint256 index. */
export function deriveEvmIndexedSalt(
  nonce: Hex,
  index: bigint,
  keccak256: (value: Hex) => Hex,
): Hex {
  assertBigintUint(index, UINT256_MAX, "index", 256);
  const nonceWord = toSizedHex(sizedHexToBigInt(nonce, 32, "nonce"), 32);
  return keccak256(`0x${nonceWord.slice(2)}${toSizedHex(index, 32).slice(2)}`);
}

/**
 * Normalizes the first three values returned by `ContinuousAuction.auctions(poolId)`. The contract
 * returns an empty next bid (zero bidder) when none is scheduled.
 */
export function parseEvmContinuousAuctionState([
  current,
  next,
  lastSettled,
]: readonly [
  EvmContinuousAuctionBidInput,
  EvmContinuousAuctionBidInput,
  bigint | number,
  ...unknown[],
]): EvmContinuousAuctionState {
  return {
    current: parseContinuousAuctionBid(current),
    next: BigInt(next.bidder) === 0n ? null : parseContinuousAuctionBid(next),
    lastSettled: BigInt(lastSettled),
  };
}

/**
 * Returns the bid holding the pool at `timestamp`, mirroring `ContinuousAuction._activeBid`: the
 * next bid takes over at its start. Returns null when no bid holds the pool, in which case the pool
 * rejects swaps and must not be quoted.
 */
export function getEvmContinuousAuctionLiveBid(
  { current, next }: EvmContinuousAuctionState,
  timestamp: bigint,
): EvmContinuousAuctionBid | null {
  const active = next !== null && next.start <= timestamp ? next : current;
  return active.start <= timestamp && timestamp < active.end ? active : null;
}

/**
 * Applies a continuous auction bid's fee to a zero-fee Core swap for a swapper other than the
 * bid's executor. Like the Ve33 voted fee, it is charged in the unspecified token: taken from the
 * output of exact-input swaps (`amount >= 0`) and added to the input of exact-output swaps.
 * `calculatedAmount` is the unsigned calculated amount of the Core swap and `fee` the bid's 0.32
 * fee; the executor pays no fee.
 */
export function applyEvmContinuousAuctionFee({
  amount,
  calculatedAmount,
  fee,
}: {
  amount: bigint;
  calculatedAmount: bigint;
  fee: bigint;
}): { calculatedAmount: bigint; feeAmount: bigint } {
  assertBigintUint(fee, UINT32_MAX, "fee", 32);
  // The 0.32 fee is the upper half of Core's 0.64 fee, which is the upper half of a 0.128 fee.
  const fee128 = fee << 96n;
  if (amount >= 0n) {
    const feeAmount = computeFee(calculatedAmount, fee128);
    return { calculatedAmount: calculatedAmount - feeAmount, feeAmount };
  }
  const amountIncludingFee = amountBeforeFee(calculatedAmount, fee128);
  // The extension casts the input including the fee to int128.
  if (amountIncludingFee > INT128_MAX) {
    throw new Error("AMOUNT_BEFORE_FEE_OVERFLOW");
  }
  return {
    calculatedAmount: amountIncludingFee,
    feeAmount: amountIncludingFee - calculatedAmount,
  };
}

function parseContinuousAuctionBid(
  bid: EvmContinuousAuctionBidInput,
): EvmContinuousAuctionBid {
  return {
    bidder: bid.bidder,
    rate: BigInt(bid.rate),
    executor: bid.executor,
    start: BigInt(bid.start),
    end: BigInt(bid.end),
    fee: BigInt(bid.fee),
  };
}

function hashSaltedTokenInput(
  input: EvmSaltedTokenInput,
  keccak256: (value: Hex) => Hex,
) {
  return sizedHexToBigInt(
    keccak256(encodeEvmSaltedTokenPreimage(input)),
    32,
    "keccak256 result",
  );
}

function maxBigint(a: bigint, b: bigint) {
  return a > b ? a : b;
}

function uint256Input(value: EvmAuctionConfigInput, label: string): bigint {
  if (typeof value === "bigint") {
    assertBigintUint(value, UINT256_MAX, label, 256);
    return value;
  }
  return sizedHexToBigInt(value, 32, label);
}

function assertNumberUint(
  value: number,
  maximum: bigint,
  label: string,
  bits: number,
) {
  if (!Number.isInteger(value) || value < 0 || BigInt(value) > maximum) {
    throw new Error(`${label} must be a uint${bits}`);
  }
}

function assertBigintUint(
  value: bigint,
  maximum: bigint,
  label: string,
  bits: number,
) {
  if (value < 0n || value > maximum) {
    throw new Error(`${label} must be a uint${bits}`);
  }
}

function sizedHexToBigInt(value: Hex, bytes: number, label: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length > 2 + bytes * 2) {
    throw new Error(`${label} must fit in ${bytes} bytes`);
  }
  return BigInt(value);
}

function toSizedHex(value: bigint, bytes: number): Hex {
  if (value < 0n || value >= 1n << BigInt(bytes * 8)) {
    throw new Error(`value must fit in ${bytes} bytes`);
  }
  return `0x${value.toString(16).padStart(bytes * 2, "0")}`;
}
