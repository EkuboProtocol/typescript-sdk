# AGENTS.md

## Complexity Policy
- Run `bun run lint` and `bun test` before considering a change done. CI runs both on
  every push and pull request.
- The only rule is ESLint's `complexity`, capped at 10 per function.
- Two functions are exempted with `// eslint-disable-next-line complexity`:
  `toSqrtRatio` in `src/math/tick.ts` and `expInner` in `src/math/twamm.ts`. Both are
  binary exponentiation unrolled one bit at a time with per-bit magic constants, and
  the branch count is the point — each `if` is one bit of the input and one factor of
  the product. The constants must stay bit-for-bit identical to the on-chain
  implementations or quotes stop matching execution, so rolling them into a
  table-driven loop is not an option: it would change the rounding of the
  intermediate products.
- Any new disable needs a reason on the same line explaining why the branches are
  irreducible. Otherwise, split the function.
