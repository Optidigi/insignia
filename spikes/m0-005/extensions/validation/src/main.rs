use insignia_m0_005_authorization::{
    parse_decimal_minor, parse_gid_suffix, parse_public_config, parse_shop_local_day, verify_set,
    ExpectedContext, PhysicalLine,
};
use shopify_function::prelude::*;
use shopify_function::Result;

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
fn reject() -> schema::CartValidationsGenerateRunResult {
    schema::CartValidationsGenerateRunResult {
        operations: vec![schema::Operation::ValidationAdd(
            schema::ValidationAddOperation {
                errors: vec![schema::ValidationError {
                    message: "Review your Insignia customization before checkout.".into(),
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
    let relevant = input.cart().lines().iter().any(|line| {
        line.member().is_some()
            || match line.merchandise() {
                schema::run::input::cart::lines::Merchandise::ProductVariant(variant) => variant
                    .product()
                    .policy()
                    .is_some_and(|p| p.value() != "optional"),
                _ => false,
            }
    });
    if !relevant && input.cart().quote().is_none() {
        return Ok(empty());
    }
    let Some(raw_config) = input.shop().public_config().map(|m| m.value()) else {
        return Ok(reject());
    };
    let Ok(config) = parse_public_config(raw_config) else {
        return Ok(reject());
    };
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
        let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) =
            line.merchandise()
        else {
            if line.member().is_some() {
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
        let required = match variant.product().policy().map(|p| p.value().as_str()) {
            Some("required") => true,
            Some("optional") | None => false,
            _ => return Ok(reject()),
        };
        let marked = line.member().is_some();
        if marked && variant.product().policy().is_none() {
            return Ok(reject());
        }
        if !marked {
            if required {
                return Ok(reject());
            }
            continue;
        }
        let member = line.member().and_then(|a| a.value()).map(String::as_str);
        let amount = line.cost().subtotal_amount();
        let code = amount.currency_code().to_string();
        let Ok(code) = <[u8; 3]>::try_from(code.as_bytes()) else {
            return Ok(reject());
        };
        if marked {
            if currency.is_some_and(|c| c != code) {
                return Ok(reject());
            }
            currency = Some(code);
        }
        let observed_unit_minor = if marked {
            let Some(exp) = insignia_m0_005_authorization::currency_exponent(code) else {
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
            Some(unit)
        } else {
            None
        };
        lines.push(PhysicalLine {
            member,
            variant: variant_num,
            quantity,
            observed_unit_minor,
            required,
            marked,
            selling_plan: line.selling_plan_allocation().is_some(),
        });
    }
    let Some(currency) = currency else {
        return Ok(reject());
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
    let envelope = input
        .cart()
        .quote()
        .and_then(|a| a.value())
        .map(String::as_str);
    Ok(if verify_set(envelope, &lines, &expected, true).is_ok() {
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
    use shopify_function::wasm_api::{Context, Deserialize, Serialize};

    fn fixture() -> serde_json::Value {
        serde_json::from_slice(
            &std::fs::read(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../fixtures/validation-valid.json"),
            )
            .unwrap(),
        )
        .unwrap()
    }

    fn run(input: serde_json::Value) -> serde_json::Value {
        let mut context = Context::new_with_input(input);
        let root = context.input_get().unwrap();
        let generated = schema::run::Input::deserialize(&root).unwrap();
        let output = cart_validations_generate_run(generated).unwrap();
        output.serialize(&mut context).unwrap();
        context.finalize_output_and_return().unwrap()
    }

    fn accepted(input: serde_json::Value) -> bool {
        run(input)["operations"].as_array().unwrap().is_empty()
    }

    #[test]
    fn complete_set_compares_observed_exact_subtotals() {
        assert!(accepted(fixture()));
        let mut changed = fixture();
        changed["cart"]["lines"][1]["cost"]["subtotalAmount"]["amount"] = "30.35".into();
        assert!(!accepted(changed));
    }

    #[test]
    fn incomplete_tampered_and_unsigned_required_sets_reject() {
        let mut missing = fixture();
        missing["cart"]["lines"].as_array_mut().unwrap().pop();
        assert!(!accepted(missing));
        let mut tampered = fixture();
        tampered["cart"]["lines"][1]["member"]["value"] = "bad".into();
        assert!(!accepted(tampered));
        let mut required = fixture();
        required["cart"]["quote"] = serde_json::Value::Null;
        for line in required["cart"]["lines"].as_array_mut().unwrap() {
            line["member"] = serde_json::Value::Null;
            line["auth"] = serde_json::json!({"value":"legacy-v1-token-is-not-upgraded"});
        }
        assert!(!accepted(required));
        let mut ordinary = fixture();
        ordinary["cart"]["quote"] = serde_json::Value::Null;
        for line in ordinary["cart"]["lines"].as_array_mut().unwrap() {
            line["member"] = serde_json::Value::Null;
            line["merchandise"]["product"]["policy"] = serde_json::Value::Null;
        }
        assert!(accepted(ordinary)); // Missing policy remains a named negative capability.
    }

    #[test]
    fn stress_fixtures_validate_complete_set_and_measure_json() {
        for name in [
            "10-signed-190-ordinary",
            "32-signed-0-ordinary",
            "64-signed-0-ordinary",
        ] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../fixtures/validation-{name}.json"));
            let input = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let output = run(input);
            std::eprintln!(
                "validation {name}: {} complete JSON output bytes",
                serde_json::to_vec(&output).unwrap().len()
            );
            assert!(output["operations"].as_array().unwrap().is_empty());
        }
    }

    #[test]
    fn cart_order_context_and_physical_claim_changes_fail_at_checkout() {
        let mut reordered = fixture();
        reordered["cart"]["lines"].as_array_mut().unwrap().reverse();
        assert!(accepted(reordered));
        for bad in [
            {
                let mut x = fixture();
                x["cart"]["lines"][1]["quantity"] = 2.into();
                x
            },
            {
                let mut x = fixture();
                x["cart"]["lines"][1]["merchandise"]["id"] =
                    "gid://shopify/ProductVariant/9007199254740994".into();
                x
            },
            {
                let mut x = fixture();
                x["localization"]["country"]["isoCode"] = "US".into();
                x
            },
            {
                let mut x = fixture();
                x["localization"]["market"]["id"] = "gid://shopify/Market/43".into();
                x
            },
            {
                let mut x = fixture();
                x["shop"]["localTime"]["date"] = "2026-12-18".into();
                x
            },
            {
                let mut x = fixture();
                x["cart"]["lines"][1]["merchandise"]["product"]["policy"] = serde_json::Value::Null;
                x
            },
            {
                let mut x = fixture();
                x["cart"]["quote"] = serde_json::Value::Null;
                x
            },
            {
                let mut x = fixture();
                x["cart"]["lines"][1]["sellingPlanAllocation"] =
                    serde_json::json!({"sellingPlan":{"id":"gid://shopify/SellingPlan/1"}});
                x
            },
        ] {
            assert!(!accepted(bad));
        }
        let mut repair = fixture();
        repair["buyerJourney"]["step"] = "CART_INTERACTION".into();
        repair["cart"]["lines"][1]["member"]["value"] = "bad".into();
        assert!(accepted(repair));
    }

    #[test]
    fn revoked_and_out_of_window_public_keys_reject_checkout() {
        for (field, value) in [
            ("revoked", serde_json::json!(true)),
            ("firstDay", serde_json::json!(20803)),
            ("lastDay", serde_json::json!(20801)),
        ] {
            let mut input = fixture();
            let mut config: serde_json::Value =
                serde_json::from_str(input["shop"]["publicConfig"]["value"].as_str().unwrap())
                    .unwrap();
            config["keys"][0][field] = value;
            input["shop"]["publicConfig"]["value"] = config.to_string().into();
            assert!(!accepted(input), "{field}");
        }
        for field in ["revoked", "firstDay", "lastDay"] {
            let mut input = fixture();
            let mut config: serde_json::Value =
                serde_json::from_str(input["shop"]["publicConfig"]["value"].as_str().unwrap())
                    .unwrap();
            config["keys"][0].as_object_mut().unwrap().remove(field);
            input["shop"]["publicConfig"]["value"] = config.to_string().into();
            assert!(!accepted(input), "{field} omitted");
        }
    }
}
