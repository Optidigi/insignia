# PR60 round-four response

Candidate `56356536d26a5a262bc37e2b309c17824671643e`, tree `a5fe3b59e80f0773c35b5d3457c9e86fca5565bc`, was not accepted. The fresh Spec review required correction of the orphan-reader observation; Standards/security was CLEAR. Natural exact-head attempt-1 CI had eight successes and two failures, runs `37960035511` and `37960035570`. All results are retained separately; neither failed run is rerun as qualification.

The old helper stopped polling as soon as it observed a terminal leader and probed pipe closure once. Actual CI recorded `Z` with `pipeClosed=false`. A separate exact-baseline local control reproduced this in five of sixteen samples. Further observation with unchanged runtime found two late closures approximately twenty milliseconds after the first zombie/open observation; all sixteen closed within the original six-second observer bound. Terminal leader state alone was insufficient evidence of descriptor teardown.

The corrected observer polls for both terminal state and actual `EPIPE` using bounded nonblocking one-byte probes until the same original deadline. Backpressure, a live process, an inspection error or closure after the deadline cannot qualify. Assertions still require terminal state, released pipe, terminated CLI and no private output. No timeout increase, production fix, credential operation or native call is implied.

Separate [correction evidence](../pr60-r4-ci-corrections/manifest.json) preserves the actual reproduction, measurements, source bindings and historical manifests. CLI, collector, phase and host runtime bytes remain unchanged. Both new independent completed-change reviews and natural exact-head attempt-1 CI must qualify the new candidate before access or local acceptance.
