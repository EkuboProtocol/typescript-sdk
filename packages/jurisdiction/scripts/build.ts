import { mkdir, copyFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
async function run(command: string[]) {
  const process = Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await process.exited) !== 0)
    throw new Error(`Failed: ${command.join(" ")}`);
}
await run([
  "cargo",
  "build",
  "--locked",
  "--target",
  "wasm32-unknown-unknown",
  "--release",
]);
await mkdir(join(root, "dist/wasm"), { recursive: true });
await run([
  "wasm-bindgen",
  "target/wasm32-unknown-unknown/release/ekubo_jurisdiction.wasm",
  "--target",
  "web",
  "--out-dir",
  "dist/wasm",
  "--out-name",
  "ekubo_jurisdiction",
]);
const bytes = Buffer.from(
  await Bun.file(
    join(root, "dist/wasm/ekubo_jurisdiction_bg.wasm"),
  ).arrayBuffer(),
).toString("base64");
await Bun.write(
  join(root, "dist/wasm/bytes.js"),
  `export function wasmBytes() { return Uint8Array.from(atob(${JSON.stringify(bytes)}), (value) => value.charCodeAt(0)); }\n`,
);
await Bun.write(
  join(root, "dist/wasm/bytes.d.ts"),
  "export declare function wasmBytes(): Uint8Array;\n",
);
// Do not bundle the wasm-bindgen loader: keep its literal .wasm import intact
// for Wrangler's module handling, and exclude the embedded bytes from Workers.
const common = await Bun.build({
  entrypoints: [join(root, "src/common.ts")],
  outdir: join(root, "dist"),
  target: "browser",
  format: "esm",
  external: ["viem"],
});
if (!common.success) throw new Error(String(common.logs));
const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
for (const entry of ["index", "worker", "schema"]) {
  const content = await transpiler.transform(
    await Bun.file(join(root, `src/${entry}.ts`)).text(),
  );
  await Bun.write(
    join(root, `dist/${entry}.js`),
    content.replaceAll("../dist/wasm/", "./wasm/"),
  );
}
await run(["bun", "x", "tsc", "-p", "tsconfig.json"]);
for (const entry of ["common", "index", "schema"]) {
  await copyFile(
    join(root, `dist/types/src/${entry}.d.ts`),
    join(root, `dist/${entry}.d.ts`),
  );
}

await rm(join(root, "dist/types"), { recursive: true, force: true });
