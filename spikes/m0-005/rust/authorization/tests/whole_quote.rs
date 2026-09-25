use ed25519_dalek::{Signer, SigningKey};
use insignia_m0_005_authorization::{
    decode_envelope, decode_member, verify_set, Error, ExpectedContext, PhysicalLine,
    VerificationKey, DOMAIN, HEADER_LEN,
};

const SEED: [u8; 32] = [1; 32];

fn fixture() -> (String, Vec<String>, VerificationKey) {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let signing = SigningKey::from_bytes(&SEED);
    let key = VerificationKey::new(7, signing.verifying_key().to_bytes()).unwrap();
    let mut header = [0u8; HEADER_LEN];
    header[..4].copy_from_slice(b"ISG2");
    header[4] = 2;
    header[6..8].copy_from_slice(&7u16.to_be_bytes());
    header[8..24].fill(0x11);
    header[24..28].copy_from_slice(&4u32.to_be_bytes());
    header[28..44].fill(0x22);
    header[44..60].fill(0x33);
    header[60..62].copy_from_slice(&2u16.to_be_bytes());
    header[62..65].copy_from_slice(b"EUR");
    header[65] = 2;
    header[66..68].copy_from_slice(b"DE");
    header[68..76].copy_from_slice(&42u64.to_be_bytes());
    header[76..80].copy_from_slice(&20804u32.to_be_bytes());
    header[80..84].copy_from_slice(&3u32.to_be_bytes());
    header[84..92].copy_from_slice(&9100u64.to_be_bytes());
    let mut records = vec![[0u8; 22]; 2];
    for (i, record) in records.iter_mut().enumerate() {
        record[..2].copy_from_slice(&(i as u16).to_be_bytes());
        record[2..10].copy_from_slice(&9007199254740993u64.to_be_bytes());
        record[10..14].copy_from_slice(&(if i == 0 { 2u32 } else { 1 }).to_be_bytes());
        record[14..22].copy_from_slice(&(if i == 0 { 3033u64 } else { 3034 }).to_be_bytes());
    }
    let mut message = DOMAIN.to_vec();
    message.extend_from_slice(&header);
    for record in &records {
        message.extend_from_slice(record);
    }
    let signature = signing.sign(&message).to_bytes();
    let mut envelope = header.to_vec();
    envelope.extend_from_slice(&signature);
    (
        URL_SAFE_NO_PAD.encode(envelope),
        records.iter().map(|r| URL_SAFE_NO_PAD.encode(r)).collect(),
        key,
    )
}

fn uniform_fixture(
    count: u16,
    per_bucket_quantity: u32,
    unit_minor: u64,
) -> (String, Vec<String>, VerificationKey) {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (base, _, key) = fixture();
    let mut raw = URL_SAFE_NO_PAD.decode(base).unwrap();
    raw[60..62].copy_from_slice(&count.to_be_bytes());
    raw[80..84].copy_from_slice(&(u32::from(count) * per_bucket_quantity).to_be_bytes());
    raw[84..92].copy_from_slice(
        &(u64::from(count) * u64::from(per_bucket_quantity) * unit_minor).to_be_bytes(),
    );
    let records: Vec<[u8; 22]> = (0..count)
        .map(|i| {
            let mut record = [0; 22];
            record[..2].copy_from_slice(&i.to_be_bytes());
            record[2..10].copy_from_slice(&9007199254740993u64.to_be_bytes());
            record[10..14].copy_from_slice(&per_bucket_quantity.to_be_bytes());
            record[14..22].copy_from_slice(&unit_minor.to_be_bytes());
            record
        })
        .collect();
    let mut message = DOMAIN.to_vec();
    message.extend_from_slice(&raw[..HEADER_LEN]);
    for record in &records {
        message.extend_from_slice(record);
    }
    raw[HEADER_LEN..].copy_from_slice(&SigningKey::from_bytes(&SEED).sign(&message).to_bytes());
    (
        URL_SAFE_NO_PAD.encode(raw),
        records.iter().map(|r| URL_SAFE_NO_PAD.encode(r)).collect(),
        key,
    )
}

fn expected<'a>(keys: &'a [VerificationKey]) -> ExpectedContext<'a> {
    ExpectedContext {
        generation: [0x11; 16],
        epoch: 4,
        currency: *b"EUR",
        country: *b"DE",
        market: 42,
        current_day: 20803,
        max_buckets: 64,
        max_physical_quantity: 10000,
        allow_no_market: false,
        keys,
    }
}

