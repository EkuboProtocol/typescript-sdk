# @ekubo/jurisdiction / ekubo-jurisdiction

One stateless verifier for Ekubo jurisdiction attestations. The Rust crate is
used directly by the EVM quoter and compiled to WebAssembly for TypeScript
callers. Payload construction, schemas, and documentation derive from
`protocol.json`; cryptographic verification, allowed country codes, expected
wallet matching, and validity checks are performed in `rust/lib.rs` everywhere.

```ts
import { attestationTypedData, verifyAttestation } from "@ekubo/jurisdiction";
const typed_data = attestationTypedData(walletAddress, "DE", unixSeconds);
// Ask the user to sign typed_data with their wallet.
const verified = await verifyAttestation({ typed_data, signature }, walletAddress);
```

Use `@ekubo/jurisdiction/worker` explicitly from Cloudflare Workers and Pages
Functions to use a statically imported WebAssembly module. The default entry
works in browsers, Node, and Bun without a network fetch. EIP-712 input schemas
are optionally exported from `@ekubo/jurisdiction/schema` for Zod 4 consumers.
Neither entry stores or logs proofs. Native Rust callers use
`ekubo_jurisdiction::verify_attestation(json, expected_wallet, unix_seconds)`.

The caller supplies its current clock. Proofs must use the known domain, types,
and statement, name an assigned ISO country code, and satisfy
`issuedAt <= now < expiresAt` with `0 < expiresAt - issuedAt <= 604800`.
Only 65-byte EOA signatures are supported. Error codes never contain proof data.
Asset restrictions and any disposal exceptions remain caller policy, separate
from verification that the user actually signed a valid domicile declaration.

Build with Bun, a Rust toolchain containing `wasm32-unknown-unknown`, and
`wasm-bindgen-cli` 0.2.126. Run `bun run build`, `bun test`, `cargo test`, and
`cargo clippy --all-targets -- -D warnings` from this directory. Build artifacts
are generated, not hand-edited. Publish the npm package and Rust crate from the
same versioned source. Until the first public release, consumers can vendor
identical `npm pack` / `cargo package` artifacts for reproducible review.

Browser apps can import payload construction from `@ekubo/jurisdiction/message`
and dynamically import the default verifier when the user signs, keeping Wasm
off the initial page load.
