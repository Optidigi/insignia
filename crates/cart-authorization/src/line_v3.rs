//! Cart-line authorization v3 (exact layout: docs/architecture/CART-LINE-V3.md).
//!
//! One Ed25519 signature per issuance covers a 113-byte header that commits to a Merkle root of
//! per-line records (index, real variant, unit price). Each customized cart line carries the shared
//! 236-character signed prefix, its own record and its inclusion proof. Quantity is not signed.
//! A cart holds at most one set: the signature is verified once per cart and every line is checked
//! against the same prefix and root.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::Signature;
use sha2::{Digest, Sha512_256};

use crate::{currency_exponent, Error, ExpectedContext};

pub const DOMAIN_V3: &[u8] = b"Insignia\0CartLineAuthorization\0v3\0";
pub const LEAF_LABEL_V3: &[u8] = b"Insignia\0CartLine\0v3\0";
pub const HEADER_V3_LEN: usize = 113;
pub const PREFIX_V3_LEN: usize = HEADER_V3_LEN + 64;
/// 177 bytes is a multiple of three, so the prefix encodes to exactly 236 characters.
pub const PREFIX_V3_CHARS: usize = 236;
pub const RECORD_V3_LEN: usize = 17;
pub const HASH_LEN: usize = 32;
pub const MAX_LINES_V3: u8 = 32;
pub const MAX_DEPTH_V3: u8 = 5;
pub const MAX_TAIL_V3_LEN: usize = RECORD_V3_LEN + HASH_LEN * MAX_DEPTH_V3 as usize;
pub const MAX_LINE_V3_CHARS: usize = PREFIX_V3_CHARS + tail_chars(MAX_DEPTH_V3);
pub const REF_V3_LEN: usize = 17;
pub const REF_V3_CHARS: usize = 23;

const LEAF_TAG: u8 = 0;
const NODE_TAG: u8 = 1;
const EMPTY_TAG: u8 = 2;

/// Base64 characters of a record plus `depth` proof hashes (no padding).
pub const fn tail_chars(depth: u8) -> usize {
    (RECORD_V3_LEN + HASH_LEN * depth as usize).div_ceil(3) * 4
        - match (RECORD_V3_LEN + HASH_LEN * depth as usize) % 3 {
            1 => 2,
            2 => 1,
            _ => 0,
        }
}

