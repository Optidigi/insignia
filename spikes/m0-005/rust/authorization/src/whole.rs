use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use curve25519_dalek::edwards::CompressedEdwardsY;
use ed25519_dalek::{Signature, VerifyingKey};

pub const DOMAIN: &[u8] = b"Insignia\0WholeQuoteAuthorization\0v2\0";
pub const HEADER_LEN: usize = 92;
pub const MEMBER_LEN: usize = 22;
pub const ENVELOPE_LEN: usize = HEADER_LEN + 64;
pub const ENVELOPE_CHARS: usize = 208;
pub const MEMBER_CHARS: usize = 30;

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
pub struct Header {
    pub raw: [u8; HEADER_LEN],
    pub key_id: u16,
    pub generation: [u8; 16],
    pub epoch: u32,
    pub quote: [u8; 16],
    pub set: [u8; 16],
    pub count: u16,
    pub currency: [u8; 3],
    pub exponent: u8,
    pub country: [u8; 2],
    pub market: u64,
    pub valid_through_day: u32,
    pub total_quantity: u32,
    pub total_minor: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Member {
    pub raw: [u8; MEMBER_LEN],
    pub index: u16,
    pub variant: u64,
    pub quantity: u32,
    pub unit_minor: u64,
}

pub struct Envelope {
    pub header: Header,
    pub signature: [u8; 64],
}

fn canonical<const N: usize>(value: &str, chars: usize) -> Result<[u8; N], Error> {
    if value.len() != chars
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(Error::Encoding);
    }
    let raw = URL_SAFE_NO_PAD.decode(value).map_err(|_| Error::Encoding)?;
    if raw.len() != N || URL_SAFE_NO_PAD.encode(&raw) != value {
        return Err(Error::Encoding);
    }
    raw.try_into().map_err(|_| Error::Encoding)
}

pub fn currency_exponent(code: [u8; 3]) -> Option<u8> {
    // Bounded local test table, not an assertion about Shopify market coverage.
    match &code {
        b"USD" | b"EUR" => Some(2),
        b"JPY" => Some(0),
        b"KWD" => Some(3),
        _ => None,
    }
}

pub fn decode_envelope(value: &str) -> Result<Envelope, Error> {
    let raw = canonical::<ENVELOPE_LEN>(value, ENVELOPE_CHARS)?;
    let header_raw: [u8; HEADER_LEN] = raw[..HEADER_LEN].try_into().unwrap();
    if &header_raw[..4] != b"ISG2" || header_raw[4] != 2 || header_raw[5] != 0 {
        return Err(Error::Header);
    }
    let currency: [u8; 3] = header_raw[62..65].try_into().unwrap();
    let country: [u8; 2] = header_raw[66..68].try_into().unwrap();
    if !currency.iter().all(u8::is_ascii_uppercase)
        || !country.iter().all(u8::is_ascii_uppercase)
        || currency_exponent(currency) != Some(header_raw[65])
    {
        return Err(Error::UnsupportedCurrency);
    }
    let header = Header {
        raw: header_raw,
        key_id: u16::from_be_bytes(header_raw[6..8].try_into().unwrap()),
        generation: header_raw[8..24].try_into().unwrap(),
        epoch: u32::from_be_bytes(header_raw[24..28].try_into().unwrap()),
        quote: header_raw[28..44].try_into().unwrap(),
        set: header_raw[44..60].try_into().unwrap(),
        count: u16::from_be_bytes(header_raw[60..62].try_into().unwrap()),
        currency,
        exponent: header_raw[65],
        country,
        market: u64::from_be_bytes(header_raw[68..76].try_into().unwrap()),
        valid_through_day: u32::from_be_bytes(header_raw[76..80].try_into().unwrap()),
        total_quantity: u32::from_be_bytes(header_raw[80..84].try_into().unwrap()),
        total_minor: u64::from_be_bytes(header_raw[84..92].try_into().unwrap()),
    };
    if header.count == 0 || header.total_quantity == 0 {
        return Err(Error::Header);
    }
    Ok(Envelope {
        header,
        signature: raw[HEADER_LEN..].try_into().unwrap(),
    })
}

pub fn decode_member(value: &str) -> Result<Member, Error> {
    let raw = canonical::<MEMBER_LEN>(value, MEMBER_CHARS)?;
    let member = Member {
        raw,
        index: u16::from_be_bytes(raw[..2].try_into().unwrap()),
        variant: u64::from_be_bytes(raw[2..10].try_into().unwrap()),
        quantity: u32::from_be_bytes(raw[10..14].try_into().unwrap()),
        unit_minor: u64::from_be_bytes(raw[14..22].try_into().unwrap()),
    };
    if member.variant == 0 || member.quantity == 0 {
        return Err(Error::Line);
    }
    Ok(member)
}

#[derive(Clone, Copy)]
pub struct VerificationKey {
    id: u16,
    parsed: VerifyingKey,
    revoked: bool,
    first_day: u32,
    last_day: u32,
}
impl VerificationKey {
    pub fn new(id: u16, bytes: [u8; 32]) -> Result<Self, Error> {
        Self::new_with_admission(id, bytes, false, 0, u32::MAX)
    }

