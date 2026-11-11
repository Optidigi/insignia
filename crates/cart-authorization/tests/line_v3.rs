use cart_authorization::{
    decode_prefix_v3, decode_tail_v3, empty_slot_v3, leaf_hash_v3, node_hash_v3, parse_hex,
    proof_root_v3, ref_v3, verify_lines_v3, CartLineV3, Error, ExpectedContext, VerificationKey,
    DOMAIN, DOMAIN_V3, LEAF_LABEL_V3, PREFIX_V3_CHARS,
};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!(
        "../../../packages/cart-authorization/fixtures/cart-line-v3.json"
    ))
    .unwrap()
}

fn hex(value: &Value) -> Vec<u8> {
    let text = value.as_str().unwrap();
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

struct Context {
    keys: [VerificationKey; 1],
    generation: [u8; 16],
}

fn context(v: &Value) -> Context {
    let c = &v["context"];
    Context {
        keys: [VerificationKey::new_with_admission(
            7,
            parse_hex::<32>(v["publicHex"].as_str().unwrap()).unwrap(),
            false,
            c["keyFirstDay"].as_u64().unwrap() as u32,
            c["keyLastDay"].as_u64().unwrap() as u32,
        )
        .unwrap()],
        generation: parse_hex(c["generationHex"].as_str().unwrap()).unwrap(),
    }
}

fn expected<'a>(c: &'a Context, day: u32) -> ExpectedContext<'a> {
    ExpectedContext {
        generation: c.generation,
        epoch: 4,
        currency: *b"EUR",
        country: *b"DE",
        market: 42,
        current_day: day,
        max_buckets: 32,
        max_physical_quantity: 10_000,
        allow_no_market: false,
        keys: &c.keys,
    }
}

fn line<'a>(case: &'a Value, index: usize, quantity: u32) -> CartLineV3<'a> {
    let record = &case["records"][index];
    CartLineV3 {
        carrier: case["carriers"][index].as_str().unwrap(),
        variant: record["variantId"].as_str().unwrap().parse().unwrap(),
        quantity,
        observed_unit_minor: Some(record["unitMinor"].as_str().unwrap().parse().unwrap()),
        selling_plan: false,
    }
}

#[test]
fn typescript_hash_domains_and_constants_match_rust() {
    let v = vectors();
    assert_eq!(hex(&v["domainHex"]), DOMAIN_V3);
    assert_eq!(hex(&v["leafLabelHex"]), LEAF_LABEL_V3);
    assert_eq!(hex(&v["emptySlotHex"]), empty_slot_v3());
    assert_ne!(
        DOMAIN_V3, DOMAIN,
        "v3 and v2 signatures must be domain separated"
    );
}

#[test]
fn typescript_headers_records_leaves_proofs_and_refs_match_rust() {
    let v = vectors();
    for case in v["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let prefix = decode_prefix_v3(case["prefix"].as_str().unwrap().as_bytes()).unwrap();
        let h = prefix.header;
        assert_eq!(h.raw.to_vec(), hex(&case["headerHex"]), "{name}");
        assert_eq!(
            prefix.signature.to_vec(),
            hex(&case["signatureHex"]),
            "{name}"
        );
        assert_eq!(h.root.to_vec(), hex(&case["header"]["rootHex"]), "{name}");
        assert_eq!(
            usize::from(h.count),
            case["records"].as_array().unwrap().len()
        );
        for (i, carrier) in case["carriers"].as_array().unwrap().iter().enumerate() {
            let carrier = carrier.as_str().unwrap();
            assert_eq!(
                &carrier[..PREFIX_V3_CHARS],
                case["prefix"].as_str().unwrap()
            );
            let tail = decode_tail_v3(&carrier.as_bytes()[PREFIX_V3_CHARS..], h.depth).unwrap();
            assert_eq!(tail.raw.to_vec(), hex(&case["recordHex"][i]), "{name}/{i}");
            assert_eq!(usize::from(tail.index), i);
            assert_eq!(leaf_hash_v3(&tail.raw).to_vec(), hex(&case["leafHex"][i]));
            for (k, sibling) in case["proofHex"][i].as_array().unwrap().iter().enumerate() {
                assert_eq!(tail.proof[k].to_vec(), hex(sibling), "{name}/{i}/{k}");
            }
            assert_eq!(proof_root_v3(&tail), h.root, "{name}/{i}");
            assert_eq!(
                ref_v3(&h.set, tail.index),
                case["refs"][i].as_str().unwrap()
            );
        }
    }
}

