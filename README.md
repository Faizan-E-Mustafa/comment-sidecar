# Line Comments

Per-line comments stored next to code, not inside it. **Consolidated release 0.1.4.**

```text
app.tsx          Source, never written by this tool.
app.tsx.comment  Comments attached to individual source lines.
```

In the editor:

```text
if (loading) return <Splash />;    ◌ comment
```

Hover the line to read its comments. The label and highlighting are decorations, not source characters. This is the original line/diff-based model: no symbol-level documentation system, Markdown replacement, generated essays, or AST dependency.

## Start with the complete release

Extract `line-comments-0.1.4-source.zip` into a **new directory**. It creates `line-comments-0.1.4/`. Do not apply any older patch, copy isolated modules, or extract over your partly patched folder. Keep the old directory until you have recovered any independent edits or sidecars you need.

The accompanying `line-comments-0.1.4.vsix` is built from this same source. Install it using **Extensions → … → Install from VSIX**, then run **Developer: Reload Window**. The existing extension ID is retained: `line-comments-local.line-comments`. Existing user/workspace settings remain in effect.

In VS Code, the shell installation equivalent is:

```sh
code --install-extension ./line-comments-0.1.4.vsix --force
```

Cursor is a separate desktop validation target. Use its VSIX installation action. This is an unsigned local package, not a published Marketplace or Open VSX release.

Open this release's `examples` folder and hover lines 4 and 5 in `app.tsx`. The example is a type-checkable editor fixture, not an executable React application.

## Build from source

Use Node.js 18.17+ with npm. Packaging also needs Python 3.9+. No dependency installation, compiler, or network access is required for the supplied build scripts.

```sh
cd line-comments-0.1.4
npm run release
```

That runs the regular test suite, the directory-alias regression suite, and JavaScript syntax checks. It then creates and cross-checks:

```text
dist/line-comments-0.1.4.vsix
dist/line-comments-0.1.4-source.zip
dist/SHA256SUMS
```

Source/runtime file equality, local runtime imports, manifest versions, and archive integrity are checked. Neither archive contains old patches or nested release artifacts. The source includes tests; the installed VSIX excludes development tests/scripts/examples.

Other commands:

```sh
npm test                 # Node tests, explicit file list (no shell glob dependency).
npm run test:aliases     # Repeat through an aliased temporary directory.
npm run check            # Syntax-check JavaScript.
npm run verify           # All three checks above.
npm run package          # VSIX only, without running tests first.
npm run benchmark        # Synthetic measurements in reports/.
npm run clean            # Preview generated-file cleanup; deletes nothing.
npm run clean -- --apply # Delete only recognized generated-artifact categories.
```

For extension development, open this source folder in VS Code and run the supplied F5 launch configuration. The runtime stays JavaScript/Node.js; Python is only build tooling. No Rust or native binary is involved.

## Marker and highlight settings

These are the default settings. Set them explicitly to undo older settings that disabled markers:

```json
{
  "lineComments.showMarkers": true,
  "lineComments.markerStyle": "label",
  "lineComments.highlightStyle": "line",
  "lineComments.showHoverMetadata": false
}
```

| Setting | Choices |
|---|---|
| `markerStyle` | `label`: `◌ comment`; `icon`: `◌`; `off`: no marker. |
| `showMarkers` | Legacy visibility switch. `false` hides any marker style. |
| `highlightStyle` | `line`: subtle tint/left edge; `underline`; `off`. |
| `showHoverMetadata` | `false`: comment text and necessary warnings; `true`: IDs, attachment status and reason. |

Needs-review annotations retain the circle and append `!`: `◌ comment !` or `◌ !`. They use the warning highlight. Missing/ambiguous targets do not receive a marker at an obsolete line. Multiple notes on one line share one marker; each note body appears once in our hover contribution.

The extension contributes one hover provider, with no duplicate decoration hover. It does not suppress TypeScript errors or another extension's hover cards. Highlight colors use `lineComments.highlightBackground`, `highlightBorder`, `reviewBackground`, and `reviewBorder` theme tokens.

Defaults are declared in `package.json`; `src/extension/settings.js` reads those definitions rather than duplicating defaults. CLI and MCP versions also come from `package.json`.

## Write and maintain comments

Place the cursor on a saved source line and run **Line Comments: Add Comment at Line** (`Cmd+Alt+;` on macOS). A plain-text draft opens alongside the source. Write the comment and save: only the sibling `.comment` changes.

Save the source and any existing sidecar before creating/editing a note. A draft based on stale source or sidecar revisions fails rather than overwriting newer changes. The tool writes explanatory comments only; compiler/linter directives, licenses, and other machine-significant comments remain in source.

The command palette also provides **Edit Comment**, **Delete Comment**, **Mark Comment Reviewed**, **Reattach Comment to This Line**, **List File Comments**, **Open .comment Patch**, **Open Annotated Preview**, **Copy Annotated Selection**, and **Check Workspace**.

Source-line tracking is based on editor edit ranges and source context/fingerprints, not symbol names. Normal insertions above a target move its annotation. Changed targets require review; deleted, split, or ambiguous targets may need explicit reattachment. Checks establish attachment status, **not the truth of a comment**. A comment can become wrong when requirements or dependencies change even if its source line stays identical.

