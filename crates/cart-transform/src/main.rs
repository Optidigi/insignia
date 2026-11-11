use cart_authorization::{
    format_decimal_minor, parse_gid_suffix, parse_public_config, parse_shop_local_day, ref_v3,
    verify_lines_v3, CartLineV3, ExpectedContext, MAX_LINE_V3_CHARS,
};
use shopify_function::prelude::*;
use shopify_function::Result;

use cart_authorization::product_policy::{self, PlainPolicy};

use cart_authorization::capacity;

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
    reference: String,
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
                                        c.write_utf8_str("key")?; c.write_utf8_str(capacity::REF_ATTRIBUTE)?;
                                        c.write_utf8_str("value")?; c.write_utf8_str(&op.reference)
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

/// All-or-nothing: any invalid customized line, mixed set or over-cap cart emits no price operation.
#[shopify_function]
fn cart_transform_run(input: schema::run::CartTransformRunInput) -> Result<Output> {
    if !input
        .cart()
        .lines()
        .iter()
        .any(|line| line.line().is_some() || line.legacy().is_some())
    {
        return Ok(empty());
    }
    let Some(raw_config) = input.shop().public_config().map(|m| m.value()) else {
        return Ok(empty());
    };
    if raw_config.len() > capacity::MAX_CONFIG_BYTES {
        return Ok(empty());
    }
    let Ok(config) = parse_public_config(raw_config) else {
        return Ok(empty());
    };
    if config.max_buckets > capacity::MAX_BUCKETS
        || config.max_physical_quantity > capacity::MAX_PHYSICAL_QUANTITY
        || input.cart().lines().len() > capacity::MAX_CART_LINES
        || capacity::output_upper_bound(config.max_buckets as usize)
            .is_none_or(|n| n > capacity::MAX_OUTPUT_BYTES)
    {
        return Ok(empty());
    }
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
        // A leftover v2 line is no longer a valid authorization; never price around it.
        if line.legacy().is_some() {
            return Ok(empty());
        }
        let schema::run::cart_transform_run_input::cart::lines::Merchandise::ProductVariant(
            variant,
        ) = line.merchandise()
        else {
            if line.line().is_some() {
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
        let carrier = line.line().map(|a| a.value().map(String::as_str));
        if let Some(carrier) = carrier {
            if !capacity::cart_line_id_ok(line.id())
                || line.id().len() > capacity::MAX_CART_LINE_ID_BYTES
                || variant.id().len() > capacity::MAX_VARIANT_ID_BYTES
                || carrier.is_none_or(|c| c.len() > MAX_LINE_V3_CHARS)
            {
                return Ok(empty());
            }
        }
        let decision = product_policy::classify(
            variant.product().registration().map(|m| m.value().as_str()),
            variant.product().policy().map(|m| m.value().as_str()),
            config.generation,
        );
        if !decision.signed_allowed {
            return Ok(empty());
        }
        let Some(Some(carrier)) = carrier else {
            if matches!(
                decision.plain,
                PlainPolicy::Required | PlainPolicy::Uncertain
            ) {
                return Ok(empty());
            }
            continue;
        };
        if lines.len() >= usize::from(config.max_buckets) {
            return Ok(empty());
        }
        let code = line
            .cost()
            .amount_per_quantity()
            .currency_code()
            .to_string();
        let Ok(code) = <[u8; 3]>::try_from(code.as_bytes()) else {
            return Ok(empty());
        };
        if currency.is_some_and(|c| c != code) {
            return Ok(empty());
        }
        currency = Some(code);
        lines.push(CartLineV3 {
            carrier,
            variant: variant_num,
            quantity,
            observed_unit_minor: None,
            selling_plan: line.selling_plan_allocation().is_some(),
        });
        line_ids.push(line.id());
        variant_ids.push(variant.id());
    }
    let Some(currency) = currency else {
        return Ok(empty());
    };
    let Some(exponent) = cart_authorization::currency_exponent(currency) else {
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
    let Ok(verified) = verify_lines_v3(&lines, &expected, false) else {
        return Ok(empty());
    };
    let mut operations = Vec::with_capacity(verified.claims.len());
    for (claim, (line_id, variant_id)) in verified
        .claims
        .iter()
        .zip(line_ids.into_iter().zip(variant_ids))
    {
        let Ok(amount) = format_decimal_minor(claim.unit_minor, exponent) else {
            return Ok(empty());
        };
        if amount.len() > capacity::MAX_AMOUNT_BYTES {
            return Ok(empty());
        }
        operations.push(TransformOperation {
            line_id: line_id.clone(),
            variant_id: variant_id.clone(),
            reference: ref_v3(&verified.set, claim.index),
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
        let generated = schema::run::CartTransformRunInput::deserialize(&root).unwrap();
        let output = cart_transform_run(generated).unwrap();
        output.serialize(&mut context).unwrap();
        context.finalize_output_and_return().unwrap()
    }
    fn count(input: Value) -> usize {
        run(input)["operations"].as_array().unwrap().len()
    }
    fn amounts(output: &Value) -> Vec<String> {
        output["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|op| {
                op["lineExpand"]["expandedCartItems"][0]["price"]["adjustment"]["fixedPricePerUnit"]
                    ["amount"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }
    fn carrier(input: &Value, line: usize) -> String {
        input["cart"]["lines"][line]["line"]["value"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn signed_prices_survive_policy_revision_and_one_lost_anchor() {
        let mut input = fixture();
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"]["value"] =
                "11111111111111111111111111111111:2:ready".into();
            line["merchandise"]["product"]["policy"]["value"] =
                "11111111111111111111111111111111:2:optional".into();
        }
        assert_eq!(count(input.clone()), 2);
        input["cart"]["lines"][0]["merchandise"]["product"]["policy"] = Value::Null;
        assert_eq!(count(input.clone()), 2);
        input["cart"]["lines"][0]["merchandise"]["product"]["registration"]["value"] =
            "22222222222222222222222222222222:2:ready".into();
        assert_eq!(count(input), 0);
    }

    #[test]
    fn signed_lines_with_no_product_anchors_still_require_shop_keys() {
        let mut input = fixture();
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] = Value::Null;
            line["merchandise"]["product"]["policy"] = Value::Null;
        }
        assert_eq!(count(input.clone()), 2);
        input["shop"]["publicConfig"] = Value::Null;
        assert_eq!(count(input), 0);
    }

    #[test]
    fn signed_lines_with_only_illegible_policy_emit_no_price() {
        let mut input = fixture();
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["merchandise"]["product"]["registration"] = Value::Null;
            line["merchandise"]["product"]["policy"]["value"] = "bad".into();
        }
        assert_eq!(count(input), 0);
    }

    #[test]
    fn unmarked_cart_and_invalid_carrier_emit_no_price() {
        let mut input = fixture();
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["line"] = Value::Null;
        }
        assert_eq!(count(input), 0);
        let mut input = fixture();
        input["cart"]["lines"][0]["line"]["value"] = "bad".into();
        assert_eq!(count(input), 0);
    }

    #[test]
    fn stale_v2_cart_attribute_is_not_read() {
        let mut input = fixture();
        input["cart"]["quote"] = json!({"value": "SVNHMgIAAAc"});
        assert_eq!(count(input.clone()), 2);
        for line in input["cart"]["lines"].as_array_mut().unwrap() {
            line["line"] = Value::Null;
            line["merchandise"]["product"]["policy"]["value"] =
                "11111111111111111111111111111111:1:optional".into();
        }
        assert_eq!(count(input), 0);
    }

    #[test]
    fn leftover_v2_line_is_an_invalid_carrier() {
        let mut input = fixture();
        input["cart"]["lines"][1]["legacy"] = json!({"value": "AAEAIAAAAAAAAQAAAAEAAAAAAAAL2g"});
        assert_eq!(count(input.clone()), 0);
        // Even beside an unmanaged product with no v3 line at all.
        input["cart"]["lines"][0]["line"] = Value::Null;
        input["cart"]["lines"][0]["merchandise"]["product"]["registration"] = Value::Null;
        input["cart"]["lines"][0]["merchandise"]["product"]["policy"] = Value::Null;
        input["cart"]["lines"].as_array_mut().unwrap().truncate(1);
        input["cart"]["lines"][0]["legacy"] = json!({"value": "AAEAIAAAAAAAAQAAAAEAAAAAAAAL2g"});
        assert_eq!(count(input), 0);
    }

    #[test]
    fn each_line_sets_its_signed_price_and_copies_the_short_ref() {
        let input = fixture();
        let out = run(input.clone());
        let operations = out["operations"].as_array().unwrap();
        assert_eq!(amounts(&out), ["30.33", "30.34"]);
        for (i, op) in operations.iter().enumerate() {
            let child = &op["lineExpand"]["expandedCartItems"][0];
            assert_eq!(
                op["lineExpand"]["cartLineId"],
                input["cart"]["lines"][i]["id"]
            );
            assert_eq!(
                child["merchandiseId"],
                input["cart"]["lines"][i]["merchandise"]["id"]
            );
            assert_eq!(child["quantity"], 1);
            assert_eq!(child["attributes"][0]["key"], "_insignia_ref_v3");
            assert_eq!(
                child["attributes"][0]["value"],
                cart_authorization::ref_v3(&[0x33; 16], i as u8)
            );
        }
    }

    #[test]
    fn native_quantity_change_and_removed_line_keep_signed_unit_prices() {
        let mut changed = fixture();
        changed["cart"]["lines"][0]["quantity"] = 7.into();
        changed["cart"]["lines"][1]["quantity"] = 1.into();
        assert_eq!(amounts(&run(changed)), ["30.33", "30.34"]);
        let mut subset = fixture();
        subset["cart"]["lines"].as_array_mut().unwrap().remove(0);
        assert_eq!(amounts(&run(subset)), ["30.34"]);
        let mut reordered = fixture();
        reordered["cart"]["lines"].as_array_mut().unwrap().reverse();
        assert_eq!(amounts(&run(reordered)), ["30.34", "30.33"]);
    }

    #[test]
    fn duplicate_mixed_forged_and_oversized_carriers_emit_no_partial_operation() {
        let mut duplicate = fixture();
        duplicate["cart"]["lines"][1]["line"]["value"] = carrier(&fixture(), 0).into();
        assert_eq!(count(duplicate), 0);
        let other = named("33-signed-0-ordinary");
        let mut mixed = fixture();
        mixed["cart"]["lines"][1]["line"]["value"] = carrier(&other, 32).into();
        assert_eq!(count(mixed), 0);
        let mut forged = fixture();
        let mut bytes = carrier(&forged, 1).into_bytes();
        let at = cart_authorization::PREFIX_V3_CHARS + 30;
        bytes[at] = if bytes[at] == b'A' { b'B' } else { b'A' };
        forged["cart"]["lines"][1]["line"]["value"] = String::from_utf8(bytes).unwrap().into();
        assert_eq!(count(forged), 0);
        let mut oversized = fixture();
        oversized["cart"]["lines"][1]["line"]["value"] = "A".repeat(473).into();
        assert_eq!(count(oversized), 0);
        let mut plan = fixture();
        plan["cart"]["lines"][1]["sellingPlanAllocation"] =
            json!({"sellingPlan":{"id":"gid://shopify/SellingPlan/1"}});
        assert_eq!(count(plan), 0);
    }

    #[test]
    fn transform_accepts_canonical_zero_and_echoes_target_local_id() {
        let mut input = fixture();
        input["cart"]["lines"][0]["id"] = "gid://shopify/CartLine/0".into();
        let output = run(input.clone());
        let operations = output["operations"].as_array().unwrap();
        assert_eq!(operations.len(), 2);
        assert_eq!(
            operations[0]["lineExpand"]["cartLineId"],
            input["cart"]["lines"][0]["id"]
        );
        for bad_id in [
            "gid://shopify/CartLine/00",
            "gid://shopify/CartLine/01",
            "gid://shopify/ProductVariant/0",
        ] {
            let mut bad = input.clone();
            bad["cart"]["lines"][0]["id"] = bad_id.into();
            assert_eq!(count(bad), 0);
        }
    }

    #[test]
    fn capacity_fixtures_are_bounded_and_the_over_cap_cart_emits_nothing() {
        for (name, signed) in [
            ("10-signed-190-ordinary", 10),
            ("32-signed-168-ordinary", 32),
            ("33-signed-0-ordinary", 0),
        ] {
            let output = run(named(name));
            let bytes = serde_json::to_vec(&output).unwrap();
            std::eprintln!("transform {name}: {} output bytes", bytes.len());
            assert_eq!(output["operations"].as_array().unwrap().len(), signed);
            assert!(bytes.len() <= capacity::output_upper_bound(signed).unwrap());
        }
    }

    #[test]
    fn serializer_matches_the_exact_output_upper_bound() {
        let line_id = format!("gid://shopify/CartLine/{}", "9".repeat(36));
        let variant_id = format!("gid://shopify/ProductVariant/{}", "9".repeat(20));
        assert_eq!(line_id.len(), capacity::MAX_CART_LINE_ID_BYTES);
        assert_eq!(variant_id.len(), capacity::MAX_VARIANT_ID_BYTES);
        for n in [0usize, 1, 32] {
            let output = Output {
                operations: (0..n)
                    .map(|_| TransformOperation {
                        line_id: line_id.clone(),
                        variant_id: variant_id.clone(),
                        reference: "A".repeat(capacity::MAX_REF_BYTES),
                        amount: "9".repeat(capacity::MAX_AMOUNT_BYTES),
                    })
                    .collect(),
            };
            let mut context = Context::new_with_input(serde_json::json!({}));
            output.serialize(&mut context).unwrap();
            let value = context.finalize_output_and_return().unwrap();
            assert_eq!(
                serde_json::to_vec(&value).unwrap().len(),
                capacity::output_upper_bound(n).unwrap(),
                "{n}"
            );
        }
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
            assert_eq!(count(input), 0, "{field}");
        }
    }

    #[test]
    fn ten_thousand_customized_units_pass_and_ten_thousand_one_reject() {
        let input = named("10k-physical");
        assert_eq!(amounts(&run(input.clone())), ["30.33", "30.33"]);
        let mut over = input;
        over["cart"]["lines"][0]["quantity"] = 5001.into();
        assert_eq!(count(over), 0);
    }

    #[test]
    fn context_expiry_variant_policy_and_marker_changes_are_enforced() {
        for bad in [
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
                x["cart"]["lines"][1]["cost"]["amountPerQuantity"]["currencyCode"] = "USD".into();
                x
            },
            {
                let mut x = fixture();
                x["shop"]["localTime"]["date"] = "2026-12-18".into(); // D+3
                x
            },
            {
                let mut x = fixture();
                x["cart"]["lines"][1]["merchandise"]["product"]["registration"] =
                    json!({"value":"22222222222222222222222222222222:1:ready"});
                x
            },
            {
                // An unmarked required product cannot be bought plain beside a signed line.
                let mut x = fixture();
                x["cart"]["lines"][1]["line"] = Value::Null;
                x
            },
        ] {
            assert_eq!(count(bad), 0);
        }
        let mut last_valid_day = fixture();
        last_valid_day["shop"]["localTime"]["date"] = "2026-12-17".into();
        assert_eq!(count(last_valid_day), 2);
    }

    #[test]
    fn revoked_and_out_of_window_public_keys_emit_no_price_operation() {
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
            assert_eq!(count(input), 0, "{field}");
        }
        for field in ["revoked", "firstDay", "lastDay"] {
            let mut input = fixture();
            let mut config: Value =
                serde_json::from_str(input["shop"]["publicConfig"]["value"].as_str().unwrap())
                    .unwrap();
            config["keys"][0].as_object_mut().unwrap().remove(field);
            input["shop"]["publicConfig"]["value"] = config.to_string().into();
            assert_eq!(count(input), 0, "{field} omitted");
        }
    }
}