#[test]
fn every_line_verifies_alone_in_any_subset_order_and_quantity() {
    let v = vectors();
    let c = context(&v);
    for case in v["cases"].as_array().unwrap() {
        let n = case["records"].as_array().unwrap().len();
        let all: Vec<CartLineV3<'_>> = (0..n).map(|i| line(case, i, 1)).collect();
        let verified = verify_lines_v3(&all, &expected(&c, 20800), true).unwrap();
        assert_eq!(verified.claims.len(), n);
        for i in 0..n {
            // Each line alone, at a quantity the issuer never saw (u64::MAX units only fit once).
            let quantity = if case["records"][i]["unitMinor"].as_str().unwrap().len() > 18 {
                1
            } else {
                7
            };
            let one =
                verify_lines_v3(&[line(case, i, quantity)], &expected(&c, 20802), true).unwrap();
            assert_eq!(usize::from(one.claims[0].index), i);
        }
        let reversed: Vec<CartLineV3<'_>> =
            (0..n).rev().step_by(2).map(|i| line(case, i, 1)).collect();
        let subset = verify_lines_v3(&reversed, &expected(&c, 20801), false).unwrap();
        assert_eq!(subset.claims.len(), reversed.len());
        assert_eq!(subset.set.to_vec(), hex(&case["header"]["setHex"]));
    }
}

#[test]
fn context_window_and_bounds_reject() {
    let v = vectors();
    let c = context(&v);
    let case = &v["cases"][3];
    let one = [line(case, 0, 1)];
    assert_eq!(
        verify_lines_v3(&one, &expected(&c, 20803), true).err(),
        Some(Error::Expired)
    );
    assert_eq!(
        verify_lines_v3(&one, &expected(&c, 20799), true).err(),
        Some(Error::Expired),
        "valid-through more than two days ahead"
    );
    for change in 0..6 {
        let mut e = expected(&c, 20800);
        match change {
            0 => e.generation[0] ^= 1,
            1 => e.epoch += 1,
            2 => e.currency = *b"USD",
            3 => e.country = *b"US",
            4 => e.market = 43,
            _ => e.market = 0,
        }
        assert_eq!(verify_lines_v3(&one, &e, true).err(), Some(Error::Context));
    }
    let mut lower = expected(&c, 20800);
    lower.max_buckets = 4;
    assert_eq!(
        verify_lines_v3(&one, &lower, true).err(),
        Some(Error::Incomplete)
    );
    let mut no_price = line(case, 0, 1);
    no_price.observed_unit_minor = None;
    assert_eq!(
        verify_lines_v3(&[no_price], &expected(&c, 20800), true).err(),
        Some(Error::MissingPrice)
    );
    let mut wrong_price = line(case, 0, 1);
    wrong_price.observed_unit_minor = Some(99);
    assert_eq!(
        verify_lines_v3(&[wrong_price], &expected(&c, 20800), true).err(),
        Some(Error::Line)
    );
    let mut plan = line(case, 0, 1);
    plan.selling_plan = true;
    assert_eq!(
        verify_lines_v3(&[plan], &expected(&c, 20800), true).err(),
        Some(Error::Line)
    );
    assert_eq!(
        verify_lines_v3(&[line(case, 0, 0)], &expected(&c, 20800), true).err(),
        Some(Error::Line)
    );
    // Plain unit bound: 10,000 passes, 10,001 rejects; quantity is never compared with a signed value.
    let ten_k = [line(case, 0, 4_000), line(case, 1, 6_000)];
    assert!(verify_lines_v3(&ten_k, &expected(&c, 20800), true).is_ok());
    let over = [line(case, 0, 4_001), line(case, 1, 6_000)];
    assert_eq!(
        verify_lines_v3(&over, &expected(&c, 20800), true).err(),
        Some(Error::Line)
    );
    // An i64::MAX unit times three overflows the checked u64 line total.
    let mut huge = expected(&c, 20800);
    huge.max_physical_quantity = u32::MAX;
    assert_eq!(
        verify_lines_v3(&[line(case, 4, 3)], &huge, true).err(),
        Some(Error::Overflow)
    );
    let mut revoked = context(&v);
    revoked.keys = [VerificationKey::new_with_admission(
        7,
        parse_hex::<32>(v["publicHex"].as_str().unwrap()).unwrap(),
        true,
        20800,
        20802,
    )
    .unwrap()];
    assert_eq!(
        verify_lines_v3(&one, &expected(&revoked, 20800), true).err(),
        Some(Error::UnknownKey)
    );
}

