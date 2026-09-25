use insignia_m0_004_authorization::{
    decode_token, encode_payload, parse_hex, verify_signature, Claims, VerificationKey,
};
use serde_json::Value;
use std::path::PathBuf;

fn corpus() -> Value {
    let path = std::env::var("INSIGNIA_M0_004_VECTORS")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/vectors.json")
        });
    serde_json::from_slice(
        &std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display())),
    )
    .unwrap()
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap()
}
fn u64_str(v: &Value, key: &str) -> u64 {
    text(v, key).parse().unwrap()
}

fn claims(v: &Value) -> Claims {
    Claims {
        key_id: v["keyId"].as_u64().unwrap().try_into().unwrap(),
        generation: parse_hex(text(v, "generationHex")).unwrap(),
        epoch: v["epoch"].as_u64().unwrap().try_into().unwrap(),
        quote: parse_hex(text(v, "quoteHex")).unwrap(),
        set: parse_hex(text(v, "setHex")).unwrap(),
        index: v["lineIndex"].as_u64().unwrap().try_into().unwrap(),
        count: v["lineCount"].as_u64().unwrap().try_into().unwrap(),
        variant: u64_str(v, "variantId"),
        quantity: v["quantity"].as_u64().unwrap().try_into().unwrap(),
        unit_minor: u64_str(v, "unitMinor"),
        currency: text(v, "currency").as_bytes().try_into().unwrap(),
        exponent: v["exponent"].as_u64().unwrap().try_into().unwrap(),
        country: text(v, "country").as_bytes().try_into().unwrap(),
        market: u64_str(v, "marketId"),
        valid_through_day: v["validThroughDay"].as_u64().unwrap().try_into().unwrap(),
        total_quantity: v["totalQuantity"].as_u64().unwrap().try_into().unwrap(),
        total_minor: u64_str(v, "totalMinor"),
    }
}

#[test]
fn independent_python_crypto_vectors_match_rust_bytes_and_strict_verification() {
    let corpus = corpus();
    let key = VerificationKey {
        id: 7,
        bytes: parse_hex(text(&corpus, "publicKeyHex")).unwrap(),
    };
    for item in corpus["valid"].as_array().unwrap() {
        let c = claims(&item["claims"]);
        let p = encode_payload(&c).unwrap();
        assert_eq!(
            p,
            parse_hex(text(item, "payloadHex")).unwrap(),
            "{} payload",
            text(item, "name")
        );
        let auth = decode_token(text(item, "token")).unwrap();
        assert_eq!(auth.claims, c, "{} claims", text(item, "name"));
        assert_eq!(
            auth.signature,
            parse_hex(text(item, "signatureHex")).unwrap(),
            "{} signature",
            text(item, "name")
        );
        assert_eq!(auth.payload, p, "{} payload decode", text(item, "name"));
        assert_eq!(
            verify_signature(&auth, &[key]),
            Ok(()),
            "{} strict verify",
            text(item, "name")
        );
    }
    for item in corpus["invalid"].as_array().unwrap() {
        let result = decode_token(text(item, "token")).and_then(|a| verify_signature(&a, &[key]));
        assert!(result.is_err(), "{} must reject", text(item, "name"));
    }
}
