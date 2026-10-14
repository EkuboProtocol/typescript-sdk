# AGENTS.md

## Checks

Run these before considering a change done. CI runs all of them on every pull
request and on every push to `main`.

| Command            | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `bun run fix`      | Formats with oxfmt. `bun run format:check` is the CI check.          |
| `bun run lint`     | oxlint, including type-aware rules, over the whole repository.       |
| `bun run check-ts` | `tsc -b` with TypeScript 7: the `src` project and the tests project. |
| `bun test`         | Unit tests.                                                          |
| `bun run build`    | Bundles `src/index.ts` and emits the published declarations.         |

- The TypeScript projects are referenced from `tsconfig.json`: `tsconfig.src.json`
  (`src`, which also emits the published `.d.ts` files into `dist`) and
  `tsconfig.tests.json` (`test` and `scripts`, with the Bun test types).
- `test/data` holds byte-pinned reference vectors with a `SHA256SUMS`; it is excluded
  from formatting.

## Lint rules

- Rules are in `.oxlintrc.json`. There are two kinds, and both exist because a
  failure must always be actionable and never a style argument:
  - `complexity`, capped at 10 per function, as a guardrail against functions growing
    unreviewably branchy.
  - The type-aware rules from typescript-eslint's recommended-type-checked set that
    catch real defects: `no-floating-promises`, `no-misused-promises`,
    `await-thenable`, `no-base-to-string`, `restrict-template-expressions` and the
    rest, except `no-unsafe-*`, `unbound-method` and `require-await`. Handle a
    promise with `await`, `.catch`, or `void` when it is deliberately
    fire-and-forget. `node:test`'s `describe`/`it` are allowed to float.
- Existing violations are recorded per file and per rule in
  `lint-suppressions.json`. That file is a ratchet, not an amnesty: a file may not
  gain a violation of a rule, even one it already has entries for, so a _new_
  violation fails the build. Do not raise a count to make the build pass.
- If you fix a recorded violation the lint run reports an outdated suppression. That
  is the ratchet working: run `bun run lint:prune` and commit the tightened file
  alongside your change. `bun run lint --suppress-rule=<code>` records every current
  violation of a rule and is only for introducing a new rule.

## Complexity Policy

- Two functions are exempted with `// eslint-disable-next-line complexity`:
  `toSqrtRatio` in `src/math/tick.ts` and `expInner` in `src/math/twamm.ts`. Both are
  binary exponentiation unrolled one bit at a time with per-bit magic constants, and
  the branch count is the point — each `if` is one bit of the input and one factor of
  the product. The constants must stay bit-for-bit identical to the on-chain
  implementations or quotes stop matching execution, so rolling them into a
  table-driven loop is not an option: it would change the rounding of the
  intermediate products.
- Any new disable needs a reason on the same line explaining why the branches are
  irreducible. Otherwise, split the function. An unused disable directive is itself
  an error.
