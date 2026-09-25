# Roadmap

What is missing before a public 1.0.

## Desktop validation

- Run the extension in real VS Code and Cursor on macOS, Windows and Linux. Current editor tests use a mocked API.
- Cover the draft editor, file watchers, undo across saves, renames, multi-root workspaces, remote hosts, large files and rapid edits.
- Add a VS Code test runner and CI.

## Reliability

- More property and fuzz tests for unusual edits and repeated code.
- Better behavior when switching branches.
- Help for moving comments across files, with confirmation.
- A conflict UI instead of messages in the output panel.
- More tests with several editors writing at once.

## Agents

- Run the same tasks with different agents and models. Measure whether they use the reader, keep documented constraints, notice stale comments, and how many tokens they use.
- Client-specific hooks only through each client's supported API.

## Packaging

- Optional strict TypeScript and linting; an MCP SDK if the protocol surface grows.
- Signed releases, a registered publisher, Marketplace and Open VSX publishing.

## Not planned

- Replacing line comments with a Markdown knowledge base.
- Anchoring to symbols instead of lines.
- Generated comments on every line.
- Model calls from the hover.
- Changing source files.
- "Smart" line matching that hides guesses behind a confidence score.
