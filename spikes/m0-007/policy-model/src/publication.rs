//! Pure local model of app publication intent. Admin and Function propagation are separate.
use super::projection::{classify, parse_field, Field, PlainPolicy};

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Cell {
    pub value: Option<String>,
    pub digest: u64,
}

impl Cell {
    pub fn cas(&mut self, expected: u64, value: String) -> Result<(), Error> {
        if self.value.as_deref() == Some(&value) {
            return Ok(());
        }
        if self.digest != expected {
            return Err(Error::Stale);
        }
        self.value = Some(value);
        self.digest += 1;
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct ProductProjection {
    pub registration: Cell,
    pub policy: Cell,
    pub available: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Mode {
    Required,
    Optional,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Required => "required",
            Self::Optional => "optional",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Prepared,
    Pending,
    PolicyWritten,
    ReadyWritten,
    ObservedReady,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    Available,
    Stale,
    Conflict,
    InvalidReadback,
}

#[derive(Clone, Debug)]
pub struct Intent {
    pub product_id: u64,
    pub generation: [u8; 16],
    pub revision: u32,
    pub mode: Mode,
    pub phase: Phase,
    registration_digest: u64,
    policy_digest: u64,
}

impl Intent {
    pub fn begin(
        product_id: u64,
        generation: [u8; 16],
        revision: u32,
        mode: Mode,
        projection: &ProductProjection,
    ) -> Result<Self, Error> {
        if projection.available {
            return Err(Error::Available);
        }
        if revision == 0 {
            return Err(Error::Conflict);
        }
        let mut intent = Self {
            product_id,
            generation,
            revision,
            mode,
            phase: Phase::Prepared,
            registration_digest: projection.registration.digest,
            policy_digest: projection.policy.digest,
        };
        match projection.registration.value.as_deref() {
            None if projection.policy.value.is_some() => return Err(Error::Conflict),
            None => {}
            Some(value) => match parse_field(value) {
                Field::Parsed {
                    generation: found,
                    revision: current,
                    state: "ready",
                } if found == generation && current < revision => {}
                Field::Parsed {
                    generation: found,
                    revision: current,
                    state: "ready",
                } if found == generation
                    && current == revision
                    && projection.policy.value.as_deref()
                        == Some(intent.value(mode.as_str()).as_str()) =>
                {
                    intent.phase = Phase::ReadyWritten
                }
                Field::Parsed {
                    generation: found,
                    revision: current,
                    state: "pending",
                } if found == generation && current == revision => {
                    intent.phase = if projection.policy.value.as_deref()
                        == Some(intent.value(mode.as_str()).as_str())
                    {
                        Phase::PolicyWritten
                    } else {
                        Phase::Pending
                    };
                }
                _ => return Err(Error::Conflict),
            },
        }
        Ok(intent)
    }

    fn value(&self, state: &str) -> String {
        let mut generation = String::with_capacity(32);
        for byte in self.generation {
            generation.push_str(&format!("{byte:02x}"));
        }
        format!("{generation}:{}:{state}", self.revision)
    }

    pub fn advance(&mut self, projection: &mut ProductProjection) -> Result<Phase, Error> {
        if projection.available {
            return Err(Error::Available);
        }
        match self.phase {
            Phase::Prepared => {
                projection
                    .registration
                    .cas(self.registration_digest, self.value("pending"))?;
                self.registration_digest = projection.registration.digest;
                self.phase = Phase::Pending;
            }
            Phase::Pending => {
                projection
                    .policy
                    .cas(self.policy_digest, self.value(self.mode.as_str()))?;
                self.policy_digest = projection.policy.digest;
                self.phase = Phase::PolicyWritten;
            }
            Phase::PolicyWritten => {
                if projection.registration.value.as_deref() != Some(self.value("pending").as_str())
                    || projection.policy.value.as_deref()
                        != Some(self.value(self.mode.as_str()).as_str())
                {
                    return Err(Error::InvalidReadback);
                }
                projection
                    .registration
                    .cas(self.registration_digest, self.value("ready"))?;
                self.registration_digest = projection.registration.digest;
                self.phase = Phase::ReadyWritten;
            }
            Phase::ReadyWritten | Phase::ObservedReady => {}
        }
        Ok(self.phase)
    }

    /// Only a separately observed Function input can turn Admin readback into readiness.
    pub fn observe_function(
        &mut self,
        registration: Option<&str>,
        policy: Option<&str>,
    ) -> Result<(), Error> {
        if self.phase != Phase::ReadyWritten {
            return Err(Error::Conflict);
        }
        if registration != Some(self.value("ready").as_str())
            || policy != Some(self.value(self.mode.as_str()).as_str())
        {
            return Err(Error::InvalidReadback);
        }
        let desired = match self.mode {
            Mode::Required => PlainPolicy::Required,
            Mode::Optional => PlainPolicy::Optional,
        };
        if classify(registration, policy, self.generation).plain != desired {
            return Err(Error::InvalidReadback);
        }
        self.phase = Phase::ObservedReady;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const G: [u8; 16] = [0x11; 16];

    fn publish(projection: &mut ProductProjection, revision: u32, mode: Mode) -> Intent {
        let mut intent = Intent::begin(42, G, revision, mode, projection).unwrap();
        assert_eq!(intent.advance(projection), Ok(Phase::Pending));
        assert_eq!(intent.advance(projection), Ok(Phase::PolicyWritten));
        assert_eq!(intent.advance(projection), Ok(Phase::ReadyWritten));
        let registration = projection.registration.value.clone();
        let policy = projection.policy.value.clone();
        intent
            .observe_function(registration.as_deref(), policy.as_deref())
            .unwrap();
        intent
    }

    #[test]
    fn first_publication_and_both_directions_require_function_readback() {
        let mut projection = ProductProjection::default();
        assert_eq!(
            publish(&mut projection, 1, Mode::Required).phase,
            Phase::ObservedReady
        );
        assert_eq!(
            publish(&mut projection, 2, Mode::Optional).phase,
            Phase::ObservedReady
        );
        assert_eq!(
            publish(&mut projection, 3, Mode::Required).phase,
            Phase::ObservedReady
        );
    }

    #[test]
    fn interrupted_write_is_pending_and_resume_is_idempotent() {
        let mut projection = ProductProjection::default();
        let mut intent = Intent::begin(42, G, 1, Mode::Required, &projection).unwrap();
        intent.advance(&mut projection).unwrap();
        assert_eq!(
            classify(
                projection.registration.value.as_deref(),
                projection.policy.value.as_deref(),
                G
            )
            .plain,
            PlainPolicy::Uncertain
        );
        let interrupted = intent.clone();
        intent.advance(&mut projection).unwrap();
        let mut retry = interrupted;
        assert_eq!(retry.advance(&mut projection), Ok(Phase::PolicyWritten));
        assert_eq!(retry.advance(&mut projection), Ok(Phase::ReadyWritten));
        assert_eq!(retry.advance(&mut projection), Ok(Phase::ReadyWritten));
    }

    #[test]
    fn stale_cas_rejects_concurrent_publication_and_available_product() {
        let mut projection = ProductProjection::default();
        let mut intent = Intent::begin(42, G, 1, Mode::Required, &projection).unwrap();
        projection.registration.cas(0, "other".into()).unwrap();
        assert_eq!(intent.advance(&mut projection), Err(Error::Stale));
        projection.available = true;
        assert!(matches!(
            Intent::begin(42, G, 2, Mode::Optional, &projection),
            Err(Error::Available)
        ));
    }

    #[test]
    fn stale_revision_cannot_roll_back_and_ready_retry_requires_projection_again() {
        let mut projection = ProductProjection::default();
        publish(&mut projection, 1, Mode::Required);
        assert!(matches!(
            Intent::begin(42, G, 1, Mode::Optional, &projection),
            Err(Error::Conflict)
        ));
        let mut retry = Intent::begin(42, G, 1, Mode::Required, &projection).unwrap();
        assert_eq!(retry.phase, Phase::ReadyWritten);
        assert_eq!(retry.advance(&mut projection), Ok(Phase::ReadyWritten));
        let registration = projection.registration.value.clone();
        let policy = projection.policy.value.clone();
        retry
            .observe_function(registration.as_deref(), policy.as_deref())
            .unwrap();
        assert_eq!(retry.phase, Phase::ObservedReady);
    }

    #[test]
    fn concurrent_policy_write_after_pending_is_cas_stale() {
        let mut projection = ProductProjection::default();
        let mut intent = Intent::begin(42, G, 1, Mode::Required, &projection).unwrap();
        intent.advance(&mut projection).unwrap();
        projection.policy.cas(0, "other".into()).unwrap();
        assert_eq!(intent.advance(&mut projection), Err(Error::Stale));
        assert_eq!(
            classify(
                projection.registration.value.as_deref(),
                projection.policy.value.as_deref(),
                G
            )
            .plain,
            PlainPolicy::Uncertain
        );
    }
}
