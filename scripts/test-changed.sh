#!/bin/bash
# scripts/test-changed.sh
# Replace the body with your actual test runner command.
# This script should run tests only for files changed since the last commit.
#
# Jest example:
#   npx jest --passWithNoTests --findRelatedTests $(git diff --name-only HEAD) "$@"
#
# pytest example:
#   pytest $(git diff --name-only HEAD | grep '\.py$' | tr '\n' ' ') "$@"
#
# cargo example:
#   cargo test "$@"

echo "No test-changed.sh configured. Edit scripts/test-changed.sh for your stack." >&2
exit 1