Editor file renames include sibling-sidecar rename edits without overwriting an existing destination. External renames and cross-file moves are not magically reconciled; inspect the checker output. Old-format conversion is explicit and never performed on startup.

## Sidecar formats

**New files use format 2:** per-line hunks, readable comment bodies, and generated target/context fingerprints. Source text is not copied into the sidecar automatically.

**Existing format 1 files remain supported:** they hold copied source context around the comment. To convert, back up the sidecar, open its saved source, and run **Line Comments: Remove Copied Code from .comment**. Confirmation and fresh revision checks are required. This release introduces no third format.

Both are custom comment-only formats. **Do not run `git apply` on a `.comment` file.** They are not source patches and are not Markdown documentation. See [FORMAT.md](FORMAT.md).

## Agents: CLI or optional local MCP

The extension does not intercept another agent's native reader. Installing it alone does not make an agent receive hover comments. Choose a tool/rule integration and verify that the agent actually uses it.

For the CLI, run from this source folder:

```sh
node src/cli.js --version
node src/cli.js read examples/app.tsx --start 1 --end 8
node src/cli.js read examples/app.tsx --start 1 --end 8 --mode comments
node src/cli.js check examples/app.tsx
```

For a different repository, supply `--root /absolute/path/to/repository` and a source path relative to that root. `read` combines requested source and comments, preserving real source line numbers and returning source/sidecar revision hashes. `--mode comments` avoids resending known source. `--comment-budget N` bounds comment-body characters and explicitly reports omissions; it is not a tokenizer.

Agent writes require both hashes from a fresh read. `add`/`reanchor` also require the exact target line text. The CLI constructs patch metadata; the agent does not need to calculate hashes or hunk offsets itself. Run `node src/cli.js --help` for the write commands and `--text-file` support.

In the editor, run **Line Comments: Copy Agent Instructions** and merge the result into one supported rule file. Do not install duplicate copies into multiple instruction routes. The rules explain how to use comments; they are not the comments themselves.

For Cursor Agent, run **Line Comments: Copy Cursor MCP Configuration** with a source file in the target workspace active. Choose read-only or sidecar-write access and merge the copied entry into `.cursor/mcp.json`. The tools are `line_comments_read`, `line_comments_check`, and (when enabled) `line_comments_write`. A VS Code MCP example is also provided in `integration/`.

**After upgrading:** a copied MCP/CLI configuration may still reference an old extension/source path. Copy it again from the new installation, update the existing entry, and restart that MCP server. Installing the VSIX does not rewrite agent configurations. Read-only is the server default; standalone writable use requires `--allow-write`.

The CLI/rule route does not require MCP. Neither route guarantees that third-party agents will follow the instructions, and success with an agent does not imply inline-completion integration.

## Token and performance boundaries

Editor hovers make no model requests and therefore use no model tokens from this extension. Agents still pay for returned comment text, tool definitions, instructions and invocation wrappers. Combined reads avoid sending the source twice; comments-only reads avoid resending source already in context. There is no promised percentage saving.

The inherited performance improvements remain: lazy full fingerprint indexing, direct cached per-line hover lookup, resolved-snapshot reuse, and no edit-history hashing for files without annotations. No new comparative speedup is claimed for 0.1.4. [PERFORMANCE.md](PERFORMANCE.md) preserves the earlier synthetic benchmark methodology and its limitations.

## Project map

```text
src/core/          Formats, line fingerprints, matching, edit tracking, agent rendering.
src/extension/     VS Code integration, settings, highlights, hovers, drafts, cache.
src/node/          Workspace/filesystem constraints and guarded sidecar writes.
src/cli.js         Command-line interface.
src/mcp.js         Optional local stdio tool server.
integration/       Agent instructions and client configuration examples.
media/             Sidecar syntax grammar.
examples/          Editor fixture.
test/              Automated regression tests.
scripts/           Verification, packaging, benchmarks, generated-file cleanup.
dist/              Generated releases; ignored.
reports/           Generated test/benchmark output; ignored.
```

Keep both format implementations and the tests. `.comment` files, including detached notes, are user data—not disposable cache files. Cleanup does not delete them, source, `.git`, arbitrary documents, or active sidecar locks.

## Validation and limitations

The regular and aliased-path Node suites exercise real core/filesystem/CLI/MCP code; editor tests use a **mocked VS Code API**. The source and VSIX are cross-checked, and the release can rebuild from its own source ZIP without old patch files.

Real VS Code/Cursor desktop rendering, macOS/Windows extension hosts, third-party agent adoption, actual model-token accounting, and hostile-process filesystem races are not certified by those tests. Files are limited to 2 MiB and UTF-8 text; generated/dependency directories are excluded. Dirty-file guards and revision checks protect against ordinary cooperating writers, not an actively malicious local process.

See [TESTING.md](TESTING.md) for smoke tests and [SECURITY.md](SECURITY.md) for the trust boundaries. Official API references are in [REFERENCES.md](REFERENCES.md).
