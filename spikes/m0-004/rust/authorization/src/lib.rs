//! Candidate local cart authorization protocol. No shop key material or Shopify input is trusted here.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};

pub const PAYLOAD_LEN: usize = 114;
pub const TOKEN_LEN: usize = 178;
pub const TOKEN_CHARS: usize = 238;
pub const DOMAIN: &[u8] = b"Insignia\0CartAuthorization\0v1\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Encoding,
    Header,
    UnsupportedCurrency,
    UnknownKey,
    Signature,
    Context,
    Expired,
    Incomplete,
    Duplicate,
    Line,
    MissingPrice,
    Overflow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Claims {
    pub key_id: u16,
    pub generation: [u8; 16],
    pub epoch: u32,
    pub quote: [u8; 16],
    pub set: [u8; 16],
    pub index: u16,
    pub count: u16,
    pub variant: u64,
    pub quantity: u32,
    pub unit_minor: u64,
    pub currency: [u8; 3],
    pub exponent: u8,
    pub country: [u8; 2],
    pub market: u64,
    pub valid_through_day: u32,
    pub total_quantity: u32,
    pub total_minor: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedAuthorization {
    pub claims: Claims,
    pub payload: [u8; PAYLOAD_LEN],
    pub signature: [u8; 64],
}

fn be_u16(bytes: &[u8]) -> u16 {
    u16::from_be_bytes(bytes.try_into().expect("fixed width"))
}
fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes(bytes.try_into().expect("fixed width"))
}
fn be_u64(bytes: &[u8]) -> u64 {
    u64::from_be_bytes(bytes.try_into().expect("fixed width"))
}
fn bytes<const N: usize>(slice: &[u8]) -> [u8; N] {
    slice.try_into().expect("fixed width")
}

pub fn currency_exponent(code: [u8; 3]) -> Option<u8> {
    // Local mathematical test table, not a claim about supported Shopify markets.
    match &code {
        b"USD" | b"EUR" => Some(2),
        b"JPY" => Some(0),
        b"KWD" => Some(3),
        _ => None,
    }
}

pub fn decode_token(token: &str) -> Result<SignedAuthorization, Error> {
    if token.len() != TOKEN_CHARS
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(Error::Encoding);
    }
    let raw = URL_SAFE_NO_PAD.decode(token).map_err(|_| Error::Encoding)?;
    if raw.len() != TOKEN_LEN || URL_SAFE_NO_PAD.encode(&raw) != token {
        return Err(Error::Encoding);
    }
    let payload: [u8; PAYLOAD_LEN] = bytes(&raw[..PAYLOAD_LEN]);
    let signature: [u8; 64] = bytes(&raw[PAYLOAD_LEN..]);
    let claims = decode_payload(&payload)?;
    Ok(SignedAuthorization {
        claims,
        payload,
        signature,
    })
}

pub fn decode_payload(payload: &[u8; PAYLOAD_LEN]) -> Result<Claims, Error> {
    if &payload[..4] != b"ISG1" || payload[4] != 1 || payload[5] != 0 {
        return Err(Error::Header);
    }
    let currency = bytes(&payload[84..87]);
    let country: [u8; 2] = bytes(&payload[88..90]);
    if !currency.iter().all(u8::is_ascii_uppercase)
        || !country.iter().all(u8::is_ascii_uppercase)
        || currency_exponent(currency) != Some(payload[87])
    {
        return Err(Error::UnsupportedCurrency);
    }
    let claims = Claims {
        key_id: be_u16(&payload[6..8]),
        generation: bytes(&payload[8..24]),
        epoch: be_u32(&payload[24..28]),
        quote: bytes(&payload[28..44]),
        set: bytes(&payload[44..60]),
        index: be_u16(&payload[60..62]),
        count: be_u16(&payload[62..64]),
        variant: be_u64(&payload[64..72]),
        quantity: be_u32(&payload[72..76]),
        unit_minor: be_u64(&payload[76..84]),
        currency,
        exponent: payload[87],
        country,
        market: be_u64(&payload[90..98]),
        valid_through_day: be_u32(&payload[98..102]),
        total_quantity: be_u32(&payload[102..106]),
        total_minor: be_u64(&payload[106..114]),
    };
    if claims.count == 0
        || claims.index >= claims.count
        || claims.quantity == 0
        || claims.total_quantity < claims.quantity
        || claims.variant == 0
        || u128::from(claims.quantity) * u128::from(claims.unit_minor)
            > u128::from(claims.total_minor)
    {
        return Err(Error::Line);
    }
    Ok(claims)
}

pub fn encode_payload(claims: &Claims) -> Result<[u8; PAYLOAD_LEN], Error> {
    if claims.count == 0
        || claims.index >= claims.count
        || claims.quantity == 0
        || claims.total_quantity < claims.quantity
        || claims.variant == 0
        || u128::from(claims.quantity) * u128::from(claims.unit_minor)
            > u128::from(claims.total_minor)
    {
        return Err(Error::Line);
    }
    if currency_exponent(claims.currency) != Some(claims.exponent)
        || !claims.country.iter().all(u8::is_ascii_uppercase)
    {
        return Err(Error::UnsupportedCurrency);
    }
    let mut p = [0; PAYLOAD_LEN];
    p[..4].copy_from_slice(b"ISG1");
    p[4] = 1;
    p[6..8].copy_from_slice(&claims.key_id.to_be_bytes());
    p[8..24].copy_from_slice(&claims.generation);
    p[24..28].copy_from_slice(&claims.epoch.to_be_bytes());
    p[28..44].copy_from_slice(&claims.quote);
    p[44..60].copy_from_slice(&claims.set);
    p[60..62].copy_from_slice(&claims.index.to_be_bytes());
    p[62..64].copy_from_slice(&claims.count.to_be_bytes());
    p[64..72].copy_from_slice(&claims.variant.to_be_bytes());
    p[72..76].copy_from_slice(&claims.quantity.to_be_bytes());
    p[76..84].copy_from_slice(&claims.unit_minor.to_be_bytes());
    p[84..87].copy_from_slice(&claims.currency);
    p[87] = claims.exponent;
    p[88..90].copy_from_slice(&claims.country);
    p[90..98].copy_from_slice(&claims.market.to_be_bytes());
    p[98..102].copy_from_slice(&claims.valid_through_day.to_be_bytes());
    p[102..106].copy_from_slice(&claims.total_quantity.to_be_bytes());
    p[106..114].copy_from_slice(&claims.total_minor.to_be_bytes());
    Ok(p)
}

