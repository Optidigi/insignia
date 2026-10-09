# PR60 first completed review — accepted corrections

Exact R1 candidate `6f899be0a0eb226bb257d99be249a9e4a86fa54d`, tree `ff9b0fd94491ecd2ab2f8b0f1edd842f4dc83cf2`, base `d9ba6383a6e15958419ecf8e26d9182f08078e41`. All ten natural attempt-1 CI workflows passed; Spec and Standards/security both returned CHANGES_REQUIRED. CI did not override either finding. Actual GPT-6.1-sol/high/read-only session provenance is in the retained runtime receipt.

Accepted P2 descriptor failure: a real inherited blocking OS pipe with its writer left open kept the CLI alive beyond its five-second deadline. A hard-supervised reader now receives only FIFO/socket descriptors, is killed and reaped at timeout, and uses no token argument/environment/file/public stderr. Actual regular-file misuse is also RED/GREEN covered.

Accepted P2 key expansion: existing literal `%h`, `%d` and `${HOME}` identity files passed old metadata checks and reached injected local transport. The conservative absolute path allowlist now rejects these before reservation or authentication.

Separate correction manifests retain RED/GREEN/current-source hashes. Original manifests and their source bindings remain unchanged and are retrieved at R1 head; earlier passes are not relabeled onto corrected source. Parent integrated controls: 91 Admin,17host,13phase methods; style/secrets/integrity PASS. Fresh reviews and new exact-head CI are required; no native access or credentials used.

Public primary-source credential research is advisory only. Missing supported existing bearer remains STOP_READ_ONLY_CREDENTIAL_UNAVAILABLE; a possible separately authorized acquisition is not part of this allocation.
