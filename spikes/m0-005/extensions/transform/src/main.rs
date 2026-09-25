use insignia_m0_005_authorization::{
    format_decimal_minor, parse_gid_suffix, parse_public_config, parse_shop_local_day, verify_set,
    ExpectedContext, PhysicalLine,
};
use shopify_function::prelude::*;
use shopify_function::Result;

#[typegen("schema.graphql")]
mod schema {
    #[query("src/cart_transform_run.graphql")]
    pub mod run {}
}

struct Output {
    operations: Vec<TransformOperation>,
}
struct TransformOperation {
    line_id: String,
    variant_id: String,
    member: String,
    amount: String,
}

// The supported SDK context writer emits Decimal as an exact JSON string. Its convenience
// Decimal type first converts through f64, so this target deliberately does not construct it.
impl shopify_function::wasm_api::Serialize for Output {
    fn serialize(
        &self,
        context: &mut shopify_function::wasm_api::Context,
    ) -> std::result::Result<(), shopify_function::wasm_api::write::Error> {
        context.write_object(|c| {
            c.write_utf8_str("operations")?;
            c.write_array(|c| {
                for op in &self.operations {
                    c.write_object(|c| {
                        c.write_utf8_str("lineExpand")?;
                        c.write_object(|c| {
                            c.write_utf8_str("cartLineId")?; c.write_utf8_str(&op.line_id)?;
                            c.write_utf8_str("expandedCartItems")?;
                            c.write_array(|c| {
                                c.write_object(|c| {
                                    c.write_utf8_str("merchandiseId")?; c.write_utf8_str(&op.variant_id)?;
                                    c.write_utf8_str("quantity")?; c.write_i32(1)?;
                                    c.write_utf8_str("attributes")?;
                                    c.write_array(|c| c.write_object(|c| {
                                        c.write_utf8_str("key")?; c.write_utf8_str("_insignia_member_v2")?;
                                        c.write_utf8_str("value")?; c.write_utf8_str(&op.member)
                                    }, 2), 1)?;
                                    c.write_utf8_str("price")?;
                                    c.write_object(|c| {
                                        c.write_utf8_str("adjustment")?;
                                        c.write_object(|c| {
                                            c.write_utf8_str("fixedPricePerUnit")?;
                                            c.write_object(|c| {
                                                c.write_utf8_str("amount")?; c.write_utf8_str(&op.amount)
                                            }, 1)
                                        }, 1)
                                    }, 1)
                                }, 4)
                            }, 1)
                        }, 2)
                    }, 1)?;
                }
                Ok(())
            }, self.operations.len())
        }, 1)
    }
}

fn empty() -> Output {
    Output { operations: vec![] }
}