/// Proof depth fixed by the signed line count: ceil(log2 n), 0 for one line.
pub const fn depth_for_count(count: u8) -> u8 {
    let mut depth = 0u8;
    while (1u32 << depth) < count as u32 {
        depth += 1;
    }
    depth
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeaderV3 {
    pub raw: [u8; HEADER_V3_LEN],
    pub key_id: u16,
    pub generation: [u8; 16],
    pub epoch: u32,
    pub quote: [u8; 16],
    pub set: [u8; 16],
    pub count: u8,
    pub depth: u8,
    pub currency: [u8; 3],
    pub exponent: u8,
    pub country: [u8; 2],
    pub market: u64,
    pub valid_through_day: u32,
    pub root: [u8; HASH_LEN],
}

pub struct PrefixV3 {
    pub header: HeaderV3,
    pub signature: [u8; 64],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineTailV3 {
    pub raw: [u8; RECORD_V3_LEN],
    pub index: u8,
    pub variant: u64,
    pub unit_minor: u64,
    pub depth: u8,
    pub proof: [[u8; HASH_LEN]; MAX_DEPTH_V3 as usize],
}

/// Strict canonical unpadded base64url: exact length, alphabet, decoded size and re-encoding.
fn canonical_into(value: &[u8], out: &mut [u8]) -> Result<(), Error> {
    let chars = out.len().div_ceil(3) * 4
        - match out.len() % 3 {
            1 => 2,
            2 => 1,
            _ => 0,
        };
    if value.len() != chars
        || !value
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_')
    {
        return Err(Error::Encoding);
    }
    let mut decoded = [0u8; PREFIX_V3_LEN];
    let n = URL_SAFE_NO_PAD
        .decode_slice(value, &mut decoded)
        .map_err(|_| Error::Encoding)?;
    if n != out.len() {
        return Err(Error::Encoding);
    }
    let mut encoded = [0u8; PREFIX_V3_CHARS];
    let m = URL_SAFE_NO_PAD
        .encode_slice(&decoded[..n], &mut encoded)
        .map_err(|_| Error::Encoding)?;
    if &encoded[..m] != value {
        return Err(Error::Encoding);
    }
    out.copy_from_slice(&decoded[..n]);
    Ok(())
}

pub fn decode_prefix_v3(value: &[u8]) -> Result<PrefixV3, Error> {
    let mut raw = [0u8; PREFIX_V3_LEN];
    canonical_into(value, &mut raw)?;
    let h: [u8; HEADER_V3_LEN] = raw[..HEADER_V3_LEN].try_into().unwrap();
    if &h[..4] != b"ISG3" || h[4] != 3 || h[5] != 0 || h[112] != 0 {
        return Err(Error::Header);
    }
    let count = h[60];
    if count == 0 || count > MAX_LINES_V3 || h[61] != depth_for_count(count) {
        return Err(Error::Header);
    }
    let currency: [u8; 3] = h[62..65].try_into().unwrap();
    let country: [u8; 2] = h[66..68].try_into().unwrap();
    if !currency.iter().all(u8::is_ascii_uppercase)
        || !country.iter().all(u8::is_ascii_uppercase)
        || currency_exponent(currency) != Some(h[65])
    {
        return Err(Error::UnsupportedCurrency);
    }
    Ok(PrefixV3 {
        header: HeaderV3 {
            raw: h,
            key_id: u16::from_be_bytes(h[6..8].try_into().unwrap()),
            generation: h[8..24].try_into().unwrap(),
            epoch: u32::from_be_bytes(h[24..28].try_into().unwrap()),
            quote: h[28..44].try_into().unwrap(),
            set: h[44..60].try_into().unwrap(),
            count,
            depth: h[61],
            currency,
            exponent: h[65],
            country,
            market: u64::from_be_bytes(h[68..76].try_into().unwrap()),
            valid_through_day: u32::from_be_bytes(h[76..80].try_into().unwrap()),
            root: h[80..112].try_into().unwrap(),
        },
        signature: raw[HEADER_V3_LEN..].try_into().unwrap(),
    })
}

/// Decode the per-line tail after the shared prefix; its exact length follows from the signed depth.
pub fn decode_tail_v3(value: &[u8], depth: u8) -> Result<LineTailV3, Error> {
    if depth > MAX_DEPTH_V3 {
        return Err(Error::Header);
    }
    let len = RECORD_V3_LEN + HASH_LEN * depth as usize;
    let mut raw = [0u8; MAX_TAIL_V3_LEN];
    canonical_into(value, &mut raw[..len])?;
    let record: [u8; RECORD_V3_LEN] = raw[..RECORD_V3_LEN].try_into().unwrap();
    let mut proof = [[0u8; HASH_LEN]; MAX_DEPTH_V3 as usize];
    for (k, slot) in proof.iter_mut().take(depth as usize).enumerate() {
        let start = RECORD_V3_LEN + HASH_LEN * k;
        slot.copy_from_slice(&raw[start..start + HASH_LEN]);
    }
    let tail = LineTailV3 {
        raw: record,
        index: record[0],
        variant: u64::from_be_bytes(record[1..9].try_into().unwrap()),
        unit_minor: u64::from_be_bytes(record[9..17].try_into().unwrap()),
        depth,
        proof,
    };
    if tail.variant == 0 {
        return Err(Error::Line);
    }
    Ok(tail)
}

pub fn leaf_hash_v3(record: &[u8; RECORD_V3_LEN]) -> [u8; HASH_LEN] {
    let mut h = Sha512_256::new();
    h.update([LEAF_TAG]);
    h.update(LEAF_LABEL_V3);
    h.update(record);
    h.finalize().into()
}

pub fn node_hash_v3(left: &[u8; HASH_LEN], right: &[u8; HASH_LEN]) -> [u8; HASH_LEN] {
    let mut h = Sha512_256::new();
    h.update([NODE_TAG]);
    h.update(left);
    h.update(right);
    h.finalize().into()
}

pub fn empty_slot_v3() -> [u8; HASH_LEN] {
    let mut h = Sha512_256::new();
    h.update([EMPTY_TAG]);
    h.update(LEAF_LABEL_V3);
    h.finalize().into()
}

/// Root recomputed from one record and its proof. Bit k of the index selects the side at level k.
pub fn proof_root_v3(tail: &LineTailV3) -> [u8; HASH_LEN] {
    let mut node = leaf_hash_v3(&tail.raw);
    for (k, sibling) in tail.proof.iter().take(tail.depth as usize).enumerate() {
        node = if (tail.index >> k) & 1 == 1 {
            node_hash_v3(sibling, &node)
        } else {
            node_hash_v3(&node, sibling)
        };
    }
    node
}

/// The short reference Transform copies to the expanded child: base64url(set UUID || index).
pub fn ref_v3(set: &[u8; 16], index: u8) -> String {
    let mut raw = [0u8; REF_V3_LEN];
    raw[..16].copy_from_slice(set);
    raw[16] = index;
    URL_SAFE_NO_PAD.encode(raw)
}

/// One customized cart line as observed by a Function. Only lines carrying the v3 property are passed.
pub struct CartLineV3<'a> {
    pub carrier: &'a str,
    pub variant: u64,
    pub quantity: u32,
    pub observed_unit_minor: Option<u64>,
    pub selling_plan: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineClaimV3 {
    pub index: u8,
    pub unit_minor: u64,
}

pub struct VerifiedLinesV3 {
    pub set: [u8; 16],
    /// In the order of the input lines.
    pub claims: Vec<LineClaimV3>,
}

/// Verify every customized line of one cart independently against one signed set.
///
/// Set-level checks and the single signature verification come from the first line's prefix; every
/// line must carry the byte-identical prefix (one set per cart). Per line: canonical tail of the exact
/// signed depth, index below the signed count and unique in the cart, signed real variant, no selling
/// plan, Merkle inclusion and (Validation) the observed pre-discount unit price. Quantities are only
/// bounded, never compared with any signed value.
pub fn verify_lines_v3(
    lines: &[CartLineV3<'_>],
    expected: &ExpectedContext<'_>,
    require_observed_price: bool,
) -> Result<VerifiedLinesV3, Error> {
    let Some(first) = lines.first() else {
        return Ok(VerifiedLinesV3 {
            set: [0; 16],
            claims: Vec::new(),
        });
    };
    let first = first.carrier.as_bytes();
    if first.len() < PREFIX_V3_CHARS {
        return Err(Error::Encoding);
    }
    let prefix_chars = &first[..PREFIX_V3_CHARS];
    let prefix = decode_prefix_v3(prefix_chars)?;
    let h = &prefix.header;
    if u16::from(h.count) > expected.max_buckets || lines.len() > usize::from(h.count) {
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
    let line_chars = PREFIX_V3_CHARS + tail_chars(h.depth);
    let mut seen = 0u32;
    let mut quantity = 0u32;
    let mut total = 0u64;
    let mut claims = Vec::with_capacity(lines.len());
    for line in lines {
        let carrier = line.carrier.as_bytes();
        if carrier.len() != line_chars || &carrier[..PREFIX_V3_CHARS] != prefix_chars {
            return Err(Error::MixedSet);
        }
        if line.selling_plan || line.quantity == 0 {
            return Err(Error::Line);
        }
        let tail = decode_tail_v3(&carrier[PREFIX_V3_CHARS..], h.depth)?;
        if tail.index >= h.count || tail.variant != line.variant {
            return Err(Error::Line);
        }
        let bit = 1u32 << tail.index;
        if seen & bit != 0 {
            return Err(Error::Duplicate);
        }
        seen |= bit;
        if require_observed_price
            && line.observed_unit_minor.ok_or(Error::MissingPrice)? != tail.unit_minor
        {
            return Err(Error::Line);
        }
        // Plain engineering bounds and overflow defence only; quantity is not a signed claim.
        quantity = quantity.checked_add(line.quantity).ok_or(Error::Overflow)?;
        if quantity > expected.max_physical_quantity {
            return Err(Error::Line);
        }
        total = total
            .checked_add(
                tail.unit_minor
                    .checked_mul(u64::from(line.quantity))
                    .ok_or(Error::Overflow)?,
            )
            .ok_or(Error::Overflow)?;
        if proof_root_v3(&tail) != h.root {
            return Err(Error::Proof);
        }
        claims.push(LineClaimV3 {
            index: tail.index,
            unit_minor: tail.unit_minor,
        });
    }
    let key = expected
        .keys
        .iter()
        .find(|k| k.id() == h.key_id)
        .ok_or(Error::UnknownKey)?;
    if !key.admitted(expected.current_day) {
        return Err(Error::UnknownKey);
    }
    let mut message = [0u8; DOMAIN_V3.len() + HEADER_V3_LEN];
    message[..DOMAIN_V3.len()].copy_from_slice(DOMAIN_V3);
    message[DOMAIN_V3.len()..].copy_from_slice(&h.raw);
    key.verify_strict(&message, &Signature::from_bytes(&prefix.signature))?;
    Ok(VerifiedLinesV3 { set: h.set, claims })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_carrier_widths_follow_depth() {
        let widths: Vec<usize> = (0..=MAX_DEPTH_V3)
            .map(|d| PREFIX_V3_CHARS + tail_chars(d))
            .collect();
        assert_eq!(widths, [259, 302, 344, 387, 430, 472]);
        assert_eq!(MAX_LINE_V3_CHARS, 472);
        assert_eq!(
            [1, 2, 3, 4, 5, 8, 9, 16, 17, 32].map(depth_for_count),
            [0, 1, 2, 2, 3, 3, 4, 4, 5, 5]
        );
        assert_eq!(ref_v3(&[0; 16], 0).len(), REF_V3_CHARS);
    }
}
