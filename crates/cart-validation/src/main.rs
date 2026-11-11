use cart_authorization::{
    parse_decimal_minor, parse_gid_suffix, parse_public_config, parse_shop_local_day,
    verify_lines_v3, CartLineV3, ExpectedContext, MAX_LINE_V3_CHARS,
};
use shopify_function::prelude::*;
use shopify_function::Result;

use cart_authorization::product_policy::{self, PlainPolicy};

use cart_authorization::capacity;

#[typegen("schema.graphql")]
mod schema {
    #[query("src/cart_validations_generate_run.graphql", custom_scalar_overrides = {
        "Input.cart.lines.cost.subtotalAmount.amount" => ::std::string::String,
    })]
    pub mod run {}
}

fn empty() -> schema::CartValidationsGenerateRunResult {
    schema::CartValidationsGenerateRunResult { operations: vec![] }
}
/// Buyer-facing, shop-voiced wording in the storefront's shipped languages; English otherwise.
fn review_message(language: &str) -> &'static str {
    match language {
        "NL" => "Je gepersonaliseerde artikelen moeten worden gecontroleerd voordat je afrekent. Ga terug naar je winkelwagen om ze bij te werken.",
        "DE" => "Deine personalisierten Artikel müssen vor dem Bezahlen überprüft werden. Kehre zu deinem Warenkorb zurück, um sie zu aktualisieren.",
        "FR" => "Vos articles personnalisés doivent être vérifiés avant le paiement. Revenez à votre panier pour les mettre à jour.",
        "ES" => "Debes revisar tus artículos personalizados antes de pagar. Vuelve a tu carrito para actualizarlos.",
        "IT" => "Devi controllare gli articoli personalizzati prima del pagamento. Torna al carrello per aggiornarli.",
        _ => "Your customized items need review before checkout. Return to your cart to update them.",
    }
}
fn reject_in(language: &str) -> schema::CartValidationsGenerateRunResult {
    schema::CartValidationsGenerateRunResult {
        operations: vec![schema::Operation::ValidationAdd(
            schema::ValidationAddOperation {
                errors: vec![schema::ValidationError {
                    message: review_message(language).into(),
                    target: "$.cart".into(),
                }],
            },
        )],
    }
}

