// Candidate local Function bounds. The backend admission helper must use the same widths.
pub const MAX_BUCKETS: u16 = 32;
pub const MAX_CONFIG_BYTES: usize = 1_024;
pub const MAX_CART_LINES: usize = 200;
pub const MAX_PHYSICAL_QUANTITY: u32 = 10_000;
pub const MAX_CART_LINE_ID_BYTES: usize = 59;
pub const MAX_VARIANT_ID_BYTES: usize = 49;
pub const MAX_MEMBER_BYTES: usize = 30;
pub const MAX_AMOUNT_BYTES: usize = 21;
pub const MAX_OUTPUT_BYTES: usize = 16_000;

pub fn cart_line_id_ok(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("gid://shopify/CartLine/") else {
        return false;
    };
    let bytes = suffix.as_bytes();
    if bytes.len() == 36 {
        return bytes.iter().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        });
    }
    !bytes.is_empty()
        && bytes.len() <= 20
        && (bytes == b"0" || bytes[0] != b'0')
        && bytes.iter().all(u8::is_ascii_digit)
}

// The custom serializer's compact JSON is 17 bytes for an empty operations array,
// 203 fixed bytes per lineExpand operation, one separator per additional operation,
// and the four unescaped ASCII values. These values are checked against the
// serializer in native tests and the target runner for every generated row.
pub fn output_upper_bound(buckets: usize) -> Option<usize> {
    let per_operation = 203usize
        .checked_add(MAX_CART_LINE_ID_BYTES)?
        .checked_add(MAX_VARIANT_ID_BYTES)?
        .checked_add(MAX_MEMBER_BYTES)?
        .checked_add(MAX_AMOUNT_BYTES)?;
    17usize
        .checked_add(buckets.checked_mul(per_operation)?)?
        .checked_add(buckets.saturating_sub(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cart_line_width_and_grammar() {
        assert!(cart_line_id_ok(
            "gid://shopify/CartLine/18446744073709551615"
        ));
        assert!(cart_line_id_ok(
            "gid://shopify/CartLine/00000000-0000-4000-8000-000000000001"
        ));
        assert!(!cart_line_id_ok(
            "gid://shopify/CartLine/00000000-0000-4000-8000-000000000001X"
        ));
        assert!(cart_line_id_ok("gid://shopify/CartLine/0"));
        assert!(!cart_line_id_ok("gid://shopify/CartLine/00"));
        assert!(!cart_line_id_ok("gid://shopify/CartLine/01"));
        assert!(!cart_line_id_ok("gid://shopify/CartLine/"));
        assert!(!cart_line_id_ok("gid://shopify/ProductVariant/0"));
        assert!(!cart_line_id_ok(
            "gid://shopify/CartLine/184467440737095516150"
        ));
    }
    #[test]
    fn exact_output_bound_has_headroom() {
        assert_eq!(output_upper_bound(32), Some(11_632));
        assert!(output_upper_bound(32).unwrap() <= MAX_OUTPUT_BYTES);
        assert!(output_upper_bound(64).unwrap() > MAX_OUTPUT_BYTES);
    }
}