#[shopify_function]
fn cart_transform_run(input: schema::run::CartTransformRunInput) -> Result<Output> {
    if input.cart().quote().is_none()
        && !input
            .cart()
            .lines()
            .iter()
            .any(|line| line.member().is_some())
    {
        return Ok(empty());
    }
    let Some(raw_config) = input.shop().public_config().map(|m| m.value()) else {
        return Ok(empty());
    };
    let Ok(config) = parse_public_config(raw_config) else {
        return Ok(empty());
    };
    let Ok(today) = parse_shop_local_day(input.shop().local_time().date()) else {
        return Ok(empty());
    };
    let Ok(market) = parse_gid_suffix(input.localization().market().id(), "Market") else {
        return Ok(empty());
    };
    let country = input.localization().country().iso_code().to_string();
    let Ok(country) = <[u8; 2]>::try_from(country.as_bytes()) else {
        return Ok(empty());
    };

    let signed_capacity = input.cart().lines().len().min(config.max_buckets as usize);
    let mut lines = Vec::with_capacity(signed_capacity);
    let mut line_ids = Vec::with_capacity(signed_capacity);
    let mut variant_ids = Vec::with_capacity(signed_capacity);
    let mut currency: Option<[u8; 3]> = None;
    for line in input.cart().lines() {
        let schema::run::cart_transform_run_input::cart::lines::Merchandise::ProductVariant(
            variant,
        ) = line.merchandise()
        else {
            if line.member().is_some() {
                return Ok(empty());
            }
            continue;
        };
        let Ok(variant_num) = parse_gid_suffix(variant.id(), "ProductVariant") else {
            return Ok(empty());
        };
        let Ok(quantity) = u32::try_from(*line.quantity()) else {
            return Ok(empty());
        };
        let marked = line.member().is_some();
        let policy = variant.product().policy().map(|p| p.value().as_str());
        if marked && !matches!(policy, Some("required" | "optional")) {
            return Ok(empty());
        }
        let required = match policy {
            Some("required") => true,
            Some("optional") | None => false,
            _ => return Ok(empty()),
        };
        if !marked {
            if required {
                return Ok(empty());
            }
            continue;
        }
        let member = line.member().and_then(|a| a.value()).map(String::as_str);
        let code = line
            .cost()
            .amount_per_quantity()
            .currency_code()
            .to_string();
        let Ok(code) = <[u8; 3]>::try_from(code.as_bytes()) else {
            return Ok(empty());
        };
        if marked {
            if currency.is_some_and(|c| c != code) {
                return Ok(empty());
            }
            currency = Some(code);
        }
        lines.push(PhysicalLine {
            member,
            variant: variant_num,
            quantity,
            observed_unit_minor: None,
            required,
            marked,
            selling_plan: line.selling_plan_allocation().is_some(),
        });
        line_ids.push(line.id());
        variant_ids.push(variant.id());
    }
    let Some(currency) = currency else {
        return Ok(empty());
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
    let Ok(claims) = verify_set(envelope, &lines, &expected, false) else {
        return Ok(empty());
    };
    let mut operations = Vec::with_capacity(claims.len());
    for ((line, claim), (line_id, variant_id)) in lines
        .iter()
        .zip(&claims)
        .zip(line_ids.into_iter().zip(variant_ids))
    {
        let Some(member) = line.member else {
            return Ok(empty());
        };
        let Ok(amount) = format_decimal_minor(
            claim.unit_minor,
            insignia_m0_005_authorization::currency_exponent(currency).unwrap(),
        ) else {
            return Ok(empty());
        };
        operations.push(TransformOperation {
            line_id: line_id.clone(),
            variant_id: variant_id.clone(),
            member: member.into(),
            amount,
        });
    }
    Ok(Output { operations })
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
                    .join("../fixtures/transform-valid.json"),
            )
            .unwrap(),
        )
        .unwrap()
    }

    fn run(input: serde_json::Value) -> serde_json::Value {
        let mut context = Context::new_with_input(input);
        let root = context.input_get().unwrap();
        let generated = schema::run::CartTransformRunInput::deserialize(&root).unwrap();
        let output = cart_transform_run(generated).unwrap();
        output.serialize(&mut context).unwrap();
        context.finalize_output_and_return().unwrap()
    }

    #[test]
    fn complete_set_sets_both_prices_and_copies_compact_member() {
        let input = fixture();
        let out = run(input.clone());
        let operations = out["operations"].as_array().unwrap();
        assert_eq!(operations.len(), 2);
        for (i, amount) in ["30.33", "30.34"].iter().enumerate() {
            let child = &operations[i]["lineExpand"]["expandedCartItems"][0];
            assert_eq!(
                child["merchandiseId"],
                input["cart"]["lines"][i]["merchandise"]["id"]
            );
            assert_eq!(child["quantity"], 1);
            assert_eq!(child["attributes"][0]["key"], "_insignia_member_v2");
            assert_eq!(
                child["attributes"][0]["value"],
                input["cart"]["lines"][i]["member"]["value"]
            );
            assert_eq!(
                child["price"]["adjustment"]["fixedPricePerUnit"]["amount"],
                *amount
            );
        }
        assert!(serde_json::to_vec(&out).unwrap().len() < 20_000);
    }

    #[test]
    fn no_partial_expansion_for_incomplete_or_tampered_set() {
        let mut input = fixture();
        input["cart"]["lines"].as_array_mut().unwrap().pop();
        assert_eq!(run(input)["operations"].as_array().unwrap().len(), 0);
        let mut input = fixture();
        input["cart"]["lines"][1]["member"]["value"] = "bad".into();
        assert_eq!(run(input)["operations"].as_array().unwrap().len(), 0);
        let mut input = fixture();
        input["cart"]["quote"] = serde_json::Value::Null;
        assert_eq!(run(input)["operations"].as_array().unwrap().len(), 0);
        let mut input = fixture();
        input["cart"]["lines"][1]["sellingPlanAllocation"] =
            serde_json::json!({"sellingPlan":{"id":"gid://shopify/SellingPlan/1"}});
        assert_eq!(run(input)["operations"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn full_output_size_includes_real_ids_attribute_names_values_and_prices() {
        for (name, signed) in [
            ("10-signed-190-ordinary", 10),
            ("32-signed-0-ordinary", 32),
            ("64-signed-0-ordinary", 64),
        ] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("../fixtures/transform-{name}.json"));
            let input = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let output = run(input);
            let bytes = serde_json::to_vec(&output).unwrap();
            std::eprintln!(
                "transform {name}: {} complete JSON output bytes",
                bytes.len()
            );
            assert_eq!(output["operations"].as_array().unwrap().len(), signed);
            if signed == 64 {
                assert!(bytes.len() > 20_000);
            } else {
                assert!(bytes.len() < 16_000);
            }
        }
    }

    #[test]
    fn context_physical_line_policy_and_cart_order_are_enforced() {
        let mut reordered = fixture();
        reordered["cart"]["lines"].as_array_mut().unwrap().reverse();
        assert_eq!(run(reordered)["operations"].as_array().unwrap().len(), 2);
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
                x["cart"]["lines"][1]["member"] = serde_json::Value::Null;
                x
            },
        ] {
            assert!(run(bad)["operations"].as_array().unwrap().is_empty());
        }
    }
}