#[test]
fn complete_ordered_set_verifies_once_and_matches_observed_price() {
    let (envelope, members, key) = fixture();
    let keys = [key];
    let lines = [
        PhysicalLine {
            member: Some(&members[1]),
            variant: 9007199254740993,
            quantity: 1,
            observed_unit_minor: Some(3034),
            required: true,
            marked: true,
            selling_plan: false,
        },
        PhysicalLine {
            member: Some(&members[0]),
            variant: 9007199254740993,
            quantity: 2,
            observed_unit_minor: Some(3033),
            required: true,
            marked: true,
            selling_plan: false,
        },
    ];
    let claims = verify_set(Some(&envelope), &lines, &expected(&keys), true).unwrap();
    assert_eq!(
        claims.iter().map(|c| c.index).collect::<Vec<_>>(),
        vec![1, 0]
    );
    assert_eq!(claims[0].unit_minor, 3034);
    assert_eq!(decode_envelope(&envelope).unwrap().header.count, 2);
    assert_eq!(decode_member(&members[0]).unwrap().index, 0);
}

#[test]
fn last_member_change_invalidates_everything() {
    let (envelope, mut members, key) = fixture();
    let keys = [key];
    let mut raw = decode_member(&members[1]).unwrap().raw;
    raw[21] ^= 1;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    members[1] = URL_SAFE_NO_PAD.encode(raw);
    let lines = [
        PhysicalLine {
            member: Some(&members[0]),
            variant: 9007199254740993,
            quantity: 2,
            observed_unit_minor: None,
            required: true,
            marked: true,
            selling_plan: false,
        },
        PhysicalLine {
            member: Some(&members[1]),
            variant: 9007199254740993,
            quantity: 1,
            observed_unit_minor: None,
            required: true,
            marked: true,
            selling_plan: false,
        },
    ];
    assert!(matches!(
        verify_set(Some(&envelope), &lines, &expected(&keys), false),
        Err(Error::Incomplete | Error::Signature)
    ));
}

fn lines(members: &[String]) -> Vec<PhysicalLine<'_>> {
    members
        .iter()
        .enumerate()
        .map(|(i, m)| PhysicalLine {
            member: Some(m),
            variant: 9007199254740993,
            quantity: if i == 0 { 2 } else { 1 },
            observed_unit_minor: Some(if i == 0 { 3033 } else { 3034 }),
            required: true,
            marked: true,
            selling_plan: false,
        })
        .collect()
}

#[test]
fn canonical_carriers_reject_length_padding_alphabet_and_tail_bits() {
    let (envelope, members, _) = fixture();
    assert_eq!(
        decode_envelope(&(envelope.clone() + "=")).err(),
        Some(Error::Encoding)
    );
    assert_eq!(
        decode_envelope(&envelope[..207]).err(),
        Some(Error::Encoding)
    );
    assert_eq!(
        decode_member(&(members[0].clone() + "=")).err(),
        Some(Error::Encoding)
    );
    assert_eq!(
        decode_member(&members[0].replace('-', "+")).err(),
        if members[0].contains('-') {
            Some(Error::Encoding)
        } else {
            None
        }
    );
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // 156 envelope bytes have no unused base64 tail bits; its length and alphabet still bind encoding.
    let mut bad_member = members[0].clone().into_bytes();
    let idx = alphabet.iter().position(|b| *b == bad_member[29]).unwrap();
    bad_member[29] = alphabet[idx ^ 1];
    assert_eq!(
        decode_member(std::str::from_utf8(&bad_member).unwrap()).err(),
        Some(Error::Encoding)
    );
}

#[test]
fn every_header_byte_class_is_signed_and_structural_header_is_strict() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (envelope, members, key) = fixture();
    let keys = [key];
    let original = URL_SAFE_NO_PAD.decode(envelope).unwrap();
    for offset in [0, 4, 5, 6, 8, 24, 28, 44, 60, 62, 65, 66, 68, 76, 84] {
        let mut raw = original.clone();
        raw[offset] ^= 0x80;
        assert!(
            verify_set(
                Some(&URL_SAFE_NO_PAD.encode(raw)),
                &lines(&members),
                &expected(&keys),
                true
            )
            .is_err(),
            "header offset {offset}"
        );
    }
    for (offset, value) in [(4, 3), (5, 1)] {
        let mut raw = original.clone();
        raw[offset] = value;
        assert_eq!(
            decode_envelope(&URL_SAFE_NO_PAD.encode(raw)).err(),
            Some(Error::Header)
        );
    }
}

