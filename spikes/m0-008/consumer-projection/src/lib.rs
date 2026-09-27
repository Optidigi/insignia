//! Cross-consumer check of the states emitted by the local TypeScript publisher.
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    use insignia_m0_007_policy_model::{classify, PlainPolicy};

    const GENERATION: [u8; 16] = [0x11; 16];
    const CASES: &str = include_str!("../../fixtures/consumer-projection.tsv");

    #[test]
    fn publisher_states_match_existing_rust_policy_projection() {
        let mut count = 0;
        for row in CASES.lines().skip(1) {
            let parts: Vec<_> = row.split('|').collect();
            assert_eq!(parts.len(), 5, "malformed fixture row: {row}");
            let field = |value| if value == "-" { None } else { Some(value) };
            let decision = classify(field(parts[1]), field(parts[2]), GENERATION);
            let expected_plain = match parts[3] {
                "Unmanaged" => PlainPolicy::Unmanaged,
                "Required" => PlainPolicy::Required,
                "Optional" => PlainPolicy::Optional,
                "Uncertain" => PlainPolicy::Uncertain,
                "WrongGeneration" => PlainPolicy::WrongGeneration,
                unknown => panic!("unknown expected policy: {unknown}"),
            };
            assert_eq!(decision.plain, expected_plain, "{}", parts[0]);
            assert_eq!(
                decision.signed_allowed.to_string(),
                parts[4],
                "{}",
                parts[0]
            );
            count += 1;
        }
        assert_eq!(count, 16, "the source-bound consumer matrix changed");
    }
}
