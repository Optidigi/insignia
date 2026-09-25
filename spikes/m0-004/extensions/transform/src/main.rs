use insignia_m0_004_authorization::{
    decode_token, format_decimal_minor, parse_gid_suffix, parse_public_config,
    parse_shop_local_day, verify_set, ExpectedContext, PhysicalLine,
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
    token: String,
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
                                        c.write_utf8_str("key")?; c.write_utf8_str("_insignia_auth")?;
                                        c.write_utf8_str("value")?; c.write_utf8_str(&op.token)
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

    let mut lines = Vec::with_capacity(input.cart().lines().len());
    let mut line_ids = Vec::with_capacity(input.cart().lines().len());
    let mut variant_ids = Vec::with_capacity(input.cart().lines().len());
    let mut currency: Option<[u8; 3]> = None;
    for line in input.cart().lines() {
        let schema::run::cart_transform_run_input::cart::lines::Merchandise::ProductVariant(
            variant,
        ) = line.merchandise()
        else {
            if line.auth().is_some() {
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
        let marked = line.auth().is_some();
        let policy = variant.product().policy().map(|p| p.value().as_str());
        if marked && !matches!(policy, Some("required" | "optional")) {
            return Ok(empty());
        }
        let required = match policy {
            Some("required") => true,
            Some("optional") | None => false,
            _ => return Ok(empty()),
        };
        let token = line.auth().and_then(|a| a.value()).map(String::as_str);
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
            token,
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
    let Ok(claims) = verify_set(&lines, &expected, false) else {
        return Ok(empty());
    };
    let mut operations = Vec::with_capacity(claims.len());
    for (line, (line_id, variant_id)) in lines.iter().zip(line_ids.into_iter().zip(variant_ids)) {
        let Some(token) = line.token else {
            continue;
        };
        let Ok(auth) = decode_token(token) else {
            return Ok(empty());
        };
        let claim = auth.claims;
        let Ok(amount) = format_decimal_minor(claim.unit_minor, claim.exponent) else {
            return Ok(empty());
        };
        operations.push(TransformOperation {
            line_id: line_id.clone(),
            variant_id: variant_id.clone(),
            token: token.into(),
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
        let path = std::env::var("INSIGNIA_M0_004_TRANSFORM_INPUT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../../fixtures/targets/transform-valid.json")
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
        let generated = schema::run::CartTransformRunInput::deserialize(&root).unwrap();
        let output = cart_transform_run(generated).unwrap();
        output.serialize(&mut context).unwrap();
        context.finalize_output_and_return().unwrap()
    }

    #[test]
    fn signed_complete_set_expands_same_variant_once_with_exact_string_money() {
        let input = fixture();
        let output = run(input.clone());
        let operations = output["operations"].as_array().unwrap();
        assert_eq!(operations.len(), 2);
        for (index, expected_amount) in ["30.33", "30.34"].iter().enumerate() {
            let expanded = &operations[index]["lineExpand"]["expandedCartItems"][0];
            assert_eq!(
                expanded["merchandiseId"],
                input["cart"]["lines"][index]["merchandise"]["id"]
            );
            assert_eq!(expanded["quantity"], 1); // Relative to parent q; prior G1 observed q3 materialized as three.
            assert_eq!(
                expanded["price"]["adjustment"]["fixedPricePerUnit"]["amount"],
                *expected_amount
            );
            assert_eq!(
                expanded["attributes"][0]["value"],
                input["cart"]["lines"][index]["auth"]["value"]
            );
        }
        let mut damaged = input;
        damaged["cart"]["lines"][1]["auth"]["value"] = "bad".into();
        assert_eq!(run(damaged)["operations"].as_array().unwrap().len(), 0);
        let mut missing_policy = fixture();
        missing_policy["cart"]["lines"][0]["merchandise"]["product"]["policy"] =
            serde_json::Value::Null;
        assert_eq!(
            run(missing_policy)["operations"].as_array().unwrap().len(),
            0
        );
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
        let mixed_output = run(mixed);
        assert_eq!(mixed_output["operations"].as_array().unwrap().len(), 2);
        assert_eq!(
            mixed_output["operations"][0]["lineExpand"]["cartLineId"],
            "gid://shopify/CartLine/1"
        );
        let mut wrong_market = fixture();
        wrong_market["localization"]["market"]["id"] = "gid://shopify/Market/43".into();
        assert_eq!(run(wrong_market)["operations"].as_array().unwrap().len(), 0);

        // Mathematical adapter probe only; Shopify's accepted monetary range is not established.
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
        assert_eq!(
            run(wide_input)["operations"][0]["lineExpand"]["expandedCartItems"][0]["price"]
                ["adjustment"]["fixedPricePerUnit"]["amount"],
            "90071992547409.93"
        );
    }
}
