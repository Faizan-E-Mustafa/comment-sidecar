# Agent guide for this repository

Comment Sidecar: a VS Code extension, CLI and MCP server that keep per-line comments in sibling `.comment` files.

- Read [DEVELOPMENT.md](DEVELOPMENT.md) first: code layout, rules that must stay true, and code style.
- The `.comment` file format is specified in [FORMAT.md](FORMAT.md).
- Run `npm run verify` before calling a change done. Run `npm run release` if packaging changed.
- The extension is plain CommonJS with no dependencies and no build step. Do not add dependencies or a compiler without being asked. `site/` (the website) is a separate Astro project with its own `package.json`.
- Write readable code: one statement per line, braced multi-line control flow, no nested ternaries.
- Keep `README.md` accurate when behavior, commands or settings change.
- `integration/AGENTS.snippet.md` is not for this repository. It is the instruction text users copy into *their* projects.
