import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "../math";
import { isPriceIncreasing } from "../math/swap";
import {
  approximateNumberOfTickSpacingsCrossed,
  newApproximateNumberOfTickSpacingsCrossed,
} from "../math/tick";
import { BasePool, findNearestInitializedTickIndex } from "./basePool";
import {
  BasePoolResources,
  LimitOrderPoolResources,
  LimitOrderPoolState,
  NodeKey,
  QuoteLimitOrderNode,
  QuoteLimitOrderPool,
  QuoteNode,
  QuoteParams,
  Tick,
} from "./quoteNode";

export const LIMIT_ORDER_TICK_SPACING = 128;
export const DOUBLE_LIMIT_ORDER_TICK_SPACING = 2 * LIMIT_ORDER_TICK_SPACING;

function calculateOrdersPulled(
  from: number | null,
  to: number | null,
  is_increasing: boolean,
  sorted_ticks: any[] // Replace 'any' with proper Tick type
): number {
  let current = from;
  let orders_pulled = 0;

  while (current !== to) {
    let crossed_tick: number;

    if (is_increasing) {
      crossed_tick = current === null ? 0 : current + 1;
      current = crossed_tick;
    } else {
      crossed_tick = current!; // Safe because in decreasing case, current is always defined
      current = crossed_tick > 0 ? crossed_tick - 1 : null;
    }
    if (
      sorted_ticks[crossed_tick].tick % DOUBLE_LIMIT_ORDER_TICK_SPACING !==
      0
    ) {
      orders_pulled += 1;
    }
  }

  return orders_pulled;
}

export class LimitOrderPool implements QuoteLimitOrderNode {
  public readonly basePool: QuoteNode;
  public readonly key: NodeKey;
  public readonly state: Readonly<LimitOrderPoolState>;
  public readonly sortedTicks: Tick[];

  constructor({
    token0,
    token1,
    tickSpacing,
    fee,
    sqrtRatio,
    liquidity,
    tick,
    sortedTicks,
  }: {
    token0: bigint;
    token1: bigint;
    tickSpacing: number;
    fee: bigint;
    sqrtRatio: bigint;
    liquidity: bigint;
    tick: number;
    sortedTicks: Tick[];
  }) {
    this.basePool = new BasePool({
      token0,
      token1,
      tickSpacing,
      fee,
      sqrtRatio,
      liquidity,
      tick,
      sortedTicks,
    });
    this.key = {
      token0,
      token1,
      fee,
      tickSpacing,
      extension: 0n,
    };
    this.sortedTicks = sortedTicks;
    this.state = {
      basePoolState: {
        sqrtRatio,
        liquidity,
        activeTickIndex: findNearestInitializedTickIndex(sortedTicks, tick),
      },
      tickIndicesReached: null,
    };
  }