#[test]
fn shared_negative_vectors_reject_with_the_named_rule() {
    let v = vectors();
    let c = context(&v);
    let negatives = v["negatives"].as_array().unwrap();
    assert!(negatives.len() >= 40);
    for negative in negatives {
        let name = negative["name"].as_str().unwrap();
        let lines: Vec<CartLineV3<'_>> = negative["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| CartLineV3 {
                carrier: l["carrier"].as_str().unwrap(),
                variant: l["variantId"].as_str().unwrap().parse().unwrap(),
                quantity: l["quantity"].as_u64().unwrap() as u32,
                observed_unit_minor: Some(
                    l["observedUnitMinor"].as_str().unwrap().parse().unwrap(),
                ),
                selling_plan: false,
            })
            .collect();
        let error = verify_lines_v3(&lines, &expected(&c, 20800), true)
            .err()
            .unwrap_or_else(|| panic!("{name} must reject"));
        assert_eq!(
            format!("{error:?}"),
            negative["rust"].as_str().unwrap(),
            "{name}"
        );
    }
}

#[test]
fn leaf_node_and_padding_hashes_are_domain_separated() {
    let record = [7u8; 17];
    let leaf = leaf_hash_v3(&record);
    // A node over the same material, or the empty slot, can never equal a leaf.
    let mut as_node_left = [0u8; 32];
    as_node_left[..17].copy_from_slice(&record);
    assert_ne!(leaf, node_hash_v3(&as_node_left, &[0; 32]));
    assert_ne!(leaf, empty_slot_v3());
    assert_ne!(node_hash_v3(&leaf, &leaf), leaf);
    // Swapping children changes the parent: the index path is bound.
    let other = leaf_hash_v3(&[8u8; 17]);
    assert_ne!(node_hash_v3(&leaf, &other), node_hash_v3(&other, &leaf));
    // An internal node presented as a shallower tree's root does not verify a leaf one level up.
    let v = vectors();
    let case = &v["cases"][2]; // three lines, depth 2
    let carrier = case["carriers"][0].as_str().unwrap();
    let prefix = decode_prefix_v3(&carrier.as_bytes()[..PREFIX_V3_CHARS]).unwrap();
    let mut tail = decode_tail_v3(&carrier.as_bytes()[PREFIX_V3_CHARS..], 2).unwrap();
    let internal = node_hash_v3(&leaf_hash_v3(&tail.raw), &tail.proof[0]);
    tail.depth = 1;
    tail.proof[0] = tail.proof[1];
    assert_ne!(proof_root_v3(&tail), prefix.header.root);
    assert_eq!(node_hash_v3(&internal, &tail.proof[0]), prefix.header.root);
}

/// Owner decision, 11 November 2026: keys do not expire routinely. The TypeScript sentinel
/// NON_EXPIRING_LAST_DAY (0x7fffffff, the largest PostgreSQL integer) must admit every realistic
/// day, and a retirement-shortened window must stop at its last day.
#[test]
fn non_expiring_and_retirement_shortened_key_windows() {
    const NON_EXPIRING_LAST_DAY: u32 = 0x7fff_ffff;
    let v = vectors();
    let public = parse_hex::<32>(v["publicHex"].as_str().unwrap()).unwrap();
    let open_ended =
        VerificationKey::new_with_admission(7, public, false, 20800, NON_EXPIRING_LAST_DAY)
            .unwrap();
    for day in [20800, 20801, 40_000, 1_000_000, NON_EXPIRING_LAST_DAY] {
        assert!(open_ended.admitted(day), "day {day}");
    }
    assert!(!open_ended.admitted(20799));
    // Rotation on shop day 20800 shortens the retiring key to 20803 (offers plus one day of slack).
    let retired = VerificationKey::new_with_admission(7, public, false, 20800, 20803).unwrap();
    assert!(retired.admitted(20803));
    assert!(!retired.admitted(20804));
    // Revocation is immediate regardless of the window.
    let revoked =
        VerificationKey::new_with_admission(7, public, true, 20800, NON_EXPIRING_LAST_DAY).unwrap();
    assert!(!revoked.admitted(20800));
}

#[test]
fn public_config_admits_the_non_expiring_sentinel() {
    let v = vectors();
    let config = format!(
        "{{\"generationHex\":\"{}\",\"epoch\":0,\"maxBuckets\":32,\"maxPhysicalQuantity\":10000,\"allowNoMarket\":false,\"keys\":[{{\"id\":7,\"publicHex\":\"{}\",\"revoked\":false,\"firstDay\":20800,\"lastDay\":2147483647}}]}}",
        "11".repeat(16),
        v["publicHex"].as_str().unwrap()
    );
    let parsed = cart_authorization::parse_public_config(&config).unwrap();
    assert!(parsed.keys[0].admitted(1_000_000));
}
