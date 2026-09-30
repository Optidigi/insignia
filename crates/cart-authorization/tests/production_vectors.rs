use cart_authorization::{
    decode_envelope, decode_member, verify_set, ExpectedContext, PhysicalLine, VerificationKey,
};
use serde_json::Value;
#[test]
fn production_typescript_vectors_verify_with_complete_rust_core() {
    let vector: Value = serde_json::from_str(include_str!(
        "../../../packages/cart-authorization/fixtures/whole-quote-v2.json"
    ))
    .unwrap();
    assert_eq!(vector["version"], "whole-quote-v2-candidate-v1");
    let public =
        cart_authorization::parse_hex::<32>(vector["publicHex"].as_str().unwrap()).unwrap();
    let key = VerificationKey::new_with_admission(7, public, false, 20800, 20802).unwrap();
    let keys = [key];
    for case in vector["cases"].as_array().unwrap() {
        let header = &case["header"];
        let envelope = case["envelope"].as_str().unwrap();
        let carriers = case["memberCarriers"].as_array().unwrap();
        let members = case["members"].as_array().unwrap();
        let mut lines: Vec<PhysicalLine<'_>> = carriers
            .iter()
            .zip(members)
            .map(|(carrier, member)| PhysicalLine {
                member: Some(carrier.as_str().unwrap()),
                variant: member["variantId"].as_str().unwrap().parse().unwrap(),
                quantity: member["quantity"].as_u64().unwrap() as u32,
                observed_unit_minor: Some(member["unitMinor"].as_str().unwrap().parse().unwrap()),
                required: true,
                marked: true,
                selling_plan: false,
            })
            .collect();
        for _ in 0..case["ordinaryLines"].as_u64().unwrap() {
            lines.push(PhysicalLine {
                member: None,
                variant: 999,
                quantity: 1,
                observed_unit_minor: None,
                required: false,
                marked: false,
                selling_plan: false,
            });
        }
        let expected = ExpectedContext {
            generation: cart_authorization::parse_hex(header["generationHex"].as_str().unwrap())
                .unwrap(),
            epoch: header["epoch"].as_u64().unwrap() as u32,
            currency: *b"EUR",
            country: *b"DE",
            market: 42,
            current_day: 20800,
            max_buckets: 32,
            max_physical_quantity: 10000,
            allow_no_market: false,
            keys: &keys,
        };
        let decoded = decode_envelope(envelope).unwrap();
        assert_eq!(decoded.header.count as usize, carriers.len());
        for (i, carrier) in carriers.iter().enumerate() {
            assert_eq!(
                decode_member(carrier.as_str().unwrap()).unwrap().index as usize,
                i
            );
        }
        assert_eq!(
            verify_set(Some(envelope), &lines, &expected, true)
                .unwrap()
                .len(),
            carriers.len(),
            "{}",
            case["name"]
        );
        let revoked = [VerificationKey::new_with_admission(7, public, true, 20800, 20802).unwrap()];
        let out_of_window =
            [VerificationKey::new_with_admission(7, public, false, 20801, 20802).unwrap()];
        assert!(verify_set(
            Some(envelope),
            &lines,
            &ExpectedContext {
                keys: &revoked,
                ..expected
            },
            true
        )
        .is_err());
        assert!(verify_set(
            Some(envelope),
            &lines,
            &ExpectedContext {
                keys: &out_of_window,
                ..expected
            },
            true
        )
        .is_err());
        let mut changed = expected;
        changed.country = *b"US";
        assert!(verify_set(Some(envelope), &lines, &changed, true).is_err());
        let mut changed = expected;
        changed.market = 43;
        assert!(verify_set(Some(envelope), &lines, &changed, true).is_err());
        let mut changed = expected;
        changed.epoch = 5;
        assert!(verify_set(Some(envelope), &lines, &changed, true).is_err());
        let mut changed = expected;
        changed.generation[0] ^= 1;
        assert!(verify_set(Some(envelope), &lines, &changed, true).is_err());
        let mut changed = expected;
        changed.currency = *b"USD";
        assert!(verify_set(Some(envelope), &lines, &changed, true).is_err());
        lines[0].variant += 1;
        assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
        lines[0].variant -= 1;
        lines[0].quantity += 1;
        assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
        lines[0].quantity -= 1;
        lines[0].observed_unit_minor = Some(0);
        assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
        lines[0].observed_unit_minor =
            Some(members[0]["unitMinor"].as_str().unwrap().parse().unwrap());
        lines[0].selling_plan = true;
        assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
        lines[0].selling_plan = false;
        let first = lines.remove(0);
        assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
        lines.insert(0, first);
        if lines.len() > 1 && carriers.len() > 1 {
            lines.swap(0, 1);
            assert!(verify_set(Some(envelope), &lines, &expected, true).is_ok());
            lines.swap(0, 1);
            {
                let (first, rest) = lines.split_at_mut(1);
                std::mem::swap(&mut first[0].member, &mut rest[0].member);
            }
            assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
            {
                let (first, rest) = lines.split_at_mut(1);
                std::mem::swap(&mut first[0].member, &mut rest[0].member);
            }
            lines[1].member = lines[0].member;
            assert!(verify_set(Some(envelope), &lines, &expected, true).is_err());
        }
    }
}
