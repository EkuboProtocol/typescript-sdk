import { EVM_MAX_TICK_SPACING } from "./math/tick";

export type Hex = `0x${string}`;

export interface EvmPoolKey {
  token0: Hex;
  token1: Hex;
  config: Hex;
}

export type DecodedEvmPoolConfig = {
  config: Hex;
  extension: Hex;
  fee: bigint;
  typeConfig: Hex;
} & (
  | {
      poolType: "concentrated";
      discriminatorBitSet: true;
      tickSpacing: number;
      stableswapParams: null;
    }
  | {
      poolType: "stableswap" | "full_range";
      discriminatorBitSet: false;
      tickSpacing: null;
      stableswapParams: {
        centerTick: number;
        amplification: number;
      };
    }
);

const UINT64_MAX = (1n << 64n) - 1n;
const UINT31_MAX = (1n << 31n) - 1n;
const UINT32_MASK = (1n << 32n) - 1n;

/** Packs an Ekubo EVM v3 concentrated-pool config. */
export function encodeEvmConcentratedPoolConfig(input: {
  fee: bigint;
  tickSpacing: number;
  extension: Hex;
}): Hex {
  assertUint64(input.fee, "fee");
  if (
    !Number.isInteger(input.tickSpacing) ||
    input.tickSpacing < 1 ||
    input.tickSpacing > EVM_MAX_TICK_SPACING
  ) {
    throw new Error(
      `tickSpacing must be an integer from 1 to ${EVM_MAX_TICK_SPACING}`,
    );
  }
  const typeConfig = (1n << 31n) | BigInt(input.tickSpacing);
  return toSizedHex(
    (addressToBigInt(input.extension) << 96n) |
      (input.fee << 32n) |
      typeConfig,
    32,
  );
}

/** Packs an Ekubo EVM v3 stableswap config; zero values encode full range. */
export function encodeEvmStableswapPoolConfig(input: {
  fee: bigint;
  centerTick: number;
  amplification: number;
  extension: Hex;
}): Hex {
  assertUint64(input.fee, "fee");
  if (
    !Number.isInteger(input.amplification) ||
    input.amplification < 0 ||
    input.amplification > 26
  ) {
    throw new Error("amplification must be an integer from 0 to 26");
  }
  if (!Number.isInteger(input.centerTick) || input.centerTick % 16 !== 0) {
    throw new Error("centerTick must be an integer multiple of 16");
  }
  const encodedCenter = input.centerTick / 16;
  if (encodedCenter < -(1 << 23) || encodedCenter > (1 << 23) - 1) {
    throw new Error("centerTick does not fit signed 24 bits after scaling");
  }
  const typeConfig =
    (BigInt(input.amplification) << 24n) |
    BigInt(encodedCenter & 0xff_ffff);
  return toSizedHex(
    (addressToBigInt(input.extension) << 96n) |
      (input.fee << 32n) |
      typeConfig,
    32,
  );
}

/** Decodes an Ekubo EVM v3 pool config without converting uint64 fee to number. */
export function decodeEvmPoolConfig(config: Hex): DecodedEvmPoolConfig {
  const packed = sizedHexToBigInt(config, 32, "config");
  const typeConfig = packed & UINT32_MASK;
  const base = {
    config: toSizedHex(packed, 32),
    extension: toSizedHex(packed >> 96n, 20),
    fee: (packed >> 32n) & UINT64_MAX,
    typeConfig: toSizedHex(typeConfig, 4),
  };
  if ((typeConfig & (1n << 31n)) !== 0n) {
    return {
      ...base,
      poolType: "concentrated",
      discriminatorBitSet: true,
      tickSpacing: Number(typeConfig & UINT31_MAX),
      stableswapParams: null,
    };
  }

  const amplification = Number((typeConfig >> 24n) & 0x7fn);
  let centerTick24 = Number(typeConfig & 0xff_ffffn);
  if ((centerTick24 & 0x80_0000) !== 0) centerTick24 -= 0x100_0000;
  const centerTick = centerTick24 * 16;
  return {
    ...base,
    poolType:
      amplification === 0 && centerTick === 0 ? "full_range" : "stableswap",
    discriminatorBitSet: false,
    tickSpacing: null,
    stableswapParams: { centerTick, amplification },
  };
}

/** Returns the 96-byte ABI encoding hashed by PoolKey.toPoolId(). */
export function encodeEvmPoolKey(poolKey: EvmPoolKey): Hex {
  const token0 = addressToBigInt(poolKey.token0);
  const token1 = addressToBigInt(poolKey.token1);
  if (token0 >= token1) throw new Error("token0 must be less than token1");
  const config = sizedHexToBigInt(poolKey.config, 32, "config");
  return `0x${toSizedHex(token0, 32).slice(2)}${toSizedHex(token1, 32).slice(2)}${toSizedHex(config, 32).slice(2)}`;
}

/** Derives pool_id with a caller-supplied Keccak-256 function (for example viem.keccak256). */
export function deriveEvmPoolId(
  poolKey: EvmPoolKey,
  keccak256: (value: Hex) => Hex,
): Hex {
  return keccak256(encodeEvmPoolKey(poolKey));
}

function assertUint64(value: bigint, label: string) {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`${label} must be a uint64`);
  }
}

function addressToBigInt(value: Hex): bigint {
  return sizedHexToBigInt(value, 20, "address");
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
