//! The single verifier used natively by the quoter and through Wasm by JS.
//! This crate has no network, storage, logging, or wall-clock dependency.
use alloy_primitives::{Address, B256, Signature, U256, keccak256};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{str::FromStr, sync::LazyLock};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub static PROTOCOL: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../protocol.json")).expect("valid checked-in protocol")
});
pub fn max_validity_seconds() -> u64 {
    PROTOCOL["maxValiditySeconds"]
        .as_u64()
        .expect("valid protocol TTL")
}
pub fn max_proof_bytes() -> usize {
    PROTOCOL["maxProofBytes"]
        .as_u64()
        .expect("valid protocol limit") as usize
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationError {
    InvalidPayload,
    InvalidTime,
    InvalidJurisdiction,
    WrongWallet,
    InvalidSignature,
}
impl std::fmt::Display for VerificationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for VerificationError {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Proof {
    typed_data: TypedData,
    signature: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TypedData {
    domain: Value,
    types: Value,
    #[serde(rename = "primaryType")]
    primary_type: String,
    message: Message,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    wallet: Address,
    jurisdiction_code: String,
    statement: String,
    issued_at: u64,
    expires_at: u64,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct VerifiedAttestation {
    pub wallet: Address,
    pub jurisdiction_code: String,
    pub issued_at: u64,
    pub expires_at: u64,
}
fn known_payload(data: &TypedData) -> bool {
    data.domain == PROTOCOL["domain"]
        && data.types == PROTOCOL["types"]
        && data.primary_type == PROTOCOL["primaryType"]
        && data.message.statement == PROTOCOL["statement"]
}
fn hash_words(words: &[B256]) -> B256 {
    keccak256(
        words
            .iter()
            .flat_map(|word| word.as_slice().iter().copied())
            .collect::<Vec<_>>(),
    )
}
fn message_type() -> String {
    let primary = PROTOCOL["primaryType"]
        .as_str()
        .expect("known primary type");
    let fields = PROTOCOL["types"][primary].as_array().expect("known fields");
    let fields = fields
        .iter()
        .map(|field| {
            format!(
                "{} {}",
                field["type"].as_str().unwrap(),
                field["name"].as_str().unwrap()
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!("{primary}({fields})")
}
fn payload_hash(message: &Message) -> B256 {
    let domain = hash_words(&[
        keccak256("EIP712Domain(string name,string version)"),
        keccak256(PROTOCOL["domain"]["name"].as_str().unwrap()),
        keccak256(PROTOCOL["domain"]["version"].as_str().unwrap()),
    ]);
    let body = hash_words(&[
        keccak256(message_type()),
        message.wallet.into_word(),
        keccak256(&message.jurisdiction_code),
        keccak256(&message.statement),
        B256::from(U256::from(message.issued_at).to_be_bytes()),
        B256::from(U256::from(message.expires_at).to_be_bytes()),
    ]);
    keccak256([&[0x19, 0x01][..], domain.as_slice(), body.as_slice()].concat())
}
fn valid_time(message: &Message, now: u64) -> bool {
    now <= MAX_SAFE_INTEGER
        && message.expires_at <= MAX_SAFE_INTEGER
        && message.issued_at <= now
        && message.expires_at > now
        && message
            .expires_at
            .checked_sub(message.issued_at)
            .is_some_and(|duration| duration > 0 && duration <= max_validity_seconds())
}
fn verify_wallet(
    message: &Message,
    expected_wallet: Option<&str>,
) -> Result<(), VerificationError> {
    if let Some(wallet) = expected_wallet {
        let wallet = Address::from_str(wallet).map_err(|_| VerificationError::WrongWallet)?;
        if message.wallet != wallet {
            return Err(VerificationError::WrongWallet);
        }
    }
    Ok(())
}
fn verify_signature(proof: &Proof) -> Result<(), VerificationError> {
    if proof.signature.len() != 132 || !proof.signature.starts_with("0x") {
        return Err(VerificationError::InvalidSignature);
    }
    let signature =
        Signature::from_str(&proof.signature).map_err(|_| VerificationError::InvalidSignature)?;
    let signer = signature
        .recover_address_from_prehash(&payload_hash(&proof.typed_data.message))
        .map_err(|_| VerificationError::InvalidSignature)?;
    if signer != proof.typed_data.message.wallet {
        return Err(VerificationError::InvalidSignature);
    }
    Ok(())
}
/// Verify a JSON proof at the caller's current Unix timestamp. No data is retained.
pub fn verify_attestation(
    json: &str,
    expected_wallet: Option<&str>,
    now: u64,
) -> Result<VerifiedAttestation, VerificationError> {
    if json.len() > max_proof_bytes() {
        return Err(VerificationError::InvalidPayload);
    }
    let proof: Proof = serde_json::from_str(json).map_err(|_| VerificationError::InvalidPayload)?;
    if !known_payload(&proof.typed_data) {
        return Err(VerificationError::InvalidPayload);
    }
    let message = &proof.typed_data.message;
    if !valid_time(message, now) {
        return Err(VerificationError::InvalidTime);
    }
    if !PROTOCOL["countryCodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|code| code == &message.jurisdiction_code)
    {
        return Err(VerificationError::InvalidJurisdiction);
    }
    verify_wallet(message, expected_wallet)?;
    verify_signature(&proof)?;
    Ok(VerifiedAttestation {
        wallet: message.wallet,
        jurisdiction_code: message.jurisdiction_code.clone(),
        issued_at: message.issued_at,
        expires_at: message.expires_at,
    })
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn verify_json(json: &str, expected_wallet: Option<String>, now: u64) -> String {
    // Return a stable error code, never a payload or a JS exception carrying it.
    match verify_attestation(json, expected_wallet.as_deref(), now) {
        Ok(value) => serde_json::to_string(&serde_json::json!({"ok": value})).unwrap(),
        Err(error) => serde_json::to_string(&serde_json::json!({"error": error})).unwrap(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const NOW: u64 = 1_800_000_000;
    const FIXTURE: &str = include_str!("../fixtures/valid.json");
    #[test]
    fn verifies_and_expires_the_viem_fixture() {
        let verified = verify_attestation(FIXTURE, None, NOW).unwrap();
        assert_eq!(verified.jurisdiction_code, "DE");
        assert!(verify_attestation(FIXTURE, None, NOW + max_validity_seconds() - 1).is_ok());
        assert_eq!(
            verify_attestation(FIXTURE, None, NOW + max_validity_seconds()),
            Err(VerificationError::InvalidTime)
        );
    }
    #[test]
    fn binds_to_expected_wallet() {
        assert_eq!(
            verify_attestation(
                FIXTURE,
                Some("0x1111111111111111111111111111111111111111"),
                NOW
            ),
            Err(VerificationError::WrongWallet)
        );
    }
    #[test]
    fn rejects_mutated_messages() {
        for (field, value) in [
            ("issuedAt", serde_json::json!(NOW + 1)),
            (
                "expiresAt",
                serde_json::json!(NOW + max_validity_seconds() + 1),
            ),
            ("jurisdictionCode", serde_json::json!("ZZ")),
            ("statement", serde_json::json!("other statement")),
            (
                "wallet",
                serde_json::json!("0x1111111111111111111111111111111111111111"),
            ),
        ] {
            let mut value_to_check: Value = serde_json::from_str(FIXTURE).unwrap();
            value_to_check["typed_data"]["message"][field] = value;
            assert!(verify_attestation(&value_to_check.to_string(), None, NOW).is_err());
        }
    }
    #[test]
    fn rejects_unknown_fields_and_large_proofs() {
        let mut value: Value = serde_json::from_str(FIXTURE).unwrap();
        value["extra"] = serde_json::json!(true);
        assert_eq!(
            verify_attestation(&value.to_string(), None, NOW),
            Err(VerificationError::InvalidPayload)
        );
        assert_eq!(
            verify_attestation(&" ".repeat(max_proof_bytes() + 1), None, NOW),
            Err(VerificationError::InvalidPayload)
        );
    }
}

#[cfg(test)]
mod conformance {
    use super::*;
    #[test]
    fn same_cases_as_wasm() {
        let cases: Value =
            serde_json::from_str(include_str!("../fixtures/conformance.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let proof = case["proof"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| case["proof"].to_string());
            let result = verify_attestation(
                &proof,
                case["wallet"].as_str(),
                case["now"].as_u64().unwrap(),
            );
            let actual = match result {
                Ok(value) => Value::String(value.jurisdiction_code),
                Err(error) => serde_json::to_value(error).unwrap(),
            };
            assert_eq!(actual, case["expected"], "{}", case["name"]);
        }
    }
}