#[test]
fn shared_python_typescript_rust_golden_vector_agrees() {
    let vector: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/vectors.json")).unwrap();
    let envelope = vector["envelope"].as_str().unwrap();
    let first = vector["memberTokens"][0].as_str().unwrap();
    let second = vector["memberTokens"][1].as_str().unwrap();
    let public =
        insignia_m0_005_authorization::parse_hex::<32>(vector["publicHex"].as_str().unwrap())
            .unwrap();
    let keys = [VerificationKey::new(7, public).unwrap()];
    let physical = [
        PhysicalLine {
            member: Some(first),
            variant: 9007199254740993,
            quantity: 2,
            observed_unit_minor: Some(3033),
            required: true,
            marked: true,
            selling_plan: false,
        },
        PhysicalLine {
            member: Some(second),
            variant: 9007199254740993,
            quantity: 1,
            observed_unit_minor: Some(3034),
            required: true,
            marked: true,
            selling_plan: false,
        },
    ];
    let mut context = expected(&keys);
    context.current_day = 20800;
    let claims = verify_set(Some(envelope), &physical, &context, true).unwrap();
    assert_eq!(claims.len(), 2);
    let expected_header = insignia_m0_005_authorization::parse_hex::<HEADER_LEN>(
        vector["headerHex"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(
        decode_envelope(envelope).unwrap().header.raw,
        expected_header
    );
}

#[test]
fn fifteen_independently_signed_high_bit_magic_variants_reject() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (envelope, members, key) = fixture();
    let keys = [key];
    let original = URL_SAFE_NO_PAD.decode(envelope).unwrap();
    let records: Vec<Vec<u8>> = members
        .iter()
        .map(|m| URL_SAFE_NO_PAD.decode(m).unwrap())
        .collect();
    for mask in 1u8..16 {
        let mut raw = original.clone();
        for (bit, value) in raw.iter_mut().enumerate().take(4) {
            if mask & (1 << bit) != 0 {
                *value |= 0x80;
            }
        }
        let mut message = DOMAIN.to_vec();
        message.extend_from_slice(&raw[..HEADER_LEN]);
        for record in &records {
            message.extend_from_slice(record);
        }
        raw[HEADER_LEN..].copy_from_slice(&SigningKey::from_bytes(&SEED).sign(&message).to_bytes());
        assert_eq!(
            decode_envelope(&URL_SAFE_NO_PAD.encode(&raw)).err(),
            Some(Error::Header),
            "mask {mask}"
        );
        assert!(verify_set(
            Some(&URL_SAFE_NO_PAD.encode(raw)),
            &lines(&members),
            &expected(&keys),
            true
        )
        .is_err());
    }
}

#[test]
fn independent_context_keys_date_and_physical_economics_reject() {
    let (envelope, members, key) = fixture();
    let keys = [key];
    assert_eq!(
        verify_set(Some(&envelope), &lines(&members), &expected(&[]), true).err(),
        Some(Error::UnknownKey)
    );
    for day in [20802, 20803, 20804] {
        let mut ctx = expected(&keys);
        ctx.current_day = day;
        assert!(verify_set(Some(&envelope), &lines(&members), &ctx, true).is_ok());
    }
    for day in [20801, 20805] {
        let mut ctx = expected(&keys);
        ctx.current_day = day;
        assert_eq!(
            verify_set(Some(&envelope), &lines(&members), &ctx, true).err(),
            Some(Error::Expired)
        );
    }
    let mut ctx = expected(&keys);
    ctx.generation[0] ^= 1;
    assert_eq!(
        verify_set(Some(&envelope), &lines(&members), &ctx, true).err(),
        Some(Error::Context)
    );
    let mut ctx = expected(&keys);
    ctx.epoch += 1;
    assert_eq!(
        verify_set(Some(&envelope), &lines(&members), &ctx, true).err(),
        Some(Error::Context)
    );
    let mut ctx = expected(&keys);
    ctx.currency = *b"USD";
    assert_eq!(
        verify_set(Some(&envelope), &lines(&members), &ctx, true).err(),
        Some(Error::Context)
    );
    let mut ctx = expected(&keys);
    ctx.country = *b"US";
    assert_eq!(
        verify_set(Some(&envelope), &lines(&members), &ctx, true).err(),
        Some(Error::Context)
    );
    let mut ctx = expected(&keys);
    ctx.market += 1;
    assert_eq!(
        verify_set(Some(&envelope), &lines(&members), &ctx, true).err(),
        Some(Error::Context)
    );
    let mut changed = lines(&members);
    changed[1].variant += 1;
    assert_eq!(
        verify_set(Some(&envelope), &changed, &expected(&keys), true).err(),
        Some(Error::Line)
    );
    let mut changed = lines(&members);
    changed[1].quantity += 1;
    assert_eq!(
        verify_set(Some(&envelope), &changed, &expected(&keys), true).err(),
        Some(Error::Line)
    );
    let mut changed = lines(&members);
    changed[1].observed_unit_minor = Some(3035);
    assert_eq!(
        verify_set(Some(&envelope), &changed, &expected(&keys), true).err(),
        Some(Error::Line)
    );
    let mut changed = lines(&members);
    changed[1].selling_plan = true;
    assert_eq!(
        verify_set(Some(&envelope), &changed, &expected(&keys), true).err(),
        Some(Error::Line)
    );
}

#[test]
fn missing_duplicate_unsigned_and_extra_members_fail_closed() {
    let (envelope, members, key) = fixture();
    let keys = [key];
    assert_eq!(
        verify_set(
            Some(&envelope),
            &lines(&members[..1]),
            &expected(&keys),
            false
        )
        .err(),
        Some(Error::Incomplete)
    );
    assert_eq!(
        verify_set(None, &lines(&members), &expected(&keys), false).err(),
        Some(Error::Incomplete)
    );
    assert_eq!(
        verify_set(Some(&envelope), &[], &expected(&keys), false).err(),
        Some(Error::Incomplete)
    );
    let duplicate = vec![members[0].clone(), members[0].clone()];
    assert!(verify_set(Some(&envelope), &lines(&duplicate), &expected(&keys), false).is_err());
    let mut extra = lines(&members);
    extra.push(PhysicalLine {
        member: Some(&members[0]),
        variant: 9007199254740993,
        quantity: 2,
        observed_unit_minor: None,
        required: false,
        marked: true,
        selling_plan: false,
    });
    assert_eq!(
        verify_set(Some(&envelope), &extra, &expected(&keys), false).err(),
        Some(Error::Incomplete)
    );
    let required = PhysicalLine {
        member: None,
        variant: 1,
        quantity: 1,
        observed_unit_minor: None,
        required: true,
        marked: false,
        selling_plan: false,
    };
    assert!(verify_set(None, &[required], &expected(&keys), false).is_err());
    let ordinary = PhysicalLine {
        member: None,
        variant: 1,
        quantity: 1,
        observed_unit_minor: None,
        required: false,
        marked: false,
        selling_plan: false,
    };
    assert!(verify_set(None, &[ordinary], &expected(&keys), false).is_ok());
}

#[test]
fn signature_and_arithmetic_profiles_reject_mutations() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (envelope, members, key) = fixture();
    let keys = [key];
    assert_eq!(
        VerificationKey::new(7, [0; 32]).err(),
        Some(Error::Signature)
    );
    let mut identity = [0; 32];
    identity[0] = 1;
    assert_eq!(
        VerificationKey::new(7, identity).err(),
        Some(Error::Signature)
    );
    let mut raw = URL_SAFE_NO_PAD.decode(&envelope).unwrap();
    raw[92] ^= 1;
    assert_eq!(
        verify_set(
            Some(&URL_SAFE_NO_PAD.encode(&raw)),
            &lines(&members),
            &expected(&keys),
            false
        )
        .err(),
        Some(Error::Signature)
    );
    raw = URL_SAFE_NO_PAD.decode(&envelope).unwrap();
    let order_l: [u8; 32] = [
        0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde,
        0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
    ];
    let mut carry = 0u16;
    for (i, byte) in order_l.iter().enumerate() {
        let sum = u16::from(raw[124 + i]) + u16::from(*byte) + carry;
        raw[124 + i] = sum as u8;
        carry = sum >> 8;
    }
    assert_eq!(carry, 0);
    assert_eq!(
        verify_set(
            Some(&URL_SAFE_NO_PAD.encode(raw)),
            &lines(&members),
            &expected(&keys),
            false
        )
        .err(),
        Some(Error::Signature)
    );
    let mut overflow_member = URL_SAFE_NO_PAD.decode(&members[0]).unwrap();
    overflow_member[14..22].copy_from_slice(&u64::MAX.to_be_bytes());
    let changed = vec![URL_SAFE_NO_PAD.encode(overflow_member), members[1].clone()];
    assert_eq!(
        verify_set(Some(&envelope), &lines(&changed), &expected(&keys), false).err(),
        Some(Error::Overflow)
    );
}

