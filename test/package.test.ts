import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "../src";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string[], cwd: string) {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(
    result.exitCode,
    `${command.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
  ).toBe(0);
  return result.stdout.toString();
}

test("packed ESM package resolves declarations and preserves runtime exports", () => {
  const consumer = mkdtempSync(join(tmpdir(), "ekubo-sdk-consumer-"));
  try {
    run(["bun", "run", "build"], root);
    const packed = JSON.parse(
      run(
        [
          "npm",
          "pack",
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          consumer,
        ],
        root,
      ),
    ) as { filename: string }[];
    const installed = join(consumer, "node_modules", "@ekubo", "sdk");
    mkdirSync(installed, { recursive: true });
    run(
      [
        "tar",
        "-xzf",
        join(consumer, packed[0].filename),
        "--strip-components=1",
        "-C",
        installed,
      ],
      consumer,
    );
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(consumer, "consumer.ts"),
      'import { toSqrtRatio, EVM_MAX_TICK } from "@ekubo/sdk";\nconst ratio: bigint = toSqrtRatio(0, "starknet");\nconst tick: number = EVM_MAX_TICK;\n',
    );
    for (const mode of ["node16", "nodenext", "bundler"]) {
      for (const skipLibCheck of [false, true]) {
        run(
          [
            join(root, "node_modules", ".bin", "tsc"),
            "--noEmit",
            "--strict",
            "--target",
            "es2020",
            "--module",
            mode === "bundler" ? "esnext" : mode,
            "--moduleResolution",
            mode,
            "--skipLibCheck",
            String(skipLibCheck),
            "consumer.ts",
          ],
          consumer,
        );
      }
    }
    writeFileSync(
      join(consumer, "runtime.mjs"),
      `
import assert from "node:assert/strict";
import * as sdk from "@ekubo/sdk";
assert.deepEqual(Object.keys(sdk).sort(), ${JSON.stringify(Object.keys(sdk).sort())});
assert.equal(sdk.toSqrtRatio(0, "starknet"), 1n << 128n);
assert.equal(sdk.EVM_MAX_TICK, 88722835);
`,
    );
    run(["node", "runtime.mjs"], consumer);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}, 120_000);
