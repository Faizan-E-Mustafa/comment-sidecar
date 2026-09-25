# Changelog

## 0.1.3

- Restore `◌ comment` as the default marker. Add `markerStyle: label | icon | off`; icon-only uses `◌`. Retain `showMarkers` as a visibility override; existing false values are not silently overwritten. Review appends `!`; highlighting and single safe hover remain.
- Avoid building the full line-hash index for unchanged source revisions. Build relocation indexes lazily, retaining exact target checks and all ambiguity/review rules.
- Reuse resolved disk snapshots when editor text matches. Cache annotations by line for hover and marker grouping. Skip per-edit hashing and edit-history tracking in files with no annotations.
- Preserve SHA-256 revision semantics while avoiding split/join allocations solely to hash normalized source.
- Put generated VSIX files in `dist/` and benchmark output in `reports/`. Add preview-first cleanup of known generated artifacts only. Omit examples and development-only documentation from the VSIX, but keep them in source.
- Add 11 regression tests (106 total), reproducible baseline comparison, cleanup safety tests and explicit performance limitations. No new sidecar format, agent protocol, Rust dependency, or model calls.

## 0.1.2

- Add theme-aware blue line highlighting with a left edge, optional underline/off modes, and amber review highlighting. Deduplicate same-line notes and clear highlights for unresolved or unreadable sidecars. No decoration hover or source mutation.
- Add code-free v2 sidecars using target/context fingerprints; keep v1 read/write compatibility. New sidecars use v2. Explicit guarded conversion is available through the editor command and CLI `compact` operation.
- Keep per-note fingerprints out of agent reads. MCP tool schema stays the same; fresh external CLI/MCP processes are required to read v2.
- Add tests for v2 parsing, corruption/limits, movement/ambiguity/deletion/review, source preservation, legacy compatibility, migration guards, real CLI conversion and highlight behavior. Desktop rendering remains unverified in the build environment.


## 0.1.1

- Show a comment only through the hover provider; remove the duplicate decoration hover.
- Default to text-only hovers. Debug metadata is opt-in; review warnings remain visible.
- Disable inline markers by default. Opt-in markers use a dot, not a repeated label.
- Hide the status bar when all comments are attached without review issues.
- Resolve workspace-directory aliases consistently without permitting traversal, source/sidecar symlinks or directory symlink escapes.
- Match dirty source/sidecar documents by canonical filesystem path; invalidate the correct editor cache after aliased draft saves and watcher events.
- Provide example declarations and a local JSX-preserve config, without disabling type checking or adding a React runtime dependency.
- Add 11 regression tests and an aliased-TMPDIR full-suite runner (66 tests total).
- Keep the sidecar format and agent read/write protocol unchanged.

## 0.1.0

Initial local prototype with line-based sidecars, editor hovers and drafts, CLI and optional stdio MCP server. The original Linux run passed 55 tests; an aliased temporary directory subsequently exposed five editor test failures fixed in 0.1.1.
