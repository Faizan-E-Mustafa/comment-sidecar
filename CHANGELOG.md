# Changelog

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
