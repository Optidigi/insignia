# Pre-credential review findings and responses

Round1 at head `aa894d6451a8bc404af859b59ad23596ae9bd760`, base `6a186bea8e5d1c01a66f7ab683c06393fe81e991`.

Spec reviewer `01a1130c-914b-7cc1-8715-7654abfdeef2` found P1: zero-effective ACTIVE PARTIAL could survive a lost archive ACK while mutation remained UNKNOWN. P2: ambiguity handling called both ownership and final snapshot, exceeding one classification read. Standards/security reviewer `01a1130c-9154-7a43-9350-af85f1b3e609` found no material issues; its review is historical, not approval of the corrected head.

Both reproduced with memory-only provider replies: archive applied, then transport ACK lost. The two focused regressions failed before correction. New cleanup ambiguity handling preserves `UNKNOWN_ARCHIVE_WRITE`, permits at most one exact ownership/status classification read when transport is quiescent/accounted, and never performs a final v2 snapshot or retry. The UNKNOWN mutation remains UNKNOWN; a read is not ACK settlement. PARTIAL additionally requires settled writes, matching transport accounting and no cleanup failure. Both regressions pass after correction. Full focused/root regression and two entirely fresh full-source reviews are required again before credentials.

Grant-set question: the principal explicitly requires current grants contain three named scopes and record additional valid grants; no whole-set equality constraint is added. Exact identity/install/development/minimum grants are revalidated on ownership observations and the unchanged production adapter performs its own required-grant checks. No scope/config operation is authorized.

Canonical live directory remains absent; credential access and Shopify requests remain NOT_RUN. Historical M5-015 remains unchanged and STOPPED.

## Completed-evidence Round3 timestamp correction

Both Spec/correctness and Standards/security reviews at head `98c5c374675ad89890245ab0d9d297d23943154f` found P2 in derived timestamp diagnostics/report: create ACK and next ownership event3 both54Z, yet delta was hardcoded1000ms and report assigned the later DRAFT snapshot55Z to ownership. Corrected derived diagnostics now identify exact event indices and compute separate ownership and production-read deltas directly from the unchanged canonical register: create0ms/+1000ms, setup+1000ms/+1000ms. The source canonical register SHA is included. No canonical bytes, harness/production source, timestamp semantics or provider operation changed. Fresh full-source reviews and final-head CI must repeat on corrected evidence.
