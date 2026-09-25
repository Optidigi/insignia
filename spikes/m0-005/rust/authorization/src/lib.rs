//! Isolated whole-quote v2 authorization prototype.
mod whole;
pub use whole::*;

pub fn parse_decimal_minor(value: &str, exponent: u8) -> Result<u64, Error> {
    if exponent > 3 || value.is_empty() || value.bytes().any(|c| !(c.is_ascii_digit() || c == b'.'))
    {
        return Err(Error::Encoding);
    }
    let (whole, fractional) = value.split_once('.').unwrap_or((value, ""));
    let significant_fractional = fractional.trim_end_matches('0');
    if whole.is_empty()
        || whole.len() > 1 && whole.starts_with('0')
        || significant_fractional.len() > exponent as usize
        || value.matches('.').count() > 1
        || value.ends_with('.')
    {
        return Err(Error::Encoding);
    }
    let scale = 10u64.pow(exponent.into());
    let major = whole.parse::<u64>().map_err(|_| Error::Overflow)?;
    let fraction = if significant_fractional.is_empty() {
        0
    } else {
        significant_fractional
            .parse::<u64>()
            .map_err(|_| Error::Overflow)?
            * 10u64.pow((exponent as usize - significant_fractional.len()) as u32)
    };
    major
        .checked_mul(scale)
        .and_then(|v| v.checked_add(fraction))
        .ok_or(Error::Overflow)
}

pub fn format_decimal_minor(value: u64, exponent: u8) -> Result<String, Error> {
    if exponent > 3 {
        return Err(Error::UnsupportedCurrency);
    }
    let scale = 10u64.pow(exponent.into());
    if exponent == 0 {
        return Ok(value.to_string());
    }
    Ok(format!(
        "{}.{:0width$}",
        value / scale,
        value % scale,
        width = exponent as usize
    ))
}

pub fn parse_shop_local_day(value: &str) -> Result<u32, Error> {
    let b = value.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return Err(Error::Encoding);
    }
    let year: i64 = value[..4].parse().map_err(|_| Error::Encoding)?;
    let month: i64 = value[5..7].parse().map_err(|_| Error::Encoding)?;
    let day: i64 = value[8..10].parse().map_err(|_| Error::Encoding)?;
    if year < 1970 || !(1..=12).contains(&month) {
        return Err(Error::Encoding);
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if day < 1 || day > month_days[(month - 1) as usize] {
        return Err(Error::Encoding);
    }
    // Gregorian civil date to Unix day ordinal; dates come from Shopify's shop-local clock.
    let y = year - i64::from(month <= 2);
    let era = y / 400;
    let yoe = y - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    u32::try_from(era * 146097 + doe - 719468).map_err(|_| Error::Overflow)
}

pub fn parse_gid_suffix(value: &str, expected_kind: &str) -> Result<u64, Error> {
    let suffix = value
        .strip_prefix("gid://shopify/")
        .and_then(|s| s.strip_prefix(expected_kind))
        .and_then(|s| s.strip_prefix('/'))
        .ok_or(Error::Encoding)?;
    if suffix.is_empty()
        || suffix.len() > 20
        || !suffix.bytes().all(|b| b.is_ascii_digit())
        || suffix.starts_with('0')
    {
        return Err(Error::Encoding);
    }
    suffix.parse().map_err(|_| Error::Overflow)
}

pub fn parse_hex<const N: usize>(value: &str) -> Result<[u8; N], Error> {
    if value.len() != N * 2 || !value.is_ascii() {
        return Err(Error::Encoding);
    }
    let mut out = [0; N];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).map_err(|_| Error::Encoding)?;
    }
    Ok(out)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicConfigJson {
    generation_hex: String,
    epoch: u32,
    max_buckets: u16,
    max_physical_quantity: u32,
    allow_no_market: bool,
    keys: Vec<PublicKeyJson>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicKeyJson {
    id: u16,
    public_hex: String,
}

/// Synthetic app-owned config projection. A target must source this independently from the token.
pub struct PublicConfig {
    pub generation: [u8; 16],
    pub epoch: u32,
    pub max_buckets: u16,
    pub max_physical_quantity: u32,
    pub allow_no_market: bool,
    pub keys: Vec<VerificationKey>,
}

pub fn parse_public_config(value: &str) -> Result<PublicConfig, Error> {
    let parsed: PublicConfigJson = serde_json::from_str(value).map_err(|_| Error::Encoding)?;
    if parsed.max_buckets == 0
        || parsed.max_buckets > 200
        || parsed.max_physical_quantity == 0
        || parsed.keys.is_empty()
        || parsed.keys.len() > 4
    {
        return Err(Error::Context);
    }
    let generation = parse_hex(&parsed.generation_hex)?;
    let mut keys = Vec::with_capacity(parsed.keys.len());
    for k in parsed.keys {
        if keys
            .iter()
            .any(|existing: &VerificationKey| existing.id() == k.id)
        {
            return Err(Error::Context);
        }
        keys.push(VerificationKey::new(k.id, parse_hex(&k.public_hex)?)?);
    }
    Ok(PublicConfig {
        generation,
        epoch: parsed.epoch,
        max_buckets: parsed.max_buckets,
        max_physical_quantity: parsed.max_physical_quantity,
        allow_no_market: parsed.allow_no_market,
        keys,
    })
}
