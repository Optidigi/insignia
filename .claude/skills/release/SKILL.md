---
name: release
description: "Release preparation and publishing procedure. Loaded by /release. Enforces a clean-test-version-build-tag-publish-verify sequence."
---

## Pre-release gates

All of the following must be true before a release proceeds:

- [ ] Full test suite passes (`scripts/test-all.sh` exit 0)
- [ ] Linter passes with zero errors
- [ ] No uncommitted changes in the working directory
- [ ] All open BLOCKERs from the last review have been resolved
- [ ] `CHANGELOG.md` (or equivalent) is updated

If any gate fails, abort and report. Do not release on a broken state.

## Versioning

Follow semantic versioning (semver): `MAJOR.MINOR.PATCH`

| Bump | When |
|---|---|
| `patch` | Bug fixes, documentation, dependency updates — no new behaviour |
| `minor` | New features that are backwards-compatible |
| `major` | Breaking changes to public API or behaviour |

Update version in all relevant files:
- `package.json` → `"version"` field
- `pyproject.toml` → `[tool.poetry] version`
- `Cargo.toml` → `version`
- `VERSION` file if present
- Any `__version__` string in source

## Changelog format

```markdown
## [1.2.3] — YYYY-MM-DD

### Added
- Feature X for use case Y (#PR)

### Fixed
- Bug Z that caused W under condition V (#PR)

### Changed
- Behaviour of A now does B instead of C

### Breaking
- Removed deprecated endpoint /foo — use /bar instead
```

## Stack-specific publish steps

### npm / Node
```bash
npm run build
npm publish --access public  # or: npm publish (private)
```

### Python / PyPI
```bash
python -m build
twine upload dist/*
```

### Docker
```bash
docker build -t org/image:$VERSION -t org/image:latest .
docker push org/image:$VERSION
docker push org/image:latest
```

### Rust / crates.io
```bash
cargo publish
```

## Tag and push

```bash
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin main --tags
```

## Post-deploy verification

After deploying:
1. Monitor error rates and latency for 10 minutes.
2. Verify the health endpoint returns 200.
3. Spot-check one critical user flow manually or via smoke test.
4. If anything is anomalous within 10 minutes, rollback immediately.
   Do not wait to "see if it stabilises."
