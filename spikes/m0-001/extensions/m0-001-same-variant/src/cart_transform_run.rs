use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(Debug, Deserialize)]
#[shopify_function(rename_all = "camelCase")]
pub struct FixtureConfig {
    allowed_variant_ids: Vec<String>,
    unit_price: String,
    currency: String,
}

fn eligible(
    config: &FixtureConfig,
    marker: &str,
    variant_id: &str,
    currency: &str,
    quantity: i64,
) -> bool {
    (1..=2000).contains(&quantity)
        && marker.starts_with("m0-001:")
        && (8..=64).contains(&marker.len())
        && config.allowed_variant_ids.iter().any(|id| id == variant_id)
        && config.currency == currency
}

#[shopify_function]
fn cart_transform_run(
    input: schema::cart_transform_run::CartTransformRunInput,
) -> Result<schema::CartTransformRunResult> {
    let Some(fixture) = input.cart_transform().fixture() else {
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    };
    let configuration = fixture.json_value();
    if configuration.unit_price != "30.00" || configuration.allowed_variant_ids.len() > 8 {
        return Ok(schema::CartTransformRunResult { operations: vec![] });
    }

    let mut operations = Vec::new();
    for line in input.cart().lines() {
        let Some(marker) = line.marker().and_then(|attribute| attribute.value()) else {
            continue;
        };
        let schema::cart_transform_run::cart_transform_run_input::cart::lines::Merchandise::ProductVariant(variant) = line.merchandise() else {
            continue;
        };
        if !eligible(
            configuration,
            marker,
            variant.id(),
            &line
                .cost()
                .amount_per_quantity()
                .currency_code()
                .to_string(),
            (*line.quantity()).into(),
        ) {
            continue;
        }

        let child = schema::ExpandedItem {
            merchandise_id: variant.id().clone(),
            quantity: 1,
            attributes: Some(vec![schema::AttributeOutput {
                key: "_insignia_m0_001".to_owned(),
                value: marker.clone(),
            }]),
            price: Some(schema::ExpandedItemPriceAdjustment {
                adjustment: schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(
                    schema::ExpandedItemFixedPricePerUnitAdjustment {
                        amount: Decimal(30.0),
                    },
                ),
            }),
        };
        operations.push(schema::Operation::LineExpand(schema::LineExpandOperation {
            cart_line_id: line.id().clone(),
            expanded_cart_items: vec![child],
            title: None,
            image: None,
            price: None,
        }));
    }

    Ok(schema::CartTransformRunResult { operations })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_config() -> FixtureConfig {
        FixtureConfig {
            allowed_variant_ids: vec!["gid://shopify/ProductVariant/111".to_owned()],
            unit_price: "30.00".to_owned(),
            currency: "USD".to_owned(),
        }
    }

    #[test]
    fn upper_local_quantity_remains_eligible_without_per_unit_loop() {
        assert!(eligible(
            &fixture_config(),
            "m0-001:large",
            "gid://shopify/ProductVariant/111",
            "USD",
            2000
        ));
        assert!(!eligible(
            &fixture_config(),
            "m0-001:large",
            "gid://shopify/ProductVariant/111",
            "USD",
            2001
        ));
    }

    #[test]
    fn unallowed_variant_and_wrong_currency_remain_plain() {
        assert!(!eligible(
            &fixture_config(),
            "m0-001:test",
            "gid://shopify/ProductVariant/333",
            "USD",
            1
        ));
        assert!(!eligible(
            &fixture_config(),
            "m0-001:test",
            "gid://shopify/ProductVariant/111",
            "EUR",
            1
        ));
    }
}
