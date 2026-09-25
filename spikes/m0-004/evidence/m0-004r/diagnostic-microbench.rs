use ed25519_dalek::{Signature, VerifyingKey};
use insignia_m0_004_authorization::{decode_token, parse_hex, DOMAIN};
use serde_json::Value;
use std::{hint::black_box, time::Instant};
fn main() {
 let v: Value = serde_json::from_str(include_str!("../../../fixtures/vectors.json")).unwrap();
 let key_bytes: [u8;32] = parse_hex(v["publicKeyHex"].as_str().unwrap()).unwrap();
 let token = v["valid"][0]["token"].as_str().unwrap();
 let auth = decode_token(token).unwrap();
 let key = VerifyingKey::from_bytes(&key_bytes).unwrap();
 let sig = Signature::from_bytes(&auth.signature);
 let mut message = DOMAIN.to_vec(); message.extend_from_slice(&auth.payload);
 let n=1000;
 let start=Instant::now();
 for _ in 0..n {black_box(VerifyingKey::from_bytes(black_box(&key_bytes)).unwrap());}
 println!("key parse ns/op {}",start.elapsed().as_nanos()/n);
 let start=Instant::now();
 for _ in 0..n {black_box(key.verify_strict(black_box(&message), black_box(&sig)).unwrap());}
 println!("strict verify ns/op {}",start.elapsed().as_nanos()/n);
 let start=Instant::now();
 for _ in 0..n {black_box(decode_token(black_box(token)).unwrap());}
 println!("token decode ns/op {}",start.elapsed().as_nanos()/n);
}