#[derive(Clone, Copy)]
pub struct VerificationKey {
    pub id: u16,
    pub bytes: [u8; 32],
}

pub fn verify_signature(auth: &SignedAuthorization, keys: &[VerificationKey]) -> Result<(), Error> {
    let key = keys
        .iter()
        .find(|k| k.id == auth.claims.key_id)
        .ok_or(Error::UnknownKey)?;
    let verifying_key = VerifyingKey::from_bytes(&key.bytes).map_err(|_| Error::Signature)?;
    let signature = Signature::from_bytes(&auth.signature);
    let mut message = [0; DOMAIN.len() + PAYLOAD_LEN];
    message[..DOMAIN.len()].copy_from_slice(DOMAIN);
    message[DOMAIN.len()..].copy_from_slice(&auth.payload);
    verifying_key
        .verify_strict(&message, &signature)
        .map_err(|_| Error::Signature)
}

pub struct ExpectedContext<'a> {
    pub generation: [u8; 16],
    pub epoch: u32,
    pub currency: [u8; 3],
    pub country: [u8; 2],
    pub market: u64,
    pub current_day: u32,
    pub max_buckets: u16,
    pub max_physical_quantity: u32,
    pub allow_no_market: bool,
    pub keys: &'a [VerificationKey],
}

pub struct PhysicalLine<'a> {
    pub token: Option<&'a str>,
    pub variant: u64,
    pub quantity: u32,
    /// Actual independent pre-discount unit amount from a proven target mapping.
    pub observed_unit_minor: Option<u64>,
    pub required: bool,
    pub marked: bool,
    pub selling_plan: bool,
}

pub fn verify_set(
    lines: &[PhysicalLine<'_>],
    expected: &ExpectedContext<'_>,
    require_observed_price: bool,
) -> Result<Vec<Claims>, Error> {
    let mut members = Vec::new();
    for line in lines {
        match line.token {
            None if line.required || line.marked => return Err(Error::Line),
            None => continue,
            Some(_) if !line.marked || line.selling_plan => return Err(Error::Line),
            Some(token) => {
                let auth = decode_token(token)?;
                verify_signature(&auth, expected.keys)?;
                let c = auth.claims;
                if c.generation != expected.generation
                    || c.epoch != expected.epoch
                    || c.currency != expected.currency
                    || c.country != expected.country
                    || c.market != expected.market
                {
                    return Err(Error::Context);
                }
                if c.market == 0 && !expected.allow_no_market {
                    return Err(Error::Context);
                }
                if expected.current_day > c.valid_through_day {
                    return Err(Error::Expired);
                }
                if c.count > expected.max_buckets
                    || c.variant != line.variant
                    || c.quantity != line.quantity
                {
                    return Err(Error::Line);
                }
                if require_observed_price
                    && line.observed_unit_minor.ok_or(Error::MissingPrice)? != c.unit_minor
                {
                    return Err(Error::Line);
                }
                members.push(c);
            }
        }
    }
    if members.is_empty() {
        return Ok(members);
    }
    let first = members[0];
    if members.len() != first.count as usize {
        return Err(Error::Incomplete);
    }
    let mut seen = vec![false; first.count as usize];
    let mut quantity = 0u32;
    let mut total = 0u64;
    for c in &members {
        if c.key_id != first.key_id
            || c.quote != first.quote
            || c.set != first.set
            || c.count != first.count
            || c.valid_through_day != first.valid_through_day
            || c.total_quantity != first.total_quantity
            || c.total_minor != first.total_minor
        {
            return Err(Error::Context);
        }
        let slot = &mut seen[c.index as usize];
        if *slot {
            return Err(Error::Duplicate);
        }
        *slot = true;
        quantity = quantity.checked_add(c.quantity).ok_or(Error::Overflow)?;
        if quantity > expected.max_physical_quantity {
            return Err(Error::Line);
        }
        total = total
            .checked_add(
                c.unit_minor
                    .checked_mul(c.quantity.into())
                    .ok_or(Error::Overflow)?,
            )
            .ok_or(Error::Overflow)?;
    }
    if !seen.iter().all(|x| *x) || quantity != first.total_quantity || total != first.total_minor {
        return Err(Error::Incomplete);
    }
    Ok(members)
}

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
    let mut keys = Vec::with_capacity(parsed.keys.len());
    for k in parsed.keys {
        if keys
            .iter()
            .any(|existing: &VerificationKey| existing.id == k.id)
        {
            return Err(Error::Context);
        }
        keys.push(VerificationKey {
            id: k.id,
            bytes: parse_hex(&k.public_hex)?,
        });
    }
    Ok(PublicConfig {
        generation: parse_hex(&parsed.generation_hex)?,
        epoch: parsed.epoch,
        max_buckets: parsed.max_buckets,
        max_physical_quantity: parsed.max_physical_quantity,
        allow_no_market: parsed.allow_no_market,
        keys,
    })
}
