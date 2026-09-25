# Verification

## Automated commands

```sh
npm test
npm run test:aliases
npm run check
```

`npm run verify` runs all three. `npm run release` verifies first, then builds a matching VSIX and complete source ZIP and validates their contents. Node.js with npm is sufficient for the JS tests. Python 3.9+ is required for packaging. The test command supplies filenames explicitly rather than relying on a shell glob.

## What the suites cover

Core: the v2 sidecar format, byte-identical golden fixtures written by 0.1.4, canonical fingerprint-only notes, explicit v1-header rejection, strict parsing, invalid patches, multiline/Unicode/CRLF handling, exact and moved contexts, ambiguity, review/detachment, live UTF-16 edits, multicursor changes, real source line numbering, comments-only output, and explicit comment-budget truncation.

Service/filesystem: source-preserving CRUD, source and sidecar revision guards, target-text checks, cooperating concurrent writers, malformed-sidecar preservation, workspace traversal and directory-alias protections, dirty documents, symlink exclusions, explicit reattachment, and byte-for-byte preservation of legacy and malformed sidecars across every write operation and the CLI.

CLI and MCP: real subprocess reads and writes, protocol initialization, tool discovery, read-only default, validation, stale requests, stdio output discipline, and version agreement with the extension manifest. These tests do not run a third-party agent client.

Editor: actual extension code loaded against a **mocked VS Code API**, using a real temporary filesystem. Coverage includes command registration matching the manifest, legacy-sidecar rejection without stale markers or rewrites, multiline drafts, hover escaping, live line tracking and undo, saved rebasing, file renames, aliased paths, theme decorations, no duplicate decoration hovers, labeled/icon/off markers, review indicators, and cached per-line lookups.

Consolidation regressions: manifest-derived defaults, preserved explicit `showMarkers:false`, invalid-value fallback, manifest/CLI/MCP version consistency, the original labeled circle default, no duplicate hover contribution, and one marker for multiple notes on a line.

The alias runner repeats the entire suite with TMPDIR/TEMP/TMP routed through a directory symlink. This reproduces macOS-style path alias conditions on Linux; it is **not** a macOS desktop test.

## Release verification

The release builder checks both ZIP CRCs; source archive completeness; the declared extension entry point; VSIX XML and package version agreement; byte equality of the source tree and its ZIP; byte equality of runtime/media/integration files between source and VSIX; local require() targets; and exclusion of tests, scripts, examples, dist and reports from the installed package. It emits `dist/SHA256SUMS`.

The current release was tested in the build environment with Node v22.23.1 on macOS (arm64). Recorded command output is in the accompanying validation artifacts, not embedded as historical logs in source. A fresh extraction and rebuild are checked separately so working-directory leftovers are not prerequisites.

## What these tests do not establish

They do not establish correct rendering inside a real VS Code/Cursor desktop, macOS/Windows behavior, enterprise signature acceptance, monorepo responsiveness, semantic correctness of annotations, automatic use by agents, actual token savings, hostile-process filesystem safety, or Marketplace publication. No desktop launch is claimed.

## Desktop smoke checklist

1. Install the VSIX and reload the editor. Open the new examples folder. Confirm lines 4/5 show `◌ comment`, subtle tint/left edge, and one copy of each note in hover. Source bytes must not change.
2. Set `markerStyle` to `icon`, then `off`, then `label`. Check `showMarkers:false` hides only markers; restore it to true. Try `highlightStyle` line/underline/off and metadata opt-in. Native TypeScript and third-party hover content must not be suppressed.
3. Add/edit/delete a multiline comment through the side draft. New `.comment` files contain fingerprint metadata, not copied source. Put a copy of a v1 sidecar next to a source file: expect an unsupported-legacy error in the Line Comments output, no markers or hover, and an unchanged sidecar after saving the source.
4. Insert lines above the target, edit it, delete it, undo, save and reopen. Confirm movement/review/detachment as appropriate. Reattach only after identifying the intended line; mark reviewed only after checking the explanation.
5. Make the source or sidecar dirty and try to write a draft. Confirm that a conflicting or stale request fails without overwriting the files. Test source renames in Explorer and an external rename followed by a workspace check.
6. Configure the CLI or MCP path from this release, start a fresh agent conversation, and verify the actual tool call reads source with its comments. Re-check after edits. Agent success does not establish Tab/inline-completion integration.
7. Repeat with a larger file, multiple workspace roots, and branch changes; inspect actual extension-host CPU/memory. The included synthetic benchmarks are not UI responsiveness measurements.
