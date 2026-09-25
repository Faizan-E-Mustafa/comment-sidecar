# Line Comments

Per-line comments stored next to code, not inside it.

```text
app.tsx          Source, never written by this tool.
app.tsx.comment  Comments attached to individual source lines.
```

In the editor:

```text
if (loading) return <Splash />;    ◌ comment
```

Hover the line to read its comments. The label and highlighting are decorations, not source characters. Comments attach to physical source lines: no symbol-level documentation system, Markdown replacement, generated essays, or AST dependency.

## Install

Build the VSIX (see below), then use **Extensions → … → Install from VSIX** and run **Developer: Reload Window**. From a shell:

```sh
code --install-extension ./dist/line-comments-0.2.0.vsix --force
```

Cursor uses its own VSIX installation action. This is an unsigned local package, not a Marketplace or Open VSX release.

Open the `examples` folder and hover lines 4 and 5 in `app.tsx`. The example is a type-checkable editor fixture, not an executable React application.

## Build and test

Use Node.js 18.17+ with npm. Packaging also needs Python 3.9+. No dependency installation, compiler, or network access is required.

```sh
npm test                 # Node tests, explicit file list (no shell glob dependency).
npm run test:aliases     # Repeat through an aliased temporary directory.
npm run check            # Syntax-check JavaScript.
npm run verify           # All three checks above.
npm run release          # verify, then build and cross-check dist/*.vsix, dist/*-source.zip, dist/SHA256SUMS.
npm run package          # VSIX only, without running tests first.
npm run benchmark        # Synthetic measurements in reports/.
npm run clean            # Preview generated-file cleanup; deletes nothing.
npm run clean -- --apply # Delete only recognized generated artifacts.
```

The release check verifies source/runtime byte equality, local runtime imports, manifest versions, archive integrity, and that the VSIX contains no tests, scripts, examples, or stale runtime files. For extension development, open this folder in VS Code and use the supplied F5 launch configuration.

## Marker and highlight settings

Defaults:

```json
{
  "lineComments.showMarkers": true,
  "lineComments.markerStyle": "label",
  "lineComments.highlightStyle": "line",
  "lineComments.showHoverMetadata": false
}
```

| Setting | Choices |
| --- | --- |
| `markerStyle` | `label`: `◌ comment`; `icon`: `◌`; `off`: no marker. |
| `showMarkers` | `false` hides any marker style. |
| `highlightStyle` | `line`: subtle tint/left edge; `underline`; `off`. |
| `showHoverMetadata` | `false`: comment text and necessary warnings; `true`: IDs, attachment status and reason. |

Needs-review annotations keep the circle and append `!`: `◌ comment !` or `◌ !`, with the warning highlight. Missing or ambiguous targets get no marker at an obsolete line. Multiple notes on one line share one marker. The hover starts with **Comment on line N** (or **2 comments on line N**) because the card can cover the line above; each note body then appears once.

The extension contributes one hover provider and no decoration hover. It does not suppress diagnostics or other extensions' hovers. Highlight colors use the `lineComments.highlightBackground`, `highlightBorder`, `reviewBackground`, and `reviewBorder` theme tokens. Defaults are declared once in `package.json` and read by `src/extension/settings.js`; CLI and MCP versions also come from `package.json`.

## Write and maintain comments

Place the cursor on a saved source line and run **Line Comments: Add Comment at Line** (`Cmd+Alt+;` on macOS). A plain-text draft opens alongside the source. Write the comment and save: only the sibling `.comment` changes.

Save the source and any existing sidecar before creating or editing a note. A draft based on stale source or sidecar revisions fails rather than overwriting newer changes. Keep compiler/linter directives, licenses, and other machine-significant comments in source.

The command palette also provides **Edit Comment**, **Delete Comment**, **Mark Comment Reviewed**, **Reattach Comment to This Line**, **List File Comments**, **Open .comment Patch**, **Open Annotated Preview**, **Copy Annotated Selection**, and **Check Workspace**.