#[test]
fn large_complete_quantity_and_500_unit_tier_cannot_be_partially_reused() {
    for (count, quantity) in [(2, 250), (5, 2000)] {
        let (envelope, members, key) = uniform_fixture(count, quantity, 3000);
        let keys = [key];
        let physical: Vec<_> = members
            .iter()
            .map(|m| PhysicalLine {
                member: Some(m),
                variant: 9007199254740993,
                quantity,
                observed_unit_minor: Some(3000),
                required: true,
                marked: true,
                selling_plan: false,
            })
            .collect();
        assert_eq!(
            verify_set(Some(&envelope), &physical, &expected(&keys), true)
                .unwrap()
                .len(),
            usize::from(count)
        );
        assert_eq!(
            verify_set(
                Some(&envelope),
                &physical[..physical.len() - 1],
                &expected(&keys),
                true
            )
            .err(),
            Some(Error::Incomplete)
        );
    }
    let (envelope, members, key) = uniform_fixture(65, 1, 3000);
    let keys = [key];
    let physical: Vec<_> = members
        .iter()
        .map(|m| PhysicalLine {
            member: Some(m),
            variant: 9007199254740993,
            quantity: 1,
            observed_unit_minor: None,
            required: true,
            marked: true,
            selling_plan: false,
        })
        .collect();
    assert_eq!(
        verify_set(Some(&envelope), &physical, &expected(&keys), false).err(),
        Some(Error::Incomplete)
    );
}

