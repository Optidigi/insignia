use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
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
    let c = claims(1, 2, 10_000, 9_007_199_254_740_993, 10_001, u64::MAX);
    let p = encode_payload(&c).unwrap();
    assert_eq!(&p[..8], b"ISG1\x01\x00\x00\x09");
    assert_eq!(&p[60..64], &[0, 1, 0, 2]);
    assert_eq!(&p[64..72], &112u64.to_be_bytes());
    assert_eq!(&p[72..76], &10_000u32.to_be_bytes());
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
fn signed_arithmetic_overflow_is_rejected_even_with_valid_signature() {
    let t = token(claims(0, 1, 2, u64::MAX, 2, u64::MAX));
    let k = keys();
    assert_eq!(
        verify_set(&[line(&t, 111, 2, Some(u64::MAX))], &context(&k), true),
        Err(Error::Overflow)
    );
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