    pub fn new_with_admission(
        id: u16,
        bytes: [u8; 32],
        revoked: bool,
        first_day: u32,
        last_day: u32,
    ) -> Result<Self, Error> {
        if first_day > last_day {
            return Err(Error::Context);
        }
        // Dalek decompression can accept a noncanonical compressed y. Require the
        // maintained curve primitive's canonical re-encoding before key admission.
        let point = CompressedEdwardsY(bytes)
            .decompress()
            .ok_or(Error::Signature)?;
        if point.compress().to_bytes() != bytes {
            return Err(Error::Signature);
        }
        let parsed = VerifyingKey::from_bytes(&bytes).map_err(|_| Error::Signature)?;
        if parsed.is_weak() {
            return Err(Error::Signature);
        }
        Ok(Self {
            id,
            parsed,
            revoked,
            first_day,
            last_day,
        })
    }
    pub fn id(&self) -> u16 {
        self.id
    }
    pub fn bytes(&self) -> [u8; 32] {
        self.parsed.to_bytes()
    }
    pub fn admitted(&self, day: u32) -> bool {
        !self.revoked && self.first_day <= day && day <= self.last_day
    }
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
    pub member: Option<&'a str>,
    pub variant: u64,
    pub quantity: u32,
    pub observed_unit_minor: Option<u64>,
    pub required: bool,
    pub marked: bool,
    pub selling_plan: bool,
}

pub fn verify_set(
    envelope: Option<&str>,
    lines: &[PhysicalLine<'_>],
    expected: &ExpectedContext<'_>,
    require_observed_price: bool,
) -> Result<Vec<Member>, Error> {
    let marked_count = lines
        .iter()
        .filter(|l| l.marked || l.member.is_some())
        .count();
    if marked_count == 0 {
        if envelope.is_some() || lines.iter().any(|l| l.required) {
            return Err(Error::Incomplete);
        }
        return Ok(Vec::new());
    }
    let envelope = decode_envelope(envelope.ok_or(Error::Incomplete)?)?;
    let h = &envelope.header;
    if h.count > expected.max_buckets
        || usize::from(h.count) != marked_count
        || h.total_quantity > expected.max_physical_quantity
    {
        return Err(Error::Incomplete);
    }
    if h.generation != expected.generation
        || h.epoch != expected.epoch
        || h.currency != expected.currency
        || h.country != expected.country
        || h.market != expected.market
        || h.market == 0 && !expected.allow_no_market
    {
        return Err(Error::Context);
    }
    if expected.current_day > h.valid_through_day || h.valid_through_day - expected.current_day > 2
    {
        return Err(Error::Expired);
    }
    let mut ordered: Vec<Option<Member>> = vec![None; usize::from(h.count)];
    let mut in_cart_order = Vec::with_capacity(marked_count);
    let mut quantity = 0u32;
    let mut total = 0u64;
    for line in lines {
        if !line.marked && line.member.is_none() {
            if line.required {
                return Err(Error::Line);
            }
            continue;
        }
        if !line.marked || line.selling_plan {
            return Err(Error::Line);
        }
        let member = decode_member(line.member.ok_or(Error::Line)?)?;
        if member.index >= h.count
            || member.variant != line.variant
            || member.quantity != line.quantity
        {
            return Err(Error::Line);
        }
        if require_observed_price
            && line.observed_unit_minor.ok_or(Error::MissingPrice)? != member.unit_minor
        {
            return Err(Error::Line);
        }
        let slot = &mut ordered[usize::from(member.index)];
        if slot.is_some() {
            return Err(Error::Duplicate);
        }
        *slot = Some(member);
        in_cart_order.push(member);
        quantity = quantity
            .checked_add(member.quantity)
            .ok_or(Error::Overflow)?;
        total = total
            .checked_add(
                member
                    .unit_minor
                    .checked_mul(u64::from(member.quantity))
                    .ok_or(Error::Overflow)?,
            )
            .ok_or(Error::Overflow)?;
        if quantity > expected.max_physical_quantity {
            return Err(Error::Line);
        }
    }
    if quantity != h.total_quantity || total != h.total_minor || ordered.iter().any(Option::is_none)
    {
        return Err(Error::Incomplete);
    }
    let key = expected
        .keys
        .iter()
        .find(|k| k.id == h.key_id)
        .ok_or(Error::UnknownKey)?;
    if !key.admitted(expected.current_day) {
        return Err(Error::UnknownKey);
    }
    let mut message = Vec::with_capacity(DOMAIN.len() + HEADER_LEN + MEMBER_LEN * ordered.len());
    message.extend_from_slice(DOMAIN);
    message.extend_from_slice(&h.raw);
    for member in ordered.into_iter().flatten() {
        message.extend_from_slice(&member.raw);
    }
    key.parsed
        .verify_strict(&message, &Signature::from_bytes(&envelope.signature))
        .map_err(|_| Error::Signature)?;
    Ok(in_cart_order)
}
