use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use insignia_m0_004_authorization::{
    decode_token, encode_payload, format_decimal_minor, parse_decimal_minor, verify_set, Claims,
    Error, ExpectedContext, PhysicalLine, VerificationKey, DOMAIN, PAYLOAD_LEN, TOKEN_CHARS,
    TOKEN_LEN,
};

const TEST_SEED: [u8; 32] = [7; 32]; // Synthetic local test only; never shop key material.

fn claims(
    index: u16,
    count: u16,
    quantity: u32,
    unit_minor: u64,
    total_quantity: u32,
    total_minor: u64,
) -> Claims {
    Claims {
        key_id: 9,
        generation: [1; 16],
        epoch: 4,
        quote: [2; 16],
        set: [3; 16],
        index,
        count,
        variant: 111 + u64::from(index),
        quantity,
        unit_minor,
        currency: *b"EUR",
        exponent: 2,
        country: *b"DE",
        market: 77,
        valid_through_day: 20_000,
        total_quantity,
        total_minor,
    }
}

fn token(c: Claims) -> String {
    let p = encode_payload(&c).unwrap();
    let mut message = DOMAIN.to_vec();
    message.extend_from_slice(&p);
    let sig = SigningKey::from_bytes(&TEST_SEED).sign(&message);
    let mut raw = p.to_vec();
    raw.extend_from_slice(&sig.to_bytes());
    URL_SAFE_NO_PAD.encode(raw)
}

fn keys() -> [VerificationKey; 1] {
    [VerificationKey {
        id: 9,
        bytes: SigningKey::from_bytes(&TEST_SEED)
            .verifying_key()
            .to_bytes(),
    }]
}

fn context<'a>(keys: &'a [VerificationKey]) -> ExpectedContext<'a> {
    ExpectedContext {
        generation: [1; 16],
        epoch: 4,
        currency: *b"EUR",
        country: *b"DE",
        market: 77,
        current_day: 20_000,
        max_buckets: 64,
        max_physical_quantity: 10_000,
        allow_no_market: false,
        keys,
    }
}

fn line<'a>(token: &'a str, variant: u64, quantity: u32, price: Option<u64>) -> PhysicalLine<'a> {
    PhysicalLine {
        token: Some(token),
        variant,
        quantity,
        observed_unit_minor: price,
        required: true,
        marked: true,
        selling_plan: false,
    }
}

#[test]
fn strict_transport_rejects_wrong_length_padding_and_noncanonical_tail() {
    assert!(decode_token("AA").is_err());
    assert!(decode_token(&"A".repeat(238)).is_err());
    let valid = token(claims(0, 1, 1, 3033, 1, 3033));
    assert_eq!(valid.len(), TOKEN_CHARS);
    assert_eq!(PAYLOAD_LEN, 114);
    assert_eq!(TOKEN_LEN, 178);
    assert_eq!(decode_token(&valid).unwrap().claims.unit_minor, 3033);
    assert_eq!(decode_token(&(valid.clone() + "=")), Err(Error::Encoding));
    assert_eq!(decode_token(&format!("{}A", valid)), Err(Error::Encoding));
    assert_eq!(
        decode_token(&format!("{}+", &valid[..TOKEN_CHARS - 1])),
        Err(Error::Encoding)
    );
    let mut alternate = valid.into_bytes();
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let position = alphabet
        .iter()
        .position(|b| *b == alternate[TOKEN_CHARS - 1])
        .unwrap();
    alternate[TOKEN_CHARS - 1] = alphabet[position ^ 1]; // Nonzero unused tail bits.
    assert_eq!(
        decode_token(std::str::from_utf8(&alternate).unwrap()),
        Err(Error::Encoding)
    );
}

