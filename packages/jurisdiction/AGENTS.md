# Jurisdiction package

- `protocol.json` is the versioned payload contract; `rust/lib.rs` is the only verifier. Do not add TypeScript signature, timestamp, or country-code verification logic in consumers.
- TypeScript consumers use Wasm compiled from this crate; the native quoter uses the crate directly. Keep transport and asset eligibility policy outside the verifier.
- Run the package build, its Bun tests, `cargo test`, `cargo clippy --all-targets -- -D warnings`, and the repository lint before release. Both runtimes must pass `fixtures/conformance.json`.
- Publish npm and Rust artifacts from the same source/version. Consumer vendored artifacts are generated release inputs, never alternate source trees to edit.