#[test]
fn compensated_price_mutations_cannot_preserve_authorization_by_preserving_total() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (envelope, members, key) = fixture();
    let keys = [key];
    let mut first = URL_SAFE_NO_PAD.decode(&members[0]).unwrap();
    let mut last = URL_SAFE_NO_PAD.decode(&members[1]).unwrap();
    first[14..22].copy_from_slice(&3034u64.to_be_bytes());
    last[14..22].copy_from_slice(&3032u64.to_be_bytes());
    let changed = vec![URL_SAFE_NO_PAD.encode(first), URL_SAFE_NO_PAD.encode(last)];
    assert_eq!(
        verify_set(Some(&envelope), &lines(&changed), &expected(&keys), false).err(),
        Some(Error::Signature)
    );
}

#[test]
fn member_from_a_different_signed_quote_cannot_mix_with_original_envelope() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (envelope, members, key) = fixture();
    let keys = [key];
    let mut other_header = URL_SAFE_NO_PAD.decode(&envelope).unwrap();
    other_header[28] ^= 1; // genuinely different accepted quote and authorization set
    other_header[44] ^= 1;
    let first = URL_SAFE_NO_PAD.decode(&members[0]).unwrap();
    let mut last = URL_SAFE_NO_PAD.decode(&members[1]).unwrap();
    last[2..10].copy_from_slice(&9007199254740994u64.to_be_bytes());
    let mut message = DOMAIN.to_vec();
    message.extend_from_slice(&other_header[..HEADER_LEN]);
    message.extend_from_slice(&first);
    message.extend_from_slice(&last);
    other_header[HEADER_LEN..]
        .copy_from_slice(&SigningKey::from_bytes(&SEED).sign(&message).to_bytes());
    let other_envelope = URL_SAFE_NO_PAD.encode(other_header);
    let mixed = vec![members[0].clone(), URL_SAFE_NO_PAD.encode(last)];
    let mut physical = lines(&mixed);
    physical[1].variant = 9007199254740994;
    assert!(verify_set(Some(&other_envelope), &physical, &expected(&keys), true).is_ok());
    assert_eq!(
        verify_set(Some(&envelope), &physical, &expected(&keys), true).err(),
        Some(Error::Signature)
    );
}
