# Offline correction after the stopped live run

Frozen live source was1d62d7249ee22e6275eb9ed3299fb6f56991d0f3. It collected five post-DRAFT reads before its full settlement check refused the one-second acknowledgement/readback version mismatch. This timing limitation is preserved in the empirical report.

The current harness checks acknowledgement/current-port readback version and visibility equality before requesting those post views. The observed mismatch regression first reproduced the late stop with15 reads, then passed with10 reads and no post projection or cleanup. Focused46/46 including100 serial cases pass. This correction is offline only. The canonical register is closed; no second live run occurred or is authorized. Production availability source remains unchanged.
