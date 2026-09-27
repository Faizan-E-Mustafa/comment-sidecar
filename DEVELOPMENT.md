# Development

Plain JavaScript (CommonJS) on Node.js. No npm dependencies, no build step, no compiler.
Python 3 (standard library only) packages the VSIX.

## Requirements

- Node.js 18.17 or newer, with npm.
- Python 3.9 or newer, for packaging only.
- No network access or `npm install` needed.

## Commands

```sh
npm test                 # All tests.
npm run test:aliases     # All tests again, with the temp directory behind a symlink.
npm run check            # Syntax-check every JavaScript file.
npm run verify           # The three commands above.
npm run release          # verify, then build and cross-check dist/*.vsix and dist/*-source.zip.
npm run package          # Build the VSIX only, without tests.
npm run benchmark        # Synthetic timings, written to reports/BENCHMARK.json.
npm run clean            # List generated files that clean would delete. Deletes nothing.
npm run clean -- --apply # Delete only those generated files.
```

Run `npm run verify` before calling a change done. Run `npm run release` when packaging changes.

To debug the extension, open this folder in VS Code and press F5.

## Code layout

```text
src/core/        Pure logic. No filesystem, no VS Code.
  note.js          Create and validate a comment ("note"); size limits.
  format.js        Parse and write the .comment file.
  fingerprints.js  Hash a line and its neighbors.
  anchors.js       Find where each note belongs in the current source.
  edits.js         Move notes through live editor edits.
  render.js        Text output for agents (source + comments).
  text.js          Line splitting, hashing, newline handling.
src/node/        Filesystem access.
  workspace.js     Path safety, size limits, locking, atomic writes, sidecar search.
  service.js       Load, read, write and check: the operations the CLI, MCP and editor call.
src/extension/   VS Code integration.
  extension.js     Activation, presentation refresh, event wiring.
  commands.js      Command Palette commands.
  store.js         Per-document cache and live edit tracking.
  presentation.js  Markers, hover content, diagnostics, sidecar dimming.
  highlights.js    Line highlight decorations.
  drafts.js        The draft editor for writing a comment.
  documents.js     Open-document lookup and sidecar renames.
  settings.js      Reads settings, using defaults from package.json.
src/cli.js       The `lc` command.
src/mcp.js       The optional MCP server (stdio).
integration/     Agent instructions and MCP config examples.
media/           Syntax highlighting for .comment files; the extension icon and README images.
examples/        A small annotated file to try the extension on.
test/            Tests; test/fixtures holds a golden .comment file.
scripts/         Test runners, packaging, benchmark, cleanup.
dist/, reports/  Generated. Ignored by Git.
```

Dependencies point one way: `extension` and the CLI/MCP call `node/service.js`; `service.js` calls `core`. `core` never touches the filesystem or VS Code.

## Rules that must stay true

Each rule has tests. Keep them passing.

- **Source files are never written.** Only `<source>.comment` changes.
- **Writes need fresh revisions.** Every write passes the source hash and sidecar hash from a recent read. `add` and `reanchor` also pass the exact target line text. Stale input fails.
- **Writes are serialized and atomic.** `withLock` takes `<source>.comment.lock`; `atomicWrite` re-checks the sidecar hash and renames a temp file into place.
- **Unreadable sidecars are never overwritten.** A parse error stops every operation. It is never treated as "no comments".
- **Only three states are saved:** `attached`, `review`, `detached`. `moved` and `ambiguous` are computed on read.
- **No guessing.** Several matching lines give `ambiguous`; the resolver never picks the nearest one.
- **Paths stay inside the workspace.** Symlinked files and links that leave the workspace are rejected. Directory aliases (such as macOS `/var` → `/private/var`) are allowed.
- **Comment text is untrusted.** Hovers use plain text with HTML and commands disabled. Agent output labels comments as data.
- **Settings defaults live in `package.json`.** `settings.js` reads them; do not repeat them in code.

## Code style