Line tracking uses editor edit ranges and source fingerprints, not symbol names. Insertions above a target move its annotation. Changed targets require review; deleted, split, or ambiguous targets need explicit reattachment. Checks establish attachment status, **not the truth of a comment**.

Editor file renames move the sibling sidecar without overwriting an existing destination. External renames and cross-file moves are not reconciled; inspect the checker output.

## Sidecar format

Per-line hunks with readable comment bodies and generated target/context fingerprints; source text is never copied into the sidecar. A sidecar that cannot be parsed is reported as an error and is never treated as empty or overwritten. **Do not run `git apply` on a `.comment` file.** See [FORMAT.md](FORMAT.md).

## Agents: CLI or optional local MCP

The extension does not intercept an agent's native file reader. Choose a tool/rule integration and verify the agent actually uses it.

```sh
node src/cli.js --version
node src/cli.js read examples/app.tsx --start 1 --end 8
node src/cli.js read examples/app.tsx --start 1 --end 8 --mode comments
node src/cli.js check examples/app.tsx
```

For another repository, pass `--root /absolute/path/to/repository` and a source path relative to it. `read` combines source and comments with real line numbers and returns source/sidecar revision hashes. `--mode comments` avoids resending known source. `--comment-budget N` bounds comment-body characters and reports omissions; it is not a tokenizer.

Writes require both hashes from a fresh read; `add`/`reanchor` also require the exact target line text. The CLI computes all sidecar metadata. Run `node src/cli.js --help` for write commands and `--text-file`.

In the editor, **Line Comments: Copy Agent Instructions** copies rules to merge into one instruction file (AGENTS.md or a Cursor rule). **Line Comments: Copy Cursor MCP Configuration** copies a read-only or sidecar-write server entry for `.cursor/mcp.json`. The tools are `line_comments_read`, `line_comments_check`, and (with `--allow-write`) `line_comments_write`. A VS Code MCP example is in `integration/`. Copied configurations contain absolute paths to this installation; copy them again after moving or reinstalling.

Neither route guarantees that an agent follows the instructions, and agent use does not imply inline-completion integration.

## Tokens and performance

Hovers make no model requests. Agents pay for returned comment text, tool definitions, and instructions. Combined reads avoid sending the source twice; comments-only reads avoid resending source already in context. No percentage saving is claimed.

Unchanged revisions skip the relocation index, relocation builds its line-hash index lazily, hover reads a cached per-line map, the editor reuses the service's resolved snapshot when the buffer matches disk, and files without annotations skip edit-history hashing. See TESTING.md for the benchmark and its limits.

## Project map

```text
src/core/          Note model, sidecar parser/serializer, fingerprints, matching, edit tracking, agent rendering.
src/extension/     VS Code integration, settings, highlights, hovers, drafts, cache.
src/node/          Workspace/filesystem constraints and guarded sidecar writes.
src/cli.js         Command-line interface.
src/mcp.js         Optional local stdio tool server.
integration/       Agent instructions and client configuration examples.
media/             Sidecar syntax grammar.
examples/          Editor fixture.
test/              Automated tests and golden fixtures.
scripts/           Test runners, packaging, benchmarks, generated-file cleanup.
dist/, reports/    Generated output; ignored.
```

`.comment` files, including detached notes, are user data, not cache. Cleanup never deletes them, source, `.git`, arbitrary documents, or active sidecar locks.

## Limitations

Editor tests use a **mocked VS Code API**; real VS Code/Cursor rendering, macOS/Windows extension hosts, agent adoption, token accounting, and hostile-process filesystem races are not certified. Files are limited to 2 MiB of UTF-8 text; generated/dependency directories are excluded. Revision guards protect against cooperating writers, not a malicious local process.

See [TESTING.md](TESTING.md), [SECURITY.md](SECURITY.md), [ROADMAP.md](ROADMAP.md), and [REFERENCES.md](REFERENCES.md).