#[test]
fn payload_bytes_match_fixed_offsets_and_wide_integers() {
    let c = claims(1, 2, 1, 9_007_199_254_740_993, 2, u64::MAX);
    let p = encode_payload(&c).unwrap();
    assert_eq!(&p[..8], b"ISG1\x01\x00\x00\x09");
    assert_eq!(&p[60..64], &[0, 1, 0, 2]);
    assert_eq!(&p[64..72], &112u64.to_be_bytes());
    assert_eq!(&p[72..76], &1u32.to_be_bytes());
    assert_eq!(&p[76..84], &9_007_199_254_740_993u64.to_be_bytes());
    assert_eq!(&p[106..114], &u64::MAX.to_be_bytes());
    assert_eq!(decode_token(&token(c)).unwrap().claims, c);
}

#[test]
fn complete_set_is_reusable_and_order_independent_but_not_partial() {
    let a = token(claims(0, 2, 2, 3033, 3, 9100));
    let b = token(claims(1, 2, 1, 3034, 3, 9100));
    let k = keys();
    let e = context(&k);
    assert!(verify_set(
        &[line(&b, 112, 1, Some(3034)), line(&a, 111, 2, Some(3033))],
        &e,
        true
    )
    .is_ok());
    assert!(verify_set(&[line(&a, 111, 2, Some(3033))], &e, true).is_err());
    assert_eq!(
        verify_set(
            &[line(&a, 111, 2, Some(3033)), line(&a, 111, 2, Some(3033))],
            &e,
            true
        ),
        Err(Error::Duplicate)
    );
    assert!(verify_set(
        &[line(&a, 111, 2, Some(3033)), line(&b, 112, 1, Some(3034))],
        &e,
        true
    )
    .is_ok());
}

#[test]
fn independent_context_price_and_markers_fail_closed() {
    let t = token(claims(0, 1, 1, 3000, 1, 3000));
    let k = keys();
    let mut e = context(&k);
    assert_eq!(
        verify_set(&[line(&t, 111, 1, None)], &e, true),
        Err(Error::MissingPrice)
    );
    assert_eq!(
        verify_set(&[line(&t, 111, 1, Some(2999))], &e, true),
        Err(Error::Line)
    );
    assert!(verify_set(&[line(&t, 111, 1, None)], &e, false).is_ok());
    e.country = *b"US";
    assert_eq!(
        verify_set(&[line(&t, 111, 1, Some(3000))], &e, true),
        Err(Error::Context)
    );
    e.country = *b"DE";
    e.current_day += 1;
    assert_eq!(
        verify_set(&[line(&t, 111, 1, Some(3000))], &e, true),
        Err(Error::Expired)
    );
    let mut physical = line(&t, 111, 1, Some(3000));
    physical.selling_plan = true;
    assert_eq!(
        verify_set(&[physical], &context(&k), true),
        Err(Error::Line)
    );
    let unsigned_required = PhysicalLine {
        token: None,
        variant: 111,
        quantity: 1,
        observed_unit_minor: Some(3000),
        required: true,
        marked: false,
        selling_plan: false,
    };
    assert_eq!(
        verify_set(&[unsigned_required], &context(&k), true),
        Err(Error::Line)
    );
}

#[test]
fn signature_and_key_failures_are_distinct() {
    let t = token(claims(0, 1, 1, 3000, 1, 3000));
    let k = keys();
    assert_eq!(
        verify_set(&[line(&t, 111, 1, Some(3000))], &context(&[]), true),
        Err(Error::UnknownKey)
    );
    let mut raw = URL_SAFE_NO_PAD.decode(t).unwrap();
    raw[160] ^= 1;
    let bad = URL_SAFE_NO_PAD.encode(raw);
    assert_eq!(
        verify_set(&[line(&bad, 111, 1, Some(3000))], &context(&k), true),
        Err(Error::Signature)
    );
}

