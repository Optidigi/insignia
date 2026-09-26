//! Source-only policy projection shared by the two staging Functions.
//! Each app-owned single-line text field is `generationHex:revision:state`.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PlainPolicy {
    Unmanaged,
    Required,
    Optional,
    Uncertain,
    WrongGeneration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Decision {
    pub plain: PlainPolicy,
    pub signed_allowed: bool,
}

pub fn classify(
    registration: Option<&str>,
    policy: Option<&str>,
    generation: [u8; 16],
) -> Decision {
    if registration.is_none() && policy.is_none() {
        return Decision {
            plain: PlainPolicy::Unmanaged,
            signed_allowed: true,
        };
    }
    let r = registration.map(parse_field);
    let p = policy.map(parse_field);
    if [r, p].iter().flatten().any(
        |field| matches!(field, Field::Parsed { generation: found, .. } if *found != generation),
    ) {
        return Decision {
            plain: PlainPolicy::WrongGeneration,
            signed_allowed: false,
        };
    }
    let plain = match (r, p) {
        (
            Some(Field::Parsed {
                revision: rr,
                state: "ready",
                ..
            }),
            Some(Field::Parsed {
                revision: pr,
                state: "required",
                ..
            }),
        ) if rr == pr => PlainPolicy::Required,
        (
            Some(Field::Parsed {
                revision: rr,
                state: "ready",
                ..
            }),
            Some(Field::Parsed {
                revision: pr,
                state: "optional",
                ..
            }),
        ) if rr == pr => PlainPolicy::Optional,
        _ => PlainPolicy::Uncertain,
    };
    Decision {
        plain,
        signed_allowed: true,
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Field<'a> {
    Parsed {
        generation: [u8; 16],
        revision: u32,
        state: &'a str,
    },
    Malformed,
}

pub(crate) fn parse_field(value: &str) -> Field<'_> {
    if value.len() > 64 {
        return Field::Malformed;
    }
    let mut pieces = value.split(':');
    let (Some(hex), Some(revision), Some(state), None) =
        (pieces.next(), pieces.next(), pieces.next(), pieces.next())
    else {
        return Field::Malformed;
    };
    if hex.len() != 32
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Field::Malformed;
    }
    let mut generation = [0u8; 16];
    for (index, slot) in generation.iter_mut().enumerate() {
        let Ok(byte) = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16) else {
            return Field::Malformed;
        };
        *slot = byte;
    }
    // A legible different generation is a security mismatch even if its remainder is corrupt.
    let revision = if revision.is_empty()
        || revision.starts_with('0')
        || !revision.bytes().all(|b| b.is_ascii_digit())
    {
        None
    } else {
        revision.parse::<u32>().ok().filter(|n| *n > 0)
    };
    let Some(revision) = revision else {
        return Field::Parsed {
            generation,
            revision: 0,
            state: "",
        };
    };
    Field::Parsed {
        generation,
        revision,
        state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const G: [u8; 16] = [0x11; 16];
    const R: &str = "11111111111111111111111111111111:1:ready";
    const P: &str = "11111111111111111111111111111111:1:required";

    #[test]
    fn absent_fields_are_unmanaged_but_a_single_lost_field_is_uncertain() {
        assert_eq!(classify(None, None, G).plain, PlainPolicy::Unmanaged);
        assert_eq!(classify(Some(R), None, G).plain, PlainPolicy::Uncertain);
        assert_eq!(classify(None, Some(P), G).plain, PlainPolicy::Uncertain);
    }

    #[test]
    fn matching_ready_fields_classify_required_and_optional() {
        assert_eq!(classify(Some(R), Some(P), G).plain, PlainPolicy::Required);
        assert_eq!(
            classify(
                Some(R),
                Some("11111111111111111111111111111111:1:optional"),
                G
            )
            .plain,
            PlainPolicy::Optional
        );
    }

    #[test]
    fn pending_malformed_and_stale_fields_block_plain_but_preserve_signed() {
        for registration in [
            "11111111111111111111111111111111:1:pending",
            "bad",
            "11111111111111111111111111111111:2:ready",
        ] {
            let decision = classify(Some(registration), Some(P), G);
            assert_eq!(decision.plain, PlainPolicy::Uncertain);
            assert!(decision.signed_allowed);
        }
    }

    #[test]
    fn wrong_installation_generation_rejects_signed_too() {
        for (r, p) in [
            (Some("22222222222222222222222222222222:1:ready"), Some(P)),
            (Some(R), Some("22222222222222222222222222222222:1:required")),
        ] {
            let decision = classify(r, p, G);
            assert_eq!(decision.plain, PlainPolicy::WrongGeneration);
            assert!(!decision.signed_allowed);
        }
    }

    #[test]
    fn strict_grammar_rejects_unknown_states_and_noncanonical_revisions() {
        for policy in [
            "11111111111111111111111111111111:1:maybe",
            "11111111111111111111111111111111:01:required",
            "11111111111111111111111111111111:0:required",
            "11111111111111111111111111111111:4294967296:required",
        ] {
            assert_eq!(
                classify(Some(R), Some(policy), G).plain,
                PlainPolicy::Uncertain
            );
        }
    }
}
