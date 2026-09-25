# Before a public 1.0 release

## Desktop validation
Run real VS Code and Cursor extension-host tests on macOS, Windows and Linux. Validate virtual comment editor saving, filesystem notifications, undo/redo across saves, source renames, multi-root workspaces, remote extension hosts, large files, rapid edits, conflicts and focus behavior. Add a maintained VS Code test runner and CI once package downloads and desktop binaries are available. This build's editor API tests use mocks.

## Reliability
Expand property/fuzz coverage for pathological edits and repeated source fragments. Improve branch-switch behavior with optional Git base retrieval and explicit migration records, without silently guessing semantic identity. Add cross-file move assistance with confirmation, persistent review history, conflict UI instead of output-only auto-save failures, versioned format migrations, and better multi-editor concurrency tests.

## Agent adoption
Run the same edit tasks with different agent clients and models. Measure whether the agent chooses the context reader, whether it preserves constraints, token usage, stale-comment detection and task success. Native file reads remain untouched in this build. A future client-specific hook must be based on that client's supported API; do not claim universal interception. A custom agent harness can enforce one combined read path.

## Packaging and maintenance
Convert implementation to strict TypeScript if desired, add declaration/lint checking and a supported MCP SDK when introducing more protocol features. The present runtime is dependency-free CommonJS. Add signed release tooling, registered publisher identity, Marketplace/Open VSX distribution, upgrade-safe MCP registration and monitored compatibility matrices after desktop validation.

## Deliberately not the product
No Markdown knowledge base in place of line comments. No symbol-only anchoring. No generated paragraph on every line. No model calls for hover. No runtime/source transformation. No line-remapping hidden behind a "high confidence" semantic promise.