  quote(
    params: QuoteParams<LimitOrderPoolState>
  ): QuoteLimitOrderPool<LimitOrderPoolResources, LimitOrderPoolState> {
    const amount = params.tokenAmount.amount;
    const is_token1 = params.tokenAmount.token === this.key.token1;

    const initial_state = params.overrideState ?? this.state;
    const is_increasing = isPriceIncreasing(amount, is_token1);

    let calculated_amount = 0n;
    let consumed_amount = 0n;
    let fees_paid = 0n;
    let base_pool_resources: BasePoolResources =
      this.basePool.initialResources();
    let base_pool_state = initial_state.basePoolState;

    const active_tick_index = initial_state.basePoolState.activeTickIndex;

    let next_unpulled_order_tick_index_after_skip = undefined;
    if (initial_state.tickIndicesReached) {
      const lower = initial_state.tickIndicesReached[0];
      const upper = initial_state.tickIndicesReached[1];
      if (is_increasing) {
        if (active_tick_index != upper) {
          if (upper) {
            if (
              this.sortedTicks[upper].tick % DOUBLE_LIMIT_ORDER_TICK_SPACING !=
              0
            ) {
              next_unpulled_order_tick_index_after_skip =
                upper + 1 < this.sortedTicks.length - 1
                  ? upper
                  : this.sortedTicks.length - 1;
            } else {
              next_unpulled_order_tick_index_after_skip = upper;
            }
          } else {
            next_unpulled_order_tick_index_after_skip = 0;
          }
        }
      } else {
        if (active_tick_index != lower) {
          if (lower !== null) {
            if (
              this.sortedTicks[lower].tick % DOUBLE_LIMIT_ORDER_TICK_SPACING ==
              0
            ) {
              next_unpulled_order_tick_index_after_skip =
                lower - 1 >= 0 ? lower - 1 : null;
            } else {
              next_unpulled_order_tick_index_after_skip = lower;
            }
          } else {
            next_unpulled_order_tick_index_after_skip = null;
          }
        }
      }
    }

    if (next_unpulled_order_tick_index_after_skip !== undefined) {
      const next_unpulled_order_tick_index =
        next_unpulled_order_tick_index_after_skip;
      // Get active tick sqrt ratio limit
      let active_tick_sqrt_ratio_limit = 0n;

      if (is_increasing) {
        if (active_tick_index === null) {
          // equivalent to map_or_else(|| sorted_ticks.first(), ...)
          active_tick_sqrt_ratio_limit =
            this.sortedTicks.length > 0
              ? toSqrtRatio(this.sortedTicks[0].tick)
              : MAX_SQRT_RATIO;
        } else {
          // equivalent to sorted_ticks.get(idx + 1)
          active_tick_sqrt_ratio_limit =
            active_tick_index + 1 < this.sortedTicks.length
              ? toSqrtRatio(this.sortedTicks[active_tick_index + 1].tick)
              : MAX_SQRT_RATIO;
        }
      } else {
        if (!active_tick_index) {
          active_tick_sqrt_ratio_limit = MIN_SQRT_RATIO;
        } else {
          // tick is always valid in this case
          active_tick_sqrt_ratio_limit = toSqrtRatio(
            this.sortedTicks[active_tick_index].tick
          );
        }
      }

      // Get params sqrt ratio limit
      const params_sqrt_ratio_limit =
        params.sqrtRatioLimit ??
        (is_increasing ? MAX_SQRT_RATIO : MIN_SQRT_RATIO);
      // Calculate active tick boundary sqrt ratio
      const active_tick_boundary_sqrt_ratio = is_increasing
        ? active_tick_sqrt_ratio_limit < params_sqrt_ratio_limit
          ? active_tick_sqrt_ratio_limit
          : params_sqrt_ratio_limit
        : active_tick_sqrt_ratio_limit > params_sqrt_ratio_limit
        ? active_tick_sqrt_ratio_limit
        : params_sqrt_ratio_limit;

      // Quote to active tick boundary
      const quote_to_active_tick_boundary = this.basePool.quote({
        tokenAmount: params.tokenAmount,
        sqrtRatioLimit: active_tick_boundary_sqrt_ratio,
        overrideState: base_pool_state,
        meta: null,
      });
      calculated_amount =
        calculated_amount + quote_to_active_tick_boundary.calculatedAmount;
      consumed_amount =
        consumed_amount + quote_to_active_tick_boundary.consumedAmount;
      fees_paid = fees_paid + quote_to_active_tick_boundary.feesPaid;

      base_pool_resources = this.basePool.combineResources(
        base_pool_resources,
        quote_to_active_tick_boundary.executionResources
      );

      base_pool_state = quote_to_active_tick_boundary.stateAfter;

      const amount_remaining = amount - consumed_amount;

      if (amount_remaining !== 0n) {
        // Calculate skip starting sqrt ratio
        let skip_starting_sqrt_ratio: bigint;

        if (is_increasing) {
          if (!next_unpulled_order_tick_index) {
            skip_starting_sqrt_ratio = MAX_SQRT_RATIO;
          } else {
            const tick_index =
              this.sortedTicks[next_unpulled_order_tick_index].tick;
            const sqrt_ratio = toSqrtRatio(tick_index);
            skip_starting_sqrt_ratio =
              sqrt_ratio < params_sqrt_ratio_limit
                ? sqrt_ratio
                : params_sqrt_ratio_limit;
          }
        } else {
          let tick;
          if (next_unpulled_order_tick_index == null) {
            tick = this.sortedTicks[0];
          } else {
            tick = this.sortedTicks[next_unpulled_order_tick_index + 1];
          }
          if (!tick) {
            skip_starting_sqrt_ratio = MIN_SQRT_RATIO;
          } else {
            const sqrt_ratio = toSqrtRatio(tick.tick);
            skip_starting_sqrt_ratio =
              sqrt_ratio > params_sqrt_ratio_limit
                ? sqrt_ratio
                : params_sqrt_ratio_limit;
          }
        }

        // Account for tick spacings crossed
        base_pool_resources = this.basePool.combineResources(
          base_pool_resources,
          {
            noOverridePriceChange: 0,
            tickSpacingsCrossed: newApproximateNumberOfTickSpacingsCrossed(
              base_pool_state.sqrtRatio,
              skip_starting_sqrt_ratio,
              LIMIT_ORDER_TICK_SPACING
            ),
            initializedTicksCrossed:
              base_pool_resources.initializedTicksCrossed,
          }
        );

        // Calculate liquidity at next unpulled order tick index
        const liquidity_at_next_unpulled_order_tick_index = (() => {
          let current_liquidity = base_pool_state.liquidity;
          let current_active_tick_index = base_pool_state.activeTickIndex;

          // Apply all liquidity deltas between current active tick and next unpulled order
          while (true) {
            let next_tick_index: number | null;
            let liquidity_delta: bigint;

            if (
              is_increasing &&
              (!current_active_tick_index ||
                current_active_tick_index < next_unpulled_order_tick_index)
            ) {
              // Handle increasing price case
              next_tick_index =
                current_active_tick_index == null
                  ? 0
                  : current_active_tick_index + 1; // valid because next_unpulled_order_tick_index is larger

              liquidity_delta =
                this.sortedTicks[next_tick_index].liquidityDelta;
            } else if (
              !is_increasing &&
              current_active_tick_index !== null &&
              (next_unpulled_order_tick_index === null ||
                current_active_tick_index > next_unpulled_order_tick_index) // TODO: check this
            ) {
              // Handle decreasing price case
              const current_tick_index = current_active_tick_index; // safe because we checked it's defined
              next_tick_index =
                current_tick_index > 0 ? current_tick_index - 1 : null;
              liquidity_delta =
                this.sortedTicks[current_tick_index].liquidityDelta;
            } else {
              break;
            }

            current_active_tick_index = next_tick_index;

            if (liquidity_delta < 0n !== is_increasing) {
              current_liquidity =
                current_liquidity +
                (liquidity_delta < 0n
                  ? liquidity_delta * -1n
                  : liquidity_delta);
            } else {
              current_liquidity =
                current_liquidity -
                (liquidity_delta < 0n
                  ? liquidity_delta * -1n
                  : liquidity_delta);
            }
          }

          return current_liquidity;
        })();
        const quote_from_next_unpulled_order = this.basePool.quote({
          sqrtRatioLimit: params.sqrtRatioLimit,
          tokenAmount: {
            amount: amount_remaining,
            token: is_token1 ? this.key.token1 : this.key.token0,
          },
          overrideState: {
            ...base_pool_state,
            activeTickIndex: next_unpulled_order_tick_index,
            sqrtRatio: skip_starting_sqrt_ratio,
            liquidity: liquidity_at_next_unpulled_order_tick_index,
          },
          meta: null,
        });

        // Accumulate results
        calculated_amount =
          calculated_amount + quote_from_next_unpulled_order.calculatedAmount;
        consumed_amount =
          consumed_amount + quote_from_next_unpulled_order.consumedAmount;

        fees_paid = fees_paid + quote_from_next_unpulled_order.feesPaid;
        base_pool_resources = this.basePool.combineResources(
          base_pool_resources,
          quote_from_next_unpulled_order.executionResources
        );
        base_pool_state = quote_from_next_unpulled_order.stateAfter;
      }
    } else {
      // Handle simple quote case
      const quote_simple = this.basePool.quote({
        sqrtRatioLimit: params.sqrtRatioLimit,
        overrideState: initial_state.basePoolState,
        tokenAmount: params.tokenAmount,
        meta: null,
      });

      calculated_amount = calculated_amount + quote_simple.calculatedAmount;
      consumed_amount = consumed_amount + quote_simple.consumedAmount;
      fees_paid = fees_paid + quote_simple.feesPaid;
      base_pool_resources = this.basePool.combineResources(
        base_pool_resources,
        quote_simple.executionResources
      );

      base_pool_state = quote_simple.stateAfter;
    }

    // Track tick indices before and after
    const [tick_index_before, tick_index_after] = [
      initial_state.basePoolState.activeTickIndex,
      base_pool_state.activeTickIndex,
    ];

    // Calculate new tick indices reached
    const new_tick_indices_reached: [number, number] = is_increasing
      ? initial_state.tickIndicesReached
        ? [
            initial_state.tickIndicesReached[0],
            Math.max(initial_state.tickIndicesReached[1], tick_index_after),
          ]
        : [tick_index_before, tick_index_after]
      : initial_state.tickIndicesReached
      ? [
          Math.min(initial_state.tickIndicesReached[0], tick_index_after),
          initial_state.tickIndicesReached[1],
        ]
      : [tick_index_after, tick_index_before];
    // Calculate from and to tick indices for orders pulled
    const from_tick_index =
      next_unpulled_order_tick_index_after_skip ??
      initial_state.basePoolState.activeTickIndex;

    let to_tick_index;
    if (is_increasing) {
      if (from_tick_index) {
        to_tick_index = Math.max(from_tick_index, tick_index_after);
      } else {
        to_tick_index = tick_index_after;
      }
    } else {
      if (tick_index_after) {
        to_tick_index = Math.min(from_tick_index, tick_index_after);
      } else {
        to_tick_index = tick_index_after;
      }
    }

    // Calculate orders pulled
    const orders_pulled = calculateOrdersPulled(
      from_tick_index,
      to_tick_index,
      is_increasing,
      this.sortedTicks
    );

    return {
      calculatedAmount: calculated_amount,
      consumedAmount: consumed_amount,
      feesPaid: fees_paid,
      executionResources: {
        basePoolResources: base_pool_resources,
        ordersPulled: orders_pulled,
      },
      stateAfter: {
        basePoolState: base_pool_state,
        tickIndicesReached: new_tick_indices_reached,
      },
      isPriceIncreasing: is_increasing,
    };
  }
}
