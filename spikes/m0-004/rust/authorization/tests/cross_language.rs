use insignia_m0_004_authorization::{
    decode_token, encode_payload, parse_hex, verify_set, verify_signature, Claims, Error,
    ExpectedContext, PhysicalLine, VerificationKey,
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
        let item_key = VerificationKey {
            id: key.id,
            bytes: item["publicKeyHex"]
                .as_str()
                .map(parse_hex)
                .transpose()
                .unwrap()
                .unwrap_or(key.bytes),
        };
        let result =
            decode_token(text(item, "token")).and_then(|a| verify_signature(&a, &[item_key]));
        assert!(result.is_err(), "{} must reject", text(item, "name"));
        if text(item, "name").starts_with("highbit_magic_mask_") {
            assert_eq!(
                result,
                Err(Error::Header),
                "{} parser stage",
                text(item, "name")
            );
        }
        if text(item, "name") == "weak_identity_key_r_identity_s_zero" {
            assert_eq!(result, Err(Error::Signature), "weak key strict stage");
        }
    }
}

#[test]
fn independent_eur91_vectors_form_one_exact_complete_set() {
    let corpus = corpus();
    let valid = corpus["valid"].as_array().unwrap();
    let key = VerificationKey {
        id: 7,
        bytes: parse_hex(text(&corpus, "publicKeyHex")).unwrap(),
    };
    let expected = ExpectedContext {
        generation: [0x11; 16],
        epoch: 4,
        currency: *b"EUR",
        country: *b"DE",
        market: 42,
        current_day: 20_802,
        max_buckets: 2,
        max_physical_quantity: 3,
        allow_no_market: false,
        keys: std::slice::from_ref(&key),
    };
    let lines: Vec<_> = valid[..2]
        .iter()
        .map(|v| {
            let c = &v["claims"];
            PhysicalLine {
                token: Some(text(v, "token")),
                variant: u64_str(c, "variantId"),
                quantity: c["quantity"].as_u64().unwrap().try_into().unwrap(),
                observed_unit_minor: Some(u64_str(c, "unitMinor")),
                required: true,
                marked: true,
                selling_plan: false,
            }
        })
        .collect();
    assert_eq!(verify_set(&lines, &expected, true).unwrap().len(), 2);
    assert!(verify_set(&lines[..1], &expected, true).is_err());
}
