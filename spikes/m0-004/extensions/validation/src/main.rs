use insignia_m0_004_authorization::{
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
        line.auth().is_some()
            || match line.merchandise() {
                schema::run::input::cart::lines::Merchandise::ProductVariant(variant) => variant
                    .product()
                    .policy()
                    .is_some_and(|p| p.value() != "optional"),
                _ => false,
            }
    });
    if !relevant {
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

    let mut lines = Vec::with_capacity(input.cart().lines().len());
    let mut currency: Option<[u8; 3]> = None;
    for line in input.cart().lines() {
        let schema::run::input::cart::lines::Merchandise::ProductVariant(variant) =
            line.merchandise()
        else {
            if line.auth().is_some() {
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
        let marked = line.auth().is_some();
        if marked && variant.product().policy().is_none() {
            return Ok(reject());
        }
        let token = line.auth().and_then(|a| a.value()).map(String::as_str);
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
            let Some(exp) = insignia_m0_004_authorization::currency_exponent(code) else {
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
            token,
            variant: variant_num,
            quantity,
            observed_unit_minor,
            required,
            marked,
            selling_plan: line.selling_plan_allocation().is_some(),
        });
    }
    let Some(currency) = currency else {
        return Ok(if lines.iter().any(|l| l.required) {
            reject()
        } else {
            empty()
        });
    };
    let expected = ExpectedContext {
        generation: config.generation,
        epoch: config.epoch,
        currency,
        country,
        market,
        current_day: today,
        max_buckets: config.max_buckets,
        allow_no_market: config.allow_no_market,
        keys: &config.keys,
    };
    Ok(if verify_set(&lines, &expected, true).is_ok() {
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
        let path = std::env::var("INSIGNIA_M0_004_VALIDATION_INPUT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../fixtures/targets/validation-valid.json")
            });
        serde_json::from_slice(
            &std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display())),
        )
        .unwrap()
    }

    fn wide_vector() -> serde_json::Value {
        let path = std::env::var("INSIGNIA_M0_004_VECTORS")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/vectors.json")
            });
        let corpus: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        corpus["valid"][2].clone()
    }

    fn run(input: serde_json::Value) -> serde_json::Value {
        let mut context = Context::new_with_input(input);
        let root = context.input_get().unwrap();
        let generated = schema::run::Input::deserialize(&root).unwrap();
        let output = cart_validations_generate_run(generated).unwrap();
        output.serialize(&mut context).unwrap();
        context.finalize_output_and_return().unwrap()
    }

    #[test]
    fn schema_valid_synthetic_projection_checks_price_and_signature() {
        let input = fixture();
        assert_eq!(
            run(input.clone())["operations"].as_array().unwrap().len(),
            0
        );

        let mut wrong_price = input.clone();
        wrong_price["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] = "60.67".into();
        assert_eq!(
            run(wrong_price)["operations"][0]["validationAdd"]["errors"][0]["target"],
            "$.cart"
        );

        let mut bad_signature = input.clone();
        bad_signature["cart"]["lines"][1]["auth"]["value"] = "bad".into();
        assert_eq!(
            run(bad_signature)["operations"][0]["validationAdd"]["errors"][0]["target"],
            "$.cart"
        );

        let mut removed = input;
        removed["cart"]["lines"].as_array_mut().unwrap().remove(1);
        assert_eq!(
            run(removed)["operations"][0]["validationAdd"]["errors"][0]["target"],
            "$.cart"
        );

        let mut unsigned_required = fixture();
        unsigned_required["cart"]["lines"]
            .as_array_mut()
            .unwrap()
            .remove(1);
        unsigned_required["cart"]["lines"][0]["auth"] = serde_json::Value::Null;
        unsigned_required["shop"]["publicConfig"] = serde_json::Value::Null;
        assert_eq!(
            run(unsigned_required)["operations"][0]["validationAdd"]["errors"][0]["target"],
            "$.cart"
        );

        let mut ordinary = fixture();
        for line in ordinary["cart"]["lines"].as_array_mut().unwrap() {
            line["auth"] = serde_json::Value::Null;
            line["merchandise"]["product"]["policy"] = serde_json::Value::Null;
        }
        ordinary["shop"]["publicConfig"] = serde_json::Value::Null;
        assert_eq!(run(ordinary)["operations"].as_array().unwrap().len(), 0);

        let mut mixed = fixture();
        let mut plain = mixed["cart"]["lines"][0].clone();
        plain["id"] = "gid://shopify/CartLine/99".into();
        plain["auth"] = serde_json::Value::Null;
        plain["merchandise"]["id"] = "gid://shopify/ProductVariant/999".into();
        plain["merchandise"]["product"]["policy"]["value"] = "optional".into();
        mixed["cart"]["lines"]
            .as_array_mut()
            .unwrap()
            .insert(0, plain);
        assert_eq!(run(mixed)["operations"].as_array().unwrap().len(), 0);

        let mut changed_market = fixture();
        changed_market["localization"]["market"]["id"] = "gid://shopify/Market/43".into();
        assert_eq!(
            run(changed_market)["operations"][0]["validationAdd"]["errors"][0]["target"],
            "$.cart"
        );

        // Exact lexical input scalar probe only; not a Shopify-accepted price-range claim.
        let wide = wide_vector();
        let mut wide_input = fixture();
        wide_input["cart"]["lines"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        wide_input["cart"]["lines"][0]["quantity"] = wide["claims"]["quantity"].clone();
        wide_input["cart"]["lines"][0]["auth"]["value"] = wide["token"].clone();
        wide_input["cart"]["lines"][0]["merchandise"]["id"] = format!(
            "gid://shopify/ProductVariant/{}",
            wide["claims"]["variantId"].as_str().unwrap()
        )
        .into();
        wide_input["cart"]["lines"][0]["cost"]["subtotalAmount"]["amount"] =
            "90071992547409.93".into();
        assert_eq!(run(wide_input)["operations"].as_array().unwrap().len(), 0);
    }
}
