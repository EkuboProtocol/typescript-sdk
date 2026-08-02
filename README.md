# @ekubo/sdk

Shared TypeScript math and protocol encoding utilities for
[Ekubo Protocol](https://ekubo.org), supporting EVM and Starknet.

## Installation

```sh
npm install @ekubo/sdk
# or
bun add @ekubo/sdk
```

## Usage

All functions are pure and dependency-free. Exact protocol integers use native
`bigint` values.

```ts
import {
  toSqrtRatio,
  computeStep,
  maxLiquidityForTokenAmounts,
} from "@ekubo/sdk";

// Convert a tick to a sqrt ratio for Starknet
const sqrtRatio = toSqrtRatio(0, "starknet");

// Compute a single swap step
const result = computeStep({
  sqrtRatio,
  liquidity: 1000000n,
  sqrtRatioLimit: toSqrtRatio(100, "starknet"),
  amount: 500n,
  isToken1: false,
  fee: 0n,
});
// result: { consumedAmount, calculatedAmount, sqrtRatioNext, feeAmount }

// Compute the maximum liquidity for a position given token amounts
const liquidity = maxLiquidityForTokenAmounts({
  sqrtPrice: sqrtRatio,
  sqrtPriceLower: toSqrtRatio(-100, "starknet"),
  sqrtPriceUpper: toSqrtRatio(100, "starknet"),
  amountBase: 1000n,
  amountQuote: 1000n,
});
```

## API Reference

### Types

#### `Chain`

```ts
type Chain = "evm" | "starknet";
```

Selects chain-specific tick and sqrt ratio bounds.

---

### Constants

| Name | Description |
|---|---|
| `MAX_U128` | Maximum value of a 128-bit unsigned integer |
| `MAX_U256` | Maximum value of a 256-bit unsigned integer |
| `EVM_MIN_TICK` | Minimum tick for EVM |
| `EVM_MAX_TICK` | Maximum tick for EVM |
| `EVM_MIN_SQRT_RATIO` | Minimum sqrt ratio for EVM |
| `EVM_MAX_SQRT_RATIO` | Maximum sqrt ratio for EVM |
| `EVM_MAX_TICK_SPACING` | Maximum tick spacing for EVM |
| `STARKNET_MIN_TICK` | Minimum tick for Starknet |
| `STARKNET_MAX_TICK` | Maximum tick for Starknet |
| `STARKNET_MIN_SQRT_RATIO` | Minimum sqrt ratio for Starknet |
| `STARKNET_MAX_SQRT_RATIO` | Maximum sqrt ratio for Starknet |
| `STARKNET_MAX_TICK_SPACING` | Maximum tick spacing for Starknet |

---

### Tick / Sqrt Ratio

#### `toSqrtRatio(tick: number, chain: Chain): bigint`

Converts a tick index to a fixed-point sqrt ratio for the given chain.

```ts
const sqrtRatio = toSqrtRatio(1000, "evm");
```

#### `floatSqrtRatioToFixed(sqrtRatioFloat: bigint): bigint`

Converts a compact 96-bit float sqrt ratio (as stored on-chain on Starknet mainnet) to the fixed-point representation used in math functions.

#### `fixedSqrtRatioToFloat(sqrtRatio: bigint): bigint`

Converts a fixed-point sqrt ratio to the compact float format expected on Starknet mainnet.

---

### Token Amount Deltas

#### `amount0Delta(sqrtRatioA, sqrtRatioB, liquidity, roundUp): bigint`

Computes the amount of token0 (base token) between two sqrt ratios for a given liquidity.

#### `amount1Delta(sqrtRatioA, sqrtRatioB, liquidity, roundUp): bigint`

Computes the amount of token1 (quote token) between two sqrt ratios for a given liquidity.

---

### Price / Sqrt Ratio Calculation

#### `nextSqrtRatioFromAmount0(sqrtRatio, liquidity, amount0): bigint | null`

Calculates the next sqrt ratio after trading a given amount of token0. Returns `null` if the result is out of range.

#### `nextSqrtRatioFromAmount1(sqrtRatio, liquidity, amount1): bigint | null`

Calculates the next sqrt ratio after trading a given amount of token1. Returns `null` if the result is out of range.

---

### Swap

#### `computeStep({ sqrtRatio, liquidity, sqrtRatioLimit, amount, isToken1, fee }): SwapResult`

Computes a single step of a swap within a tick range.

- `sqrtRatio` – current sqrt ratio
- `liquidity` – active liquidity
- `sqrtRatioLimit` – sqrt ratio at which the swap stops (price limit)
- `amount` – signed amount to swap; negative means exact output
- `isToken1` – `true` if the specified amount is in token1
- `fee` – fee as a fraction of `2^128`

Returns:

```ts
{
  consumedAmount: bigint;   // amount of the specified token consumed
  calculatedAmount: bigint; // amount of the other token
  sqrtRatioNext: bigint;    // sqrt ratio after the step
  feeAmount: bigint;        // fee collected
}
```

---

### Liquidity

#### `maxLiquidityForBaseToken({ sqrtPriceLower, sqrtPriceUpper, amount }): bigint`

Returns the maximum liquidity achievable from a given amount of base token (token0) over a price range.

#### `maxLiquidityForQuoteToken({ sqrtPriceLower, sqrtPriceUpper, amount }): bigint`

Returns the maximum liquidity achievable from a given amount of quote token (token1) over a price range.

#### `maxLiquidityForTokenAmounts({ sqrtPrice, sqrtPriceLower, sqrtPriceUpper, amountBase, amountQuote }): bigint`

Returns the maximum liquidity achievable given both token amounts and the current price.

#### `maxLiquidityForSpecifiedAmount({ sqrtPrice, sqrtPriceLower, sqrtPriceUpper, amount }): bigint`

Returns the maximum liquidity for either a specified base or quote amount.

```ts
// Specify base amount
const liq = maxLiquidityForSpecifiedAmount({
  sqrtPrice,
  sqrtPriceLower,
  sqrtPriceUpper,
  amount: { base: 1000n },
});

// Specify quote amount
const liq2 = maxLiquidityForSpecifiedAmount({
  sqrtPrice,
  sqrtPriceLower,
  sqrtPriceUpper,
  amount: { quote: 1000n },
});
```

#### `amountsFromSpecifiedAmount({ sqrtPrice, sqrtPriceLower, sqrtPriceUpper, amount }): { base, quote, maxLiquidity }`

Given either a base or quote token amount, returns both token amounts and the maximum liquidity for the position.

#### `liquidityToAmountBase({ sqrtPriceLower, sqrtPriceUpper, liquidity }): bigint`

Converts a liquidity value to the required base token amount for a price range.

#### `liquidityToAmountQuote({ sqrtPriceLower, sqrtPriceUpper, liquidity }): bigint`

Converts a liquidity value to the required quote token amount for a price range.

---

### TWAMM

#### `calculateNextSqrtRatio(sqrtRatio, liquidity, token0SaleRate, token1SaleRate, timeElapsed, fee): bigint`

Computes the next sqrt ratio for a TWAMM (Time-Weighted Average Market Maker) position after a given elapsed time.

---

### Utilities

#### `msb(x: bigint): number`

Returns the position of the most significant bit of `x`.

---

### EVM v3 Pool Keys

`encodeEvmConcentratedPoolConfig` and `encodeEvmStableswapPoolConfig` pack the
32-byte v3 config used by Core. `decodeEvmPoolConfig` returns the extension,
exact `bigint` Q64 fee, pool discriminator, and type-specific parameters.

`encodeEvmPoolKey` returns the exact 96-byte ABI encoding hashed by Core.
`deriveEvmPoolId` accepts a Keccak-256 function supplied by the consumer, which
keeps the SDK dependency-free:

```ts
import { deriveEvmPoolId, encodeEvmConcentratedPoolConfig } from "@ekubo/sdk";
import { keccak256 } from "viem";

const config = encodeEvmConcentratedPoolConfig({
  fee: 2n ** 64n / 10_000n,
  tickSpacing: 200,
  extension: "0x0000000000000000000000000000000000000000",
});
const poolId = deriveEvmPoolId({ token0, token1, config }, keccak256);
```

---

## Development

This project uses [Bun](https://bun.sh).

```sh
# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build
```

## License

[MIT](./LICENSE)
