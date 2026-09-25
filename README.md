# Line Comments

Comments for individual source lines, stored next to the code instead of inside it.

```text
app.tsx          Your source file. This tool never writes to it.
app.tsx.comment  The comments, each attached to one line of app.tsx.
```

In the editor, an annotated line shows a small marker. Hover the line to read the comment.

```text
if (!user) return <Login />;    ◌ comment
```

## Install

1. Build the extension: `npm run release` (see [DEVELOPMENT.md](DEVELOPMENT.md)).
2. In VS Code: **Extensions → … → Install from VSIX**, pick `dist/line-comments-0.2.0.vsix`, then run **Developer: Reload Window**.
   From a shell: `code --install-extension ./dist/line-comments-0.2.0.vsix --force`.
3. Cursor has its own **Install from VSIX** action.

To try it, open the `examples` folder and hover lines 4 and 5 of `app.tsx`.

This is an unsigned local package. It is not published to the Marketplace or Open VSX.

## Use it

Put the cursor on a line of a **saved** file and run **Line Comments: Add Comment at Line** (`Cmd+Alt+;` on macOS, `Ctrl+Alt+;` elsewhere). A draft opens beside the source. Write the comment and save the draft. Only the `.comment` file changes.

Other commands (Command Palette, prefix **Line Comments:**):

| Command | What it does |
| --- | --- |
| Edit Comment | Opens the comment on the current line as a draft. |
| Delete Comment | Deletes it after confirmation. |
| Mark Comment Reviewed | Confirms a comment that needs review still fits its line. |
| Reattach Comment to This Line | Moves a lost or wrong comment to the current line. |
| List File Comments | Jumps to any comment in the file. |
| Open .comment Patch | Opens the raw sidecar file. |
| Open Annotated Preview | Shows the source with comments inline. |
| Copy Annotated Selection | Copies source plus comments, with line numbers. |
| Check Workspace | Reports comments that need attention. |
| Copy Agent Instructions / Copy Cursor MCP Configuration | See [Agents](#agents). |

Save the source file (and its `.comment` file, if open) before adding or editing. If either changed since the draft opened, the save fails instead of overwriting.

## How comments follow the code

Each comment remembers a fingerprint of its line and the two lines around it. No source text is copied into the `.comment` file.

| Status | Meaning | Shown as |
| --- | --- | --- |
| attached | The line is where it was. | `◌ comment` |
| moved | Lines were added or removed above it; it followed. | `◌ comment` |
| review | The line itself was edited, or only the line (not its neighbors) still matches. | `◌ comment !`, amber highlight |
| ambiguous | Several lines match; the tool will not guess. | Warning, no marker |
| detached | The line was deleted, split, or rewritten. | Warning, no marker |

Use **Mark Comment Reviewed** or **Reattach Comment to This Line** to resolve the last three. "Attached" only means the position matched. It does not mean the comment is still true.

Renaming a file in the editor renames its `.comment` file too. Renames outside the editor are not tracked; **Check Workspace** reports the orphaned sidecar.

## Settings

| Setting | Default | Choices |
| --- | --- | --- |
| `lineComments.markerStyle` | `label` | `label` shows `◌ comment`, `icon` shows `◌`, `off` hides markers. |
| `lineComments.showMarkers` | `true` | `false` hides markers in any style. |
| `lineComments.highlightStyle` | `line` | `line` (tint and left edge), `underline`, `off`. |
| `lineComments.showHoverMetadata` | `false` | `true` adds the comment ID, status and reason to the hover. |

The hover starts with **Comment on line N** so you can tell which line it belongs to, even when the card covers the line above.

Colors are theme tokens you can override in `workbench.colorCustomizations`:
`lineComments.highlightBackground`, `lineComments.highlightBorder`, `lineComments.reviewBackground`, `lineComments.reviewBorder`, `lineComments.sidecarForeground`.

## Hiding `.comment` files

By default each `.comment` file is dimmed and tucked, collapsed, under its source file in the Explorer. The extension does this by setting VS Code defaults:

```json
{
  "explorer.fileNesting.enabled": true,
  "explorer.fileNesting.expand": false,
  "explorer.fileNesting.patterns": { "*": "${capture}.comment" }
}
```

- These are VS Code-wide settings, so VS Code's built-in nesting (such as lockfiles under `package.json`) also appears.
- Anything you set yourself wins. If you define your own `explorer.fileNesting.patterns`, add `"*": "${capture}.comment"` to it.
- To hide sidecars completely, add `"files.exclude": { "**/*.comment": true }`. Hovers, markers and agent tools keep working.

## Agents

The extension does not change how an agent reads files. Give the agent a tool and instructions, then check that it uses them.

**Instructions.** `node src/cli.js rules` prints them, and **Copy Agent Instructions** copies them for your `AGENTS.md` or a Cursor rule. They tell the agent how to read and write comments and what a good comment is:
only non-obvious rules or reasons, in one or two sentences, attached to the line that enforces them.

**CLI.** Run from this folder, or pass `--root /path/to/repo` for another repository:

```sh
node src/cli.js read examples/app.tsx --start 1 --end 8                   # source + comments
node src/cli.js read examples/app.tsx --start 1 --end 8 --mode comments   # comments only
node src/cli.js check examples/app.tsx                                    # attachment problems
node src/cli.js --help                                                    # write commands
```

`read` prints real line numbers and two revision hashes. Every write needs both hashes from a fresh read, so an agent cannot overwrite changes it has not seen. `add` and `reanchor` also need the exact text of the target line.

**MCP.** **Copy Cursor MCP Configuration** copies a server entry for `.cursor/mcp.json` (read-only or read-write). Tools: `line_comments_read`, `line_comments_check`, and `line_comments_write` when started with `--allow-write`. A VS Code example is in `integration/`. The copied paths point to this installation; copy again after moving it.

Comment text is shown to agents as untrusted data, never as instructions.

## Limits

- Source and `.comment` files: up to 2 MiB each, UTF-8 text only.
- Up to 1000 comments per file and 16,000 characters per comment.
- Dependency, build and VCS folders (`node_modules`, `dist`, `.git`, …) are skipped.
- A `.comment` file that cannot be read is reported as an error. It is never treated as empty or overwritten.
- Hovers make no network or model requests.

## More

- [FORMAT.md](FORMAT.md): the `.comment` file format.
- [SECURITY.md](SECURITY.md): trust boundaries and what is not protected.
- [DEVELOPMENT.md](DEVELOPMENT.md): build, test, release, code layout.
- [ROADMAP.md](ROADMAP.md): what is missing before a 1.0.
