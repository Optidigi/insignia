---
name: init
description: "Bootstrap a new repo for the platform. Detects the stack and scaffolds scripts/test-changed.sh and scripts/test-all.sh. Run this before the first /build on a fresh project."
---

## Steps

1. Load the `stack` skill and run stack detection.

2. Create the `scripts/` directory if it does not exist.

3. Write `scripts/test-changed.sh` using the template for the detected stack:

**JS/TS (Jest)**
```bash
#!/bin/bash
# Runs tests only for files changed since the last commit.
set -euo pipefail
npx jest --passWithNoTests --findRelatedTests $(git diff --name-only HEAD) "$@"
```

**JS/TS (Vitest)**
```bash
#!/bin/bash
set -euo pipefail
CHANGED=$(git diff --name-only HEAD | tr '\n' ' ')
[ -z "$CHANGED" ] && exit 0
npx vitest run --reporter=verbose $CHANGED "$@"
```

**Python (pytest)**
```bash
#!/bin/bash
set -euo pipefail
CHANGED=$(git diff --name-only HEAD | grep '\.py$' | tr '\n' ' ')
[ -z "$CHANGED" ] && exit 0
python -m pytest $CHANGED -v "$@"
```

**Rust**
```bash
#!/bin/bash
# cargo test has no per-file mode; run the full suite on changes.
set -euo pipefail
cargo test "$@"
```

**Go**
```bash
#!/bin/bash
set -euo pipefail
# Run tests in packages that contain changed files.
PKGS=$(git diff --name-only HEAD | grep '\.go$' | xargs -I{} dirname {} | sort -u \
       | xargs -I{} echo "./{}" | tr '\n' ' ')
[ -z "$PKGS" ] && exit 0
go test $PKGS "$@"
```

4. Write `scripts/test-all.sh` using the template for the detected stack:

**JS/TS (Jest)**
```bash
#!/bin/bash
set -euo pipefail
npx jest --passWithNoTests "$@"
```

**JS/TS (Vitest)**
```bash
#!/bin/bash
set -euo pipefail
npx vitest run "$@"
```

**Python**
```bash
#!/bin/bash
set -euo pipefail
python -m pytest "$@"
```

**Rust**
```bash
#!/bin/bash
set -euo pipefail
cargo test "$@"
```

**Go**
```bash
#!/bin/bash
set -euo pipefail
go test ./... "$@"
```

5. Make both scripts executable:
```bash
chmod +x scripts/test-changed.sh scripts/test-all.sh
```

6. If no stack is detected, write a shell stub that exits 0 with a warning, so
   the platform doesn't error on first run:
```bash
#!/bin/bash
echo "WARNING: No test runner configured. Edit this script for your stack." >&2
exit 0
```

7. Output a summary:
```
Initialised platform scripts for <stack>:
  scripts/test-changed.sh  — incremental suite
  scripts/test-all.sh      — full suite

Next: run /build <description> to start your first autonomous build.
```

Do not overwrite existing scripts without confirming with the user first.