#[test]
fn structural_duplicate_rejects_before_signature_but_every_complete_member_is_verified() {
    let first = token(claims(0, 2, 1, 3000, 2, 6000));
    let second = token(claims(1, 2, 1, 3000, 2, 6000));
    let mut tampered = URL_SAFE_NO_PAD.decode(&first).unwrap();
    tampered[114] ^= 1;
    let duplicate_bad_signature = URL_SAFE_NO_PAD.encode(tampered);
    let k = keys();
    assert_eq!(
        verify_set(
            &[
                line(&first, 111, 1, Some(3000)),
                line(&duplicate_bad_signature, 111, 1, Some(3000))
            ],
            &context(&k),
            true
        ),
        Err(Error::Duplicate)
    );
    let mut last_bad = URL_SAFE_NO_PAD.decode(&second).unwrap();
    last_bad[114] ^= 1;
    let last_bad = URL_SAFE_NO_PAD.encode(last_bad);
    assert_eq!(
        verify_set(
            &[
                line(&first, 111, 1, Some(3000)),
                line(&last_bad, 112, 1, Some(3000))
            ],
            &context(&k),
            true
        ),
        Err(Error::Signature)
    );
}

#[test]
fn strict_ed25519_rejects_weak_key_and_noncanonical_signature_scalar() {
    let t = token(claims(0, 1, 1, 3000, 1, 3000));
    let weak = [VerificationKey {
        id: 9,
        bytes: [0; 32],
    }];
    assert_eq!(
        verify_set(&[line(&t, 111, 1, Some(3000))], &context(&weak), true),
        Err(Error::Signature)
    );

    let mut raw = URL_SAFE_NO_PAD.decode(t).unwrap();
    // The Ed25519 group order L in little-endian form is an invalid (noncanonical) S scalar.
    raw[146..178].copy_from_slice(&[
        0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde,
        0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x10,
    ]);
    let bad = URL_SAFE_NO_PAD.encode(raw);
    let k = keys();
    assert_eq!(
        verify_set(&[line(&bad, 111, 1, Some(3000))], &context(&k), true),
        Err(Error::Signature)
    );
}