#[shopify_function]
fn cart_validations_generate_run(
    input: schema::run::Input,
) -> Result<schema::CartValidationsGenerateRunResult> {
    if input.buyer_journey().step() == Some(&schema::BuyerJourneyStep::CartInteraction) {
        return Ok(empty()); // Leave cart repair available; checkout steps must pass below.
    }
    let reject = || reject_in(input.localization().language().iso_code());
    let relevant = input.cart().lines().iter().any(|line| {
        line.line().is_some()
            || line.legacy().is_some()
            || match line.merchandise() {
                schema::run::input::cart::lines::Merchandise::ProductVariant(variant) => {
                    variant.product().registration().is_some()
                        || variant.product().policy().is_some()
                }
                _ => false,
            }
    });
    // A leftover cart attribute is not queried: without a marked line or managed product it is a plain cart.
    if !relevant {
        return Ok(empty());
    }
    let Some(raw_config) = input.shop().public_config().map(|m| m.value()) else {
        return Ok(reject());
    };
    if raw_config.len() > capacity::MAX_CONFIG_BYTES {
        return Ok(reject());
    }
    let Ok(config) = parse_public_config(raw_config) else {
        return Ok(reject());
    };
    if config.max_buckets > capacity::MAX_BUCKETS
        || config.max_physical_quantity > capacity::MAX_PHYSICAL_QUANTITY
        || input.cart().lines().len() > capacity::MAX_CART_LINES
        || capacity::output_upper_bound(config.max_buckets as usize)
            .is_none_or(|n| n > capacity::MAX_OUTPUT_BYTES)
    {
        return Ok(reject());
    }
    let Ok(today) = parse_shop_local_day(input.shop().local_time().date()) else {
        return Ok(reject());
    };
    let Ok(market) = parse_gid_suffix(input.localization().market().id(), "Market") else {
        return Ok(reject());
    };
    let country = input.localization().country().iso_code().to_string();
    let Ok(country) = <[u8; 2]>::try_from(country.as_bytes()) else {
        return Ok(reject());
    };

    let mut lines = Vec::with_capacity(input.cart().lines().len().min(config.max_buckets as usize));
    let mut currency: Option<[u8; 3]> = None;
    for line in input.cart().lines() {
        // A leftover v2 line is no longer a valid authorization: it needs review like any invalid carrier.
        if line.legacy().is_some() {
            return Ok(reject());
        }
        let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) =
            line.merchandise()
        else {
            if line.line().is_some() {
                return Ok(reject());
            }
            continue;
        };
        let Ok(variant_num) = parse_gid_suffix(variant.id(), "ProductVariant") else {
            return Ok(reject());
        };
        let Ok(quantity) = u32::try_from(*line.quantity()) else {
            return Ok(reject());
        };
        if quantity == 0 {
            return Ok(reject());
        }
        let decision = product_policy::classify(
            variant.product().registration().map(|m| m.value().as_str()),
            variant.product().policy().map(|m| m.value().as_str()),
            config.generation,
        );
        if !decision.signed_allowed {
            return Ok(reject());
        }
        let carrier = line.line().map(|a| a.value().map(String::as_str));
        if let Some(carrier) = carrier {
            if !capacity::cart_line_id_ok(line.id())
                || line.id().len() > capacity::MAX_CART_LINE_ID_BYTES
                || variant.id().len() > capacity::MAX_VARIANT_ID_BYTES
                || carrier.is_none_or(|c| c.len() > MAX_LINE_V3_CHARS)
            {
                return Ok(reject());
            }
        }
        let Some(Some(carrier)) = carrier else {
            if matches!(
                decision.plain,
                PlainPolicy::Required | PlainPolicy::Uncertain
            ) {
                return Ok(reject());
            }
            continue;
        };
        if lines.len() >= usize::from(config.max_buckets) {
            return Ok(reject());
        }
        let amount = line.cost().subtotal_amount();
        if amount.amount().len() > capacity::MAX_AMOUNT_BYTES {
            return Ok(reject());
        }
        let code = amount.currency_code().to_string();
        let Ok(code) = <[u8; 3]>::try_from(code.as_bytes()) else {
            return Ok(reject());
        };
        if currency.is_some_and(|c| c != code) {
            return Ok(reject());
        }
        currency = Some(code);
        let Some(exp) = cart_authorization::currency_exponent(code) else {
            return Ok(reject());
        };
        let Ok(subtotal) = parse_decimal_minor(amount.amount(), exp) else {
            return Ok(reject());
        };
        let Some(unit) = subtotal.checked_div(quantity.into()) else {
            return Ok(reject());
        };
        if unit.checked_mul(quantity.into()) != Some(subtotal) {
            return Ok(reject());
        }
        lines.push(CartLineV3 {
            carrier,
            variant: variant_num,
            quantity,
            observed_unit_minor: Some(unit),
            selling_plan: line.selling_plan_allocation().is_some(),
        });
    }
    let Some(currency) = currency else {
        return Ok(empty()); // No customized line; unmarked lines passed product policy above.
    };
    let expected = ExpectedContext {
        generation: config.generation,
        epoch: config.epoch,
        currency,
        country,
        market,
        current_day: today,
        max_buckets: config.max_buckets,
        max_physical_quantity: config.max_physical_quantity,
        allow_no_market: config.allow_no_market,
        keys: &config.keys,
    };
    Ok(if verify_lines_v3(&lines, &expected, true).is_ok() {
        empty()
    } else {
        reject()
    })
}

