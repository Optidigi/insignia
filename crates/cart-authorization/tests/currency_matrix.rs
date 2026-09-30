use cart_authorization::currency_exponent;
#[test]
fn every_admitted_currency_agrees_with_versioned_ts_matrix() {
    let matrix: serde_json::Value = serde_json::from_str(include_str!(
        "../../../packages/cart-authorization/fixtures/currency-matrix-v1.json"
    ))
    .unwrap();
    assert_eq!(
        matrix["version"],
        cart_authorization::CURRENCY_MATRIX_VERSION
    );
    let admitted = matrix["exponents"].as_object().unwrap();
    for (code, exponent) in admitted {
        let bytes: [u8; 3] = code.as_bytes().try_into().unwrap();
        assert_eq!(
            currency_exponent(bytes),
            Some(exponent.as_u64().unwrap() as u8),
            "{code}"
        );
    }
    assert_eq!(currency_exponent(*b"BGN"), None);
    assert_eq!(currency_exponent(*b"XXX"), None);
    assert_eq!(currency_exponent(*b"BTC"), None);
    assert_eq!(currency_exponent(*b"USX"), None);
    for a in b'A'..=b'Z' {
        for b in b'A'..=b'Z' {
            for c in b'A'..=b'Z' {
                let code = [a, b, c];
                let name = std::str::from_utf8(&code).unwrap();
                let expected = admitted.get(name).map(|v| v.as_u64().unwrap() as u8);
                assert_eq!(currency_exponent(code), expected, "{name}");
            }
        }
    }
}
