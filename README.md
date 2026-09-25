# Line Comments · 0.1.1

Per-line explanatory comments stored in sibling `.comment` patches, projected onto the original code in VS Code. Includes a CLI and optional local MCP server for agents.

**A runnable prototype, not a production certification.** Core, filesystem, CLI, MCP and mocked editor tests are included. It has not been launched inside a real VS Code or Cursor desktop in the build environment. Cursor agent behavior and desktop interaction need a smoke test on your machine.

```text
src/app.tsx          implementation, unchanged by this tool
src/app.tsx.comment  independent, line-anchored comment-only hunks
```

No cloud service, API key, model calls, build transformation, external runtime packages, embeddings, or AST service. UTF-8 text is supported independently of programming language. Machine-significant comments stay in source.

## Try the extension

Install the supplied `line-comments-0.1.1.vsix` through **Extensions → … → Install from VSIX**. In VS Code, the shell equivalent is:

```sh
code --install-extension line-comments-0.1.1.vsix
```

In Cursor, use its Install from VSIX command where available. This extension uses the stable VS Code API with engine floor 1.85, but Cursor is a separate test target. Enterprise policy may prevent unsigned local VSIX installation. This is an unsigned local package; no Marketplace or Open VSX release has been published.

Open the `examples` folder and `app.tsx`. Hover lines 4 and 5. The example now includes `fixture.d.ts` and a local `tsconfig.json` using JSX preserve mode. It type-checks without React dependencies; it remains an editor fixture, not an executable React application. Use the **new examples folder**, since installing a VSIX does not update a previously extracted workspace.

To run from source instead of installing the package, open this repository in VS Code and use the included **Run Line Comments Extension** launch configuration (F5). No dependency installation or build step is required.

### Authoring

Place the cursor on a saved source line. Run **Line Comments: Add Comment at Line** (macOS: `Cmd+Alt+;`, Windows/Linux: `Ctrl+Alt+;`). A plain-text comment editor opens beside the source. Write a single-line or multiline explanation and save. Only `<source>.comment` is written. Return to the source and hover the annotated line.

The source and existing sidecar must be saved before creating or editing a note. If either changes while the comment draft is open, a conflicting draft save is rejected. Reopen the comment against the fresh source rather than overwriting somebody else's work. A new empty draft is not saved; type a nonempty comment before saving.

Commands also cover editing, deleting, listing, explicitly reviewing, reattaching to the current line, opening the raw patch, opening a read-only annotated preview, copying an annotated selection, checking the workspace, copying agent instructions, and copying Cursor MCP configuration.

Healthy comments show only their text on hover, once. Inline labels and normal-state status-bar counts are off by default. Review warnings remain visible; genuine language diagnostics are not disabled.

```json
{
  "lineComments.showMarkers": false,
  "lineComments.showHoverMetadata": false
}
```

`showMarkers: true` opts into a small dot (or `!` for review), not the old `comment` label. `showHoverMetadata: true` restores IDs, status and reasons for debugging. Do not turn off `editor.hover.enabled`: that disables comment hovers too.

### Updating from 0.1.0

Install the new VSIX over the existing extension and run **Developer: Reload Window**. Extract the new source archive into a separate folder for tests and the updated example. No `.comment` format migration is required. The update does not overwrite comments in existing workspaces.

The CLI/MCP still return revision guards for safe writes. Editor-only display settings do not alter the agent protocol or strip those guards.

### Movement and review

Precise editor changes track positions. An edited line becomes `review`. Deleted, split or joined targets are conservatively detached. On source save, tracked annotations are persisted to the sidecar; failed or conflicting automatic writes are logged in the **Line Comments** Output channel. Problems shows detached, ambiguous and review-needed notes. Unsaved sidecar edits prevent automatic rebasing.

For changes made outside the editor, exact target plus neighboring context can relocate uniquely. A unique matching target with changed context is only provisional (`review`). Duplicate matches are ambiguous; missing targets are detached. No proximity-based guessing is used.

Editor-originated file renames contribute the sibling rename to the same workspace edit without overwrite. External renames need the `.comment` sibling moved as well; `check` reports orphaned sidecars. Cross-file code moves and function splits require explicit reattachment. In-session undo can restore recent attachment snapshots (16 revisions); this is not an unlimited persistent undo ledger.

**`attached` describes positioning, not truth.** A comment can be semantically obsolete even when its line is unchanged. Tests and human review still matter.

## Agent CLI

Requires Node 18.17 or later. The extension uses the editor's Node runtime; only external CLI/MCP use needs Node installed on PATH. From this repository:

```sh
node src/cli.js read examples/app.tsx --start 1 --end 8
node src/cli.js read examples/app.tsx --start 4 --end 5 --mode comments
node src/cli.js check examples/app.tsx
```

Optionally install the local CLI command:

```sh
npm link
lc read examples/app.tsx --start 4 --end 5
```

Run from the target repository root, or pass `--root /absolute/repository` and a path within that root. No public npm package is assumed.

Reads provide `source` and `sidecar` revision hashes. To add a comment, copy both values from a fresh read:

```sh
lc add src/app.tsx \
  --line 4 \
  --expected-text '  if (loading) return <Splash />;' \
  --text 'Wait for session restoration before choosing a screen.' \
  --source-hash SOURCE_HASH_FROM_READ \
  --sidecar-hash SIDECAR_HASH_FROM_READ
```

Use `--text-file comment.txt` for multiline text. `lc --help` lists update, remove, reanchor, review and sync operations. `lc check` scans sidecars, returns JSON and exits 1 when attention is required; usage and execution errors exit 2. It does not verify business rules.

Reads default to 200 lines and allow at most 1000. A response reports the next range and notes outside the requested range. The default total comment-body budget is 12,000 characters; `--comment-budget` can set 0–64,000. Omitted content is marked explicitly. Narrow the range or raise the budget to obtain long comments in full. These are character limits, not claimed token counts.

## Cursor and other agents

The editor and the agent are separate consumers. Hover text is **not automatically injected into Cursor Agent, Tab, inline edits, or another agent's native file-read tool**.

For Cursor, run **Line Comments: Copy Cursor MCP Configuration** and merge the copied server entry into `.cursor/mcp.json`. Choose read-only mode first or explicitly allow sidecar writes. The command copies configuration only: it does not overwrite existing settings or install an MCP server in any account. Node must be available in the environment that starts the server. Copy the configuration again after an extension upgrade changes its installed path.

Alternatively use `integration/cursor-mcp.example.json`, replacing the absolute tool path. `integration/vscode-mcp.example.json` is a separate configuration example for VS Code clients with MCP support. Remove `--allow-write` to expose read and check only.

The stdio server exposes:

```text
line_comments_read   source + selected per-line notes; comments-only mode available
line_comments_check  attachment/review diagnostics
line_comments_write  optional sidecar writes with revision and target guards
```

The default server is read-only. The writable server cannot edit source through its defined tools. It is an intentionally small dependency-free MCP tools server, not a general MCP SDK implementation: no remote HTTP, OAuth, resources, prompts, progress streaming, or client sampling.

Then choose **one** instruction path: merge `integration/AGENTS.snippet.md` into an existing AGENTS.md, or copy `integration/cursor-rule.mdc` into `.cursor/rules/line-comments.mdc`. Do not install both duplicates solely for this extension. The copy-instructions command can generate the local absolute CLI invocation for clients without MCP.

Instruction files explain the read/write convention; the comments themselves remain per-line `.comment` patches. Client rules do not force every tool use. Test each agent's adoption; deterministic automatic inclusion requires control over its read pipeline or a supported client-specific integration. This build does not intercept native tools.

## Token behavior

Editor hover, parsing, line tracking and patch writes make zero model requests. An agent sees only the data its client sends to a model. A combined read replaces a source read rather than repeating it, and strips raw diff context and per-hunk hashes. Use comments-only mode when the code is already in context. Rule instructions, tool descriptions, hashes, note IDs, tool arguments and returned comment text still add input/output overhead.

External storage does not inherently compress comments. Compared with equally scoped inline comments, expect extra wrapper/integration overhead unless selective retrieval avoids irrelevant notes. Compared with code that has no comments, supplied notes necessarily add content. Total-task savings from fewer mistakes are a hypothesis to measure, not a guaranteed token reduction.

Benchmark task input/output tokens and task success against (a) no notes, (b) inline comments, (c) reading raw sidecars, and (d) combined reads. Use the same model, task, code range, note content and correctness criterion; account for repeated reads and each client's prompt caching/billing separately. No model-token benchmark was run here.

## Structure

```text
src/core/       patch format, resolution, editor edit mapping, range rendering
src/node/       bounded workspace file access, locks, revision-guarded writes
src/extension/  hover, drafts, commands, decorations, diagnostics and session store
src/cli.js      standalone terminal interface
src/mcp.js      local stdio agent adapter
integration/   setup instructions and optional client configuration
examples/      small source + sidecar fixture
test/          core, real filesystem/CLI/MCP and mocked editor tests
```

## Validation and packaging

```sh
npm test
npm run test:aliases
npm run check
npm run benchmark
npm run package
```

`npm run check` checks JavaScript syntax, not TypeScript types. This prototype is plain CommonJS JavaScript and has no transpilation step. Packaging uses the included Python 3 script and ZIP/XML standard libraries. The produced VSIX is a local unsigned archive. A publisher can instead use `vsce package` and publish under a registered publisher after desktop testing; the placeholder `line-comments-local` is not a claimed public publisher.

See FORMAT.md, SECURITY.md, TESTING.md, BENCHMARK.json and ROADMAP.md for exact scope and limitations. Keep `.comment` files in version control with source. Never run `git apply` on them: the v1 format uses independent extended diff-style hunks, not a general-purpose cumulative patch.

Exclude `.comment` files from public assets, broad copy/deployment rules and class-name scanning as needed. Keep compiler directives, linter controls, license headers and tool-significant documentation comments in source. No compiler or bundler is patched by this extension.