fn main() {
    std::process::abort();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use shopify_function::wasm_api::{Context, Deserialize, Serialize};

    fn named(name: &str) -> Value {
        serde_json::from_slice(
            &std::fs::read(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("fixtures/{name}.json")),
            )
            .unwrap(),
        )
        .unwrap()
    }
    fn fixture() -> Value {
        named("valid")
    }

    fn run(input: Value) -> Value {
        let mut context = Context::new_with_input(input);
        let root = context.input_get().unwrap();
        let generated = schema::run::Input::deserialize(&root).unwrap();
        let output = cart_validations_generate_run(generated).unwrap();
        output.serialize(&mut context).unwrap();
        context.finalize_output_and_return().unwrap()
    }

    fn accepted(input: Value) -> bool {
        run(input)["operations"].as_array().unwrap().is_empty()
    }

    fn checkout_steps() -> [&'static str; 2] {
        ["CHECKOUT_INTERACTION", "CHECKOUT_COMPLETION"]
    }

    fn carrier(input: &Value, line: usize) -> String {
        input["cart"]["lines"][line]["line"]["value"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn zero_based_fixture(step: &str) -> Value {
        let mut input = fixture();
        input["buyerJourney"]["step"] = step.into();
        input["cart"]["lines"][0]["id"] = "gid://shopify/CartLine/0".into();
        input["cart"]["lines"][1]["id"] = "gid://shopify/CartLine/1".into();
        input
    }

    #[test]
    fn zero_based_cartline_preserves_signed_checkout_at_both_steps() {
        for step in checkout_steps() {
            let input = zero_based_fixture(step);
            assert!(accepted(input.clone()), "signed /0 at {step}");
            let mut reordered = input.clone();
            reordered["cart"]["lines"].as_array_mut().unwrap().reverse();
            assert!(accepted(reordered), "line order is not authority at {step}");
            for suffix in ["9007199254740991", "00000000-0000-4000-8000-000000000001"] {
                let mut control = input.clone();
                control["cart"]["lines"][0]["id"] =
                    format!("gid://shopify/CartLine/{suffix}").into();
                assert!(accepted(control), "{suffix} at {step}");
            }
            for bad_id in [
                "gid://shopify/CartLine/00",
                "gid://shopify/CartLine/01",
                "gid://shopify/CartLine/",
                "gid://shopify/ProductVariant/0",
                "gid://shopify/CartLine/184467440737095516150",
                "gid://shopify/CartLine/00000000-0000-4000-8000-000000000001X",
            ] {
                let mut bad = input.clone();
                bad["cart"]["lines"][0]["id"] = bad_id.into();
                assert!(!accepted(bad), "malformed {bad_id} at {step}");
            }
        }
    }

    #[test]
    fn native_quantity_change_and_removed_line_check_out_at_signed_units() {
        for step in checkout_steps() {
            let mut changed = zero_based_fixture(step);
            changed["cart"]["lines"][0]["quantity"] = 5.into();
            changed["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "151.65".into();
            assert!(accepted(changed.clone()), "quantity change at {step}");
            changed["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "151.60".into();
            assert!(
                !accepted(changed),
                "observed unit must stay the signed unit"
            );
            let mut subset = zero_based_fixture(step);
            subset["cart"]["lines"].as_array_mut().unwrap().pop();
            assert!(accepted(subset), "subset at {step}");
        }
    }

    #[test]
    fn economics_and_trust_failures_reject_at_checkout() {
        let other = named("33-signed-0-ordinary");
        for step in checkout_steps() {
            let input = zero_based_fixture(step);
            let mut cases = Vec::new();
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "60.68".into();
            cases.push(("observed exact price", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "60.67".into();
            cases.push(("inexact unit division", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["merchandise"]["id"] =
                "gid://shopify/ProductVariant/9007199254740994".into();
            cases.push(("real variant", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["line"]["value"] = "bad".into();
            cases.push(("invalid carrier", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["line"]["value"] = carrier(&input, 1).into();
            bad["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "60.68".into();
            cases.push(("duplicate carrier at its own price", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][1]["line"]["value"] = carrier(&other, 32).into();
            bad["cart"]["lines"][1]["cost"]["subtotalAmount"]["amount"] = "30.33".into();
            cases.push(("two sets", bad));
            let mut bad = input.clone();
            let mut bytes = carrier(&input, 1).into_bytes();
            let at = cart_authorization::PREFIX_V3_CHARS + 30;
            bytes[at] = if bytes[at] == b'A' { b'B' } else { b'A' };
            bad["cart"]["lines"][1]["line"]["value"] = String::from_utf8(bytes).unwrap().into();
            cases.push(("forged proof", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["line"]["value"] = "A".repeat(473).into();
            cases.push(("oversized carrier", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["line"] = Value::Null;
            cases.push(("missing carrier on required product", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][1]["legacy"] = json!({"value": "AAEAIAAAAAAAAQAAAAEAAAAAAAAL2g"});
            cases.push(("leftover v2 line", bad));
            let mut bad = input.clone();
            bad["shop"]["publicConfig"] = Value::Null;
            cases.push(("missing key/config", bad));
            let mut bad = input.clone();
            bad["localization"]["country"]["isoCode"] = "US".into();
            cases.push(("wrong country", bad));
            let mut bad = input.clone();
            bad["localization"]["market"]["id"] = "gid://shopify/Market/43".into();
            cases.push(("wrong market", bad));
            let mut bad = input.clone();
            bad["shop"]["localTime"]["date"] = "2026-12-18".into();
            cases.push(("expired D+3", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][1]["sellingPlanAllocation"] =
                json!({"sellingPlan":{"id":"gid://shopify/SellingPlan/1"}});
            cases.push(("selling plan", bad));
            let mut bad = input.clone();
            bad["cart"]["lines"][1]["merchandise"]["product"]["registration"] =
                json!({"value":"22222222222222222222222222222222:1:ready"});
            cases.push(("wrong installation generation", bad));
            for (label, bad) in cases {
                assert!(!accepted(bad), "{label} at {step}");
            }
        }
    }

    #[test]
    fn leftover_v2_line_needs_review_even_on_an_unmanaged_product() {
        let mut input = fixture();
        input["cart"]["lines"].as_array_mut().unwrap().truncate(1);
        let line = &mut input["cart"]["lines"][0];
        line["line"] = Value::Null;
        line["legacy"] = json!({"value": "AAEAIAAAAAAAAQAAAAEAAAAAAAAL2g"});
        line["merchandise"]["product"]["registration"] = Value::Null;
        line["merchandise"]["product"]["policy"] = Value::Null;
        assert!(!accepted(input));
    }

    fn plain(mut input: Value) -> Value {
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["line"] = Value::Null;
        }
        input
    }

    #[test]
    fn stale_v2_cart_attribute_is_ignored_for_plain_and_signed_carts() {
        for step in checkout_steps() {
            let mut input = fixture();
            input["buyerJourney"]["step"] = step.into();
            input["cart"]["quote"] = json!({"value": "SVNHMgIAAAc"});
            assert!(accepted(input.clone()), "signed at {step}");
            let mut unmanaged = plain(input.clone());
            for line in unmanaged["cart"]["lines"].as_array_mut().unwrap() {
                line["merchandise"]["product"]["registration"] = Value::Null;
                line["merchandise"]["product"]["policy"] = Value::Null;
            }
            assert!(accepted(unmanaged), "unmanaged at {step}");
            let mut optional = plain(input);
            for line in optional["cart"]["lines"].as_array_mut().unwrap() {
                line["merchandise"]["product"]["policy"]["value"] =
                    "11111111111111111111111111111111:1:optional".into();
            }
            assert!(accepted(optional.clone()), "optional at {step}");
            optional["shop"]["publicConfig"]["value"] = "{}".into();
            assert!(
                !accepted(optional),
                "managed plain still needs readable config"
            );
        }
    }

    #[test]
    fn rejection_message_follows_buyer_language_in_shop_voice() {
        let mut input = fixture();
        input["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "1.00".into();
        for (code, start) in [
            ("EN", "Your customized items need review"),
            ("NL", "Je gepersonaliseerde artikelen"),
            ("DE", "Deine personalisierten Artikel"),
            ("FR", "Vos articles personnalisés"),
            ("ES", "Debes revisar tus artículos"),
            ("IT", "Devi controllare gli articoli"),
            ("PT_BR", "Your customized items need review"),
            ("JA", "Your customized items need review"),
        ] {
            input["localization"]["language"]["isoCode"] = code.into();
            let output = run(input.clone());
            let error = &output["operations"][0]["validationAdd"]["errors"][0];
            let message = error["message"].as_str().unwrap();
            assert!(message.starts_with(start), "{code}: {message}");
            assert!(!message.contains("Insignia"), "{code}: shop voice");
            assert_eq!(error["target"], "$.cart");
        }
    }

    #[test]
    fn buyer_marker_removal_cannot_turn_known_required_into_plain() {
        assert!(!accepted(plain(fixture())));
        let mut invalid = fixture();
        invalid["cart"]["lines"][0]["line"]["value"] = "invalid".into();
        assert!(!accepted(invalid));
        assert!(accepted(fixture()));
    }

    #[test]
    fn one_lost_anchor_blocks_plain_while_explicit_optional_and_unmanaged_pass() {
        let mut base = plain(fixture());
        for line in base["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["policy"] = Value::Null;
        }
        assert!(!accepted(base.clone()), "registration exposes lost policy");
        for line in base["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] = Value::Null;
            line["merchandise"]["product"]["policy"] =
                json!({"value":"11111111111111111111111111111111:1:required"});
        }
        assert!(!accepted(base.clone()), "policy exposes lost registration");
        for line in base["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] =
                json!({"value":"11111111111111111111111111111111:1:ready"});
            line["merchandise"]["product"]["policy"]["value"] =
                "11111111111111111111111111111111:1:optional".into();
        }
        assert!(accepted(base.clone()), "explicit optional plain");
        for line in base["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] = Value::Null;
            line["merchandise"]["product"]["policy"] = Value::Null;
        }
        assert!(accepted(base), "joint-loss is observationally unmanaged");
    }

    #[test]
    fn malformed_stale_pending_and_wrong_generation_policy_fail_plain() {
        let base = plain(fixture());
        for (registration, policy) in [
            ("bad", "11111111111111111111111111111111:1:optional"),
            (
                "11111111111111111111111111111111:2:ready",
                "11111111111111111111111111111111:1:optional",
            ),
            (
                "11111111111111111111111111111111:2:pending",
                "11111111111111111111111111111111:2:optional",
            ),
            ("11111111111111111111111111111111:1:ready", "bad"),
            (
                "22222222222222222222222222222222:1:ready",
                "11111111111111111111111111111111:1:optional",
            ),
        ] {
            let mut input = base.clone();
            for line in input["cart"]["lines"].as_array_mut().unwrap() {
                line["merchandise"]["product"]["registration"]["value"] = registration.into();
                line["merchandise"]["product"]["policy"]["value"] = policy.into();
            }
            assert!(!accepted(input), "{registration} / {policy}");
        }
    }

    #[test]
    fn signed_lines_survive_same_generation_policy_revision() {
        let mut input = fixture();
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"]["value"] =
                "11111111111111111111111111111111:2:ready".into();
            line["merchandise"]["product"]["policy"]["value"] =
                "11111111111111111111111111111111:2:optional".into();
        }
        assert!(accepted(input.clone()));
        input["cart"]["lines"][0]["merchandise"]["product"]["policy"] = Value::Null;
        assert!(accepted(input.clone()), "partial rollout");
        input["cart"]["lines"][0]["merchandise"]["product"]["registration"]["value"] =
            "22222222222222222222222222222222:2:ready".into();
        assert!(!accepted(input), "old installation must not authorize");
    }

    #[test]
    fn signed_lines_with_no_product_anchors_need_healthy_shop_keys() {
        let mut input = fixture();
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] = Value::Null;
            line["merchandise"]["product"]["policy"] = Value::Null;
        }
        assert!(accepted(input.clone()));
        input["shop"]["publicConfig"] = Value::Null;
        assert!(!accepted(input));
        let mut illegible = fixture();
        for line in illegible["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] = Value::Null;
            line["merchandise"]["product"]["policy"]["value"] = "bad".into();
        }
        assert!(!accepted(illegible));
    }

    #[test]
    fn capacity_fixtures_validate_and_the_over_cap_cart_rejects() {
        for (name, should_accept) in [
            ("10-signed-190-ordinary", true),
            ("32-signed-168-ordinary", true),
            ("33-signed-0-ordinary", false),
        ] {
            assert_eq!(accepted(named(name)), should_accept, "{name}");
        }
    }

    #[test]
    fn mixed_200_line_cart_blocks_damaged_managed_line_then_recovers() {
        let mut input = named("10-signed-190-ordinary");
        input["cart"]["lines"][10]["merchandise"]["product"]["registration"] =
            json!({"value":"11111111111111111111111111111111:2:pending"});
        input["cart"]["lines"][11]["merchandise"]["product"]["policy"] =
            json!({"value":"11111111111111111111111111111111:1:required"});
        assert!(!accepted(input.clone()));
        input["cart"]["lines"].as_array_mut().unwrap().drain(10..12);
        assert!(accepted(input.clone()), "removing damaged lines repairs");
        input["cart"]["lines"].as_array_mut().unwrap().drain(0..10);
        assert!(accepted(input), "ordinary lines remain usable alone");
    }

    #[test]
    fn untrusted_config_cannot_raise_experiment_ceiling() {
        for (field, value) in [("maxBuckets", 33), ("maxPhysicalQuantity", 10_001)] {
            let mut input = fixture();
            let mut config: Value =
                serde_json::from_str(input["shop"]["publicConfig"]["value"].as_str().unwrap())
                    .unwrap();
            config[field] = value.into();
            input["shop"]["publicConfig"]["value"] = config.to_string().into();
            assert!(!accepted(input), "{field}");
        }
    }

    #[test]
    fn ten_thousand_customized_units_pass_and_ten_thousand_one_reject() {
        let input = named("10k-physical");
        assert!(accepted(input.clone()));
        let mut underpriced = input.clone();
        underpriced["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "151649.99".into();
        assert!(!accepted(underpriced));
        let mut over = input;
        over["cart"]["lines"][0]["quantity"] = 5001.into();
        over["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "151680.33".into();
        assert!(!accepted(over));
    }

    #[test]
    fn cart_interaction_step_leaves_repair_available() {
        let mut repair = fixture();
        repair["buyerJourney"]["step"] = "CART_INTERACTION".into();
        repair["cart"]["lines"][1]["line"]["value"] = "bad".into();
        assert!(accepted(repair));
    }

    #[test]
    fn revoked_and_out_of_window_public_keys_reject_checkout() {
        for (field, value) in [
            ("revoked", json!(true)),
            ("firstDay", json!(20803)),
            ("lastDay", json!(20801)),
        ] {
            let mut input = fixture();
            let mut config: Value =
                serde_json::from_str(input["shop"]["publicConfig"]["value"].as_str().unwrap())
                    .unwrap();
            config["keys"][0][field] = value;
            input["shop"]["publicConfig"]["value"] = config.to_string().into();
            assert!(!accepted(input), "{field}");
        }
        for field in ["revoked", "firstDay", "lastDay"] {
            let mut input = fixture();
            let mut config: Value =
                serde_json::from_str(input["shop"]["publicConfig"]["value"].as_str().unwrap())
                    .unwrap();
            config["keys"][0].as_object_mut().unwrap().remove(field);
            input["shop"]["publicConfig"]["value"] = config.to_string().into();
            assert!(!accepted(input), "{field} omitted");
        }
    }
}