- One statement per line. Braced, multi-line `if`, loops and `try`. No nested ternaries.
- Name real decisions (`editDetachesLine`, `isValidEdit`). Do not add wrappers just to shorten code.
- Comments explain a non-obvious reason. Do not narrate the code.
- No new dependencies without a strong reason.

## Tests

`npm test` runs every `test/*.test.js` file with `node --test`.

| File | Covers |
| --- | --- |
| `format.test.js` | The file format: round trips, golden fixture, limits, malformed and unsupported files, service writes. |
| `core.test.js` | Matching (moved, review, ambiguous, detached), live edit tracking, agent rendering. |
| `service.test.js` | Filesystem safety, revision guards, concurrent writers, CLI and MCP in real subprocesses. |
| `extension.test.js` | Extension code against a **mocked** VS Code API, with a real temp filesystem. |
| `configuration.test.js` | Settings defaults, version consistency, Explorer nesting defaults. |
| `performance.test.js` | Fast paths keep exact results; the cleanup script only deletes generated files. |

`npm run test:aliases` repeats everything with `TMPDIR` behind a directory symlink, to catch path-alias bugs. It is not a macOS desktop test.

What the tests do **not** prove: real VS Code or Cursor rendering, Windows or macOS extension hosts, whether agents follow the instructions, token savings, or safety against a hostile local process.

## Manual check in a real editor

1. Install the VSIX, reload, open `examples/`. Lines 4 and 5 show `◌ comment` and a tint. The hover says **Comment on line N** and shows each note once. The `.comment` file is dimmed and nested under `app.tsx`.
2. Try `markerStyle` `icon` / `off` / `label`, `showMarkers: false`, `highlightStyle` `underline` / `off`, and `showHoverMetadata: true`. Other hovers (TypeScript, other extensions) still appear.
3. Add, edit and delete a multi-line comment. The source file does not change.
4. Insert lines above a comment, edit its line, delete its line, undo, save, reopen. Expect moved, review, detached, then back.
5. Change the first line of a `.comment` file to `# line-comments v1`. Expect an error in the **Line Comments** output, no markers, and the file unchanged after saving the source.
6. With the source or sidecar unsaved, try to save a draft. It fails without overwriting.
7. Rename a source file in the Explorer. Its `.comment` file follows.
8. Point an agent at the CLI or MCP server and check it reads comments with the source.

## Release

`npm run release` builds `dist/comment-sidecar-<version>.vsix`, `dist/comment-sidecar-<version>-source.zip` and `dist/SHA256SUMS`, then checks:

- both archives pass ZIP integrity checks;
- the source ZIP matches the working tree byte for byte;
- every runtime file in the VSIX matches the source, and every local `require()` resolves;
- the VSIX has no tests, scripts, examples, reports or stale runtime files;
- the VSIX manifest version matches `package.json`.

Rebuilding from an extracted source ZIP produces identical archives.

## Benchmarks

`npm run benchmark` times note creation, parsing, writing, matching, live edit tracking, hover lookup and rendering on 1,000- and 10,000-line files. Results go to `reports/BENCHMARK.json`.

`npm run benchmark -- --baseline /path/to/other/checkout` also times another checkout of this code in the same run.

These are single-process micro-benchmarks, not editor latency. Compare only runs from the same machine.

Known cost: creating a note splits the whole file, so saving many comments in a large file is O(notes × lines).

## References

- VS Code language features, hover and diagnostics: https://code.visualstudio.com/api/language-extensions/programmatic-language-features
- VS Code API at the minimum supported version (1.85): https://raw.githubusercontent.com/microsoft/vscode/1.85.0/src/vscode-dts/vscode.d.ts
- Decorations and hover providers: https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions
- Contributed colors and configuration defaults: https://code.visualstudio.com/api/references/contribution-points
- Workspace trust: https://code.visualstudio.com/api/extension-guides/workspace-trust
- VSIX packaging: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Cursor extensions, rules and MCP: https://cursor.com/help/customization/extensions, https://cursor.com/docs/rules, https://cursor.com/docs/mcp
- MCP stdio transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
