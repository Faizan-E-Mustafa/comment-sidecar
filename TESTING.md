# Validation status

## Executed in the build environment

66 automated tests pass using Node's built-in test runner on Linux, Node v22.16.0, both normally and with the temporary directory routed through a symlink. See TEST-RESULTS.txt and TEST-RESULTS-ALIASES.txt; rerun `npm test` and `npm run test:aliases`. JavaScript syntax validation uses `node --check`; the separate example check uses `tsc --noEmit -p examples`.

Core coverage: strict independent-hunk parsing/serialization, multiline text, Unicode, CRLF, invalid source additions/deletions, malformed metadata, duplicate IDs, oversized input, empty/last lines, duplicate line ambiguity, uniquely moved windows, provisional attachments, persistent deletion, live UTF-16 edit offsets, multicursor shifts, output line numbering, comments-only mode, explicit character-budget truncation, and a 100-case deterministic insertion loop.

Filesystem/service coverage: create/update/remove, exact target and revision guards, concurrent cooperating writers, stale writes, orphaned sidecars, explicit reattachment, root traversal, source/sidecar symlinks, escaping directory symlinks, binary input, excluded directories and malformed-sidecar preservation. Source bytes are checked unchanged after comment operations.

CLI tests spawn a real Node subprocess against temporary repositories. MCP tests cover protocol handler initialization, discovery, read-only mode, schema validation, actual sidecar writes and a real stdio subprocess exchange. Stdout is checked to contain only protocol messages. These are not tests against the Cursor or VS Code MCP client.

Editor tests load the actual extension code against a **mocked VS Code API** with a real filesystem. They cover command/provider registration, multiline draft persistence, untrusted hover text, live movement and source-save rebasing, recent undo restoration, trust/dirty-source guards, stale draft rejection, and sibling rename edits. Additional regression tests cover quiet hover defaults, optional metadata, review warnings, removal of duplicate decoration hovers, aliased workspace/source paths, canonical watcher invalidation and dirty-source/sidecar protection through aliases. They are not Electron/desktop extension-host tests.

The original 0.1.0 suite passed 55/55 in the normal Linux environment. Running its eight editor tests with an aliased TMPDIR reproduced the exact five reported failures (four workspace-containment errors and the missed dirty-source rejection). The production path resolution and editor-document identity checks were fixed; tests were not skipped and workspace protections were not removed. `REGRESSION-REPRODUCTION.txt` records the original failing run. This reproduces the failure mechanism on Linux, not a macOS desktop test.

BENCHMARK.json records warm core-function microbenchmarks for 1000 lines/20 notes and 10,000 lines/200 notes. They are not UI latency, cold start, monorepo watcher, memory-pressure, or model-token measurements. The recorded timestamp comes from the execution environment's clock. Re-run `npm run benchmark` on your own machine for a comparable local baseline.

The local VSIX archive is checked for ZIP integrity, parseable manifest XML, and the declared extension entry point. Installation/signature/marketplace checks were not run by a real desktop client.

## Not executed here

Real VS Code/Cursor desktop launch, macOS/Windows tests, enterprise signed-extension policy tests, live Cursor agent adoption, VS Code MCP client adoption, real model-token accounting, package publication, stress/fuzz testing, remote filesystem-provider integration and hostile-process filesystem race testing.

## Desktop smoke test

1. Install the local VSIX and open examples/app.tsx. Use the new examples folder with fixture.d.ts and tsconfig.json. Hover lines 4 and 5: each comment should appear once, without an attachment heading, ID, revision sentence or inline label. Verify no source characters were inserted. Enable showMarkers to check dot-only indicators. Real language errors still appear in native hovers.
2. Add a multiline comment at a chosen line, save its side editor, and inspect the generated sibling patch. Edit/delete it through commands.
3. Insert lines above an annotation, save source, and verify both hover and the sidecar move. Modify the target and verify review; delete/split it and verify detachment. Reattach explicitly and mark reviewed only after checking meaning.
4. Exercise undo/redo, save/reload and branch switches. Rename a source through Explorer and check its sibling; repeat an external rename and confirm orphan detection.
5. Open a dirty sidecar and edit the source; verify auto-sync refuses to overwrite it and explains the problem in Output. Test concurrent CLI writes while editing a note draft.
6. In Cursor, configure the local MCP server and one rule, start a fresh Agent conversation and ask it to inspect a specific region. Verify it calls the combined reader, preserves real line numbers, follows documented constraints and checks notes after edits. Do not infer Tab/inline-edit support from Agent success.
7. Repeat with a large source file and multiple workspace roots, and inspect extension-host CPU/memory. Confirm source compilation is unchanged and sidecars are excluded from production asset copying.