#[test]
fn identity_key_identity_r_zero_s_is_rejected_by_pinned_strict_verifier_and_admission() {
    let mut identity = [0; 32];
    identity[0] = 1; // Ed25519 compressed identity point.
    let key = VerifyingKey::from_bytes(&identity).unwrap();
    assert!(key.is_weak());
    let mut signature = [0; 64];
    signature[0] = 1; // R = identity; S = zero.
    let signature = Signature::from_bytes(&signature);
    assert!(key
        .verify_strict(b"pinned strict verifier probe", &signature)
        .is_err());

    let valid = token(claims(0, 1, 1, 3000, 1, 3000));
    let normal = keys();
    assert!(verify_set(&[line(&valid, 111, 1, Some(3000))], &context(&normal), true).is_ok());
    let mut forged = URL_SAFE_NO_PAD.decode(&valid).unwrap();
    forged[PAYLOAD_LEN..].copy_from_slice(&signature.to_bytes());
    let forged = URL_SAFE_NO_PAD.encode(forged);
    let weak = [VerificationKey {
        id: 9,
        bytes: identity,
    }];
    assert_eq!(
        verify_set(&[line(&valid, 111, 1, Some(3000))], &context(&weak), true),
        Err(Error::Signature)
    );
    assert_eq!(
        verify_set(&[line(&forged, 111, 1, Some(3000))], &context(&weak), true),
        Err(Error::Signature)
    );
    assert_eq!(
        verify_set(
            &[line(&forged, 111, 1, Some(3000))],
            &context(&normal),
            true
        ),
        Err(Error::Signature)
    );
    let config = format!(
        "{{\"generationHex\":\"{}\",\"epoch\":4,\"maxBuckets\":1,\"maxPhysicalQuantity\":1,\"allowNoMarket\":false,\"keys\":[{{\"id\":9,\"publicHex\":\"{}\"}}]}}",
        "01".repeat(16), hex_bytes(&identity)
    );
    assert!(insignia_m0_004_authorization::parse_public_config(&config).is_err());
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn whole_set_accepts_only_current_day_in_expiry_minus_two_through_expiry() {
    let mut c = claims(0, 1, 1, 3000, 1, 3000);
    c.valid_through_day = 20_002;
    let t = token(c);
    let k = keys();
    for (day, result) in [
        (19_999, Err(Error::Expired)),
        (20_000, Ok(())),
        (20_001, Ok(())),
        (20_002, Ok(())),
        (20_003, Err(Error::Expired)),
    ] {
        let mut expected = context(&k);
        expected.current_day = day;
        assert_eq!(
            verify_set(&[line(&t, 111, 1, Some(3000))], &expected, true).map(|_| ()),
            result
        );
    }
    c.valid_through_day = 30_000;
    let future = token(c);
    assert_eq!(
        verify_set(&[line(&future, 111, 1, Some(3000))], &context(&k), true),
        Err(Error::Expired)
    );

    for (expiry, day, result) in [
        (0, 0, Ok(())),
        (1, 0, Ok(())),
        (2, 0, Ok(())),
        (3, 0, Err(Error::Expired)),
        (u32::MAX, u32::MAX - 2, Ok(())),
        (u32::MAX, u32::MAX - 3, Err(Error::Expired)),
        (u32::MAX - 1, u32::MAX, Err(Error::Expired)),
    ] {
        c.valid_through_day = expiry;
        let boundary = token(c);
        let mut expected = context(&k);
        expected.current_day = day;
        assert_eq!(
            verify_set(&[line(&boundary, 111, 1, Some(3000))], &expected, true).map(|_| ()),
            result
        );
    }
}

#[test]
fn removing_a_group_cannot_preserve_the_signed_500_unit_tier() {
    let shirts = token(claims(0, 2, 250, 2314, 500, 1_458_500));
    let hoodies = token(claims(1, 2, 250, 3520, 500, 1_458_500));
    let k = keys();
    let e = context(&k);
    assert!(verify_set(
        &[
            line(&shirts, 111, 250, Some(2314)),
            line(&hoodies, 112, 250, Some(3520))
        ],
        &e,
        true
    )
    .is_ok());
    assert_eq!(
        verify_set(&[line(&shirts, 111, 250, Some(2314))], &e, true),
        Err(Error::Incomplete)
    );
}

#[test]
fn five_schema_legal_2000_unit_buckets_sum_10000_without_unit_objects() {
    let tokens: Vec<_> = (0..5)
        .map(|i| token(claims(i, 5, 2000, 1000, 10_000, 10_000_000)))
        .collect();
    let lines: Vec<_> = tokens
        .iter()
        .enumerate()
        .map(|(i, t)| line(t, 111 + i as u64, 2000, Some(1000)))
        .collect();
    let k = keys();
    assert_eq!(verify_set(&lines, &context(&k), true).unwrap().len(), 5);
}

#[test]
fn trusted_physical_quantity_capacity_rejects_10001_even_when_signed_totals_match() {
    let t = token(claims(0, 1, 10_001, 1000, 10_001, 10_001_000));
    let k = keys();
    assert_eq!(
        verify_set(&[line(&t, 111, 10_001, Some(1000))], &context(&k), true),
        Err(Error::Line)
    );
}

#[test]
fn key_rotation_accepts_separate_sets_but_rejects_mixed_keys_within_one_set() {
    let first = claims(0, 2, 1, 1000, 2, 2000);
    let mut second = claims(1, 2, 1, 1000, 2, 2000);
    second.key_id = 10;
    let old = token(first);
    let mixed = token(second);
    let old_key = keys()[0];
    let rotated_keys = [
        old_key,
        VerificationKey {
            id: 10,
            bytes: old_key.bytes,
        },
    ];
    let e = context(&rotated_keys);
    assert_eq!(
        verify_set(
            &[
                line(&old, 111, 1, Some(1000)),
                line(&mixed, 112, 1, Some(1000))
            ],
            &e,
            true
        ),
        Err(Error::Context)
    );
    let mut new_first = first;
    new_first.key_id = 10;
    new_first.set = [4; 16];
    second.set = [4; 16];
    let new_a = token(new_first);
    let new_b = token(second);
    assert!(verify_set(
        &[
            line(&new_a, 111, 1, Some(1000)),
            line(&new_b, 112, 1, Some(1000))
        ],
        &e,
        true
    )
    .is_ok());
    let old_b = token(claims(1, 2, 1, 1000, 2, 2000));
    assert!(verify_set(
        &[
            line(&old, 111, 1, Some(1000)),
            line(&old_b, 112, 1, Some(1000))
        ],
        &e,
        true
    )
    .is_ok());
}

#[test]
fn signed_arithmetic_overflow_is_rejected_even_with_valid_signature() {
    let a = token(claims(0, 2, 1, u64::MAX, 2, u64::MAX));
    let b = token(claims(1, 2, 1, u64::MAX, 2, u64::MAX));
    let k = keys();
    assert_eq!(
        verify_set(
            &[
                line(&a, 111, 1, Some(u64::MAX)),
                line(&b, 112, 1, Some(u64::MAX))
            ],
            &context(&k),
            true
        ),
        Err(Error::Overflow)
    );
}

#[test]
fn codec_rejects_claims_larger_than_declared_quote() {
    let c = claims(0, 1, 2, 100, 1, 100);
    assert_eq!(encode_payload(&c), Err(Error::Line));
    let mut p = encode_payload(&claims(0, 1, 2, 100, 2, 200)).unwrap();
    p[102..106].copy_from_slice(&1u32.to_be_bytes());
    assert_eq!(
        insignia_m0_004_authorization::decode_payload(&p),
        Err(Error::Line)
    );
    p[102..106].copy_from_slice(&2u32.to_be_bytes());
    p[106..114].copy_from_slice(&100u64.to_be_bytes());
    assert_eq!(
        insignia_m0_004_authorization::decode_payload(&p),
        Err(Error::Line)
    );
}

#[test]
fn non_ascii_hex_public_config_rejects_without_panic() {
    use insignia_m0_004_authorization::{parse_hex, parse_public_config};
    let malformed = format!("aé{}", "0".repeat(29));
    assert_eq!(malformed.len(), 32);
    assert_eq!(parse_hex::<16>(&malformed), Err(Error::Encoding));
    let config = format!(
        "{{\"generationHex\":\"{}\",\"epoch\":1,\"maxBuckets\":1,\"maxPhysicalQuantity\":1,\"allowNoMarket\":false,\"keys\":[{{\"id\":1,\"publicHex\":\"{}\"}}]}}",
        malformed, "00".repeat(32)
    );
    assert!(matches!(parse_public_config(&config), Err(Error::Encoding)));
}

#[test]
fn money_is_lexical_checked_and_round_trips_without_float() {
    assert_eq!(parse_decimal_minor("30.33", 2), Ok(3033));
    assert_eq!(format_decimal_minor(3033, 2).as_deref(), Ok("30.33"));
    assert_eq!(parse_decimal_minor("1.001", 3), Ok(1001));
    assert_eq!(parse_decimal_minor("8", 0), Ok(8));
    assert_eq!(parse_decimal_minor("30.3300", 2), Ok(3033));
    assert_eq!(parse_decimal_minor("8.000", 0), Ok(8));
    assert!(parse_decimal_minor("30.333", 2).is_err());
    assert!(parse_decimal_minor("30.3301", 2).is_err());
    assert!(parse_decimal_minor("1e3", 2).is_err());
    assert!(parse_decimal_minor("18446744073709551616", 0).is_err());
}

#[test]
fn shop_local_dates_have_calendar_not_elapsed_hour_boundaries() {
    use insignia_m0_004_authorization::parse_shop_local_day;
    assert_eq!(parse_shop_local_day("1970-01-01"), Ok(0));
    assert_eq!(parse_shop_local_day("2024-02-28"), Ok(19781));
    assert_eq!(parse_shop_local_day("2024-03-01"), Ok(19783));
    assert!(parse_shop_local_day("2023-02-29").is_err());
    assert!(parse_shop_local_day("2024-13-01").is_err());
}
