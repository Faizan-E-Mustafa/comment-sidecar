# Security and data handling

## What the tool does and does not do

- No network access, telemetry, analytics or model requests. Everything stays in local files and memory.
- Source files are never written. Only `<source>.comment` files change.
- CLI and MCP output may be sent to a model by the agent that runs them. That is outside this tool's control.

## Who can write

- **Editor:** only in a trusted workspace (VS Code workspace trust). Untrusted workspaces are read-only: hovers work, writes do not.
- **MCP server:** read-only unless started with `--allow-write`. Even then it can change only `.comment` files.
- **CLI:** performs only the command it is given.

## Path safety

- Every path must be inside the selected workspace root.
- Source and `.comment` files that are symlinks are rejected.
- Directory symlinks that lead outside the workspace are rejected. Directory aliases inside it (such as macOS `/var` → `/private/var`) are resolved and allowed.
- `.git`, `node_modules`, `dist`, `build`, `.next`, `.venv`, `vendor`, `.turbo` and `coverage` are skipped, whether reached directly or through a link.
- The unsaved-file checks compare real file identity, so an alias cannot bypass them.

## Concurrent writes

- Writers take an exclusive lock file, `<source>.comment.lock`.
- Every write re-checks the source and sidecar hashes, writes a temp file, and renames it into place.
- These protect against other cooperating writers (the editor, the CLI, agents). They are **not** an OS sandbox. A hostile local process that changes files at the same moment could race the checks. Do not run against repositories that hostile users can write to without OS isolation.
- There is no multi-file transaction and no power-loss guarantee.
- A crash can leave a lock file behind. Delete it only after making sure no writer is running. The tool never deletes someone else's lock.
- New sidecars are written with mode 0600.

## Comment content

- Hovers show comment text as plain text in an untrusted Markdown string, with HTML and commands disabled. Comment text is never executed.
- Agent output labels comments as repository data, not instructions. This helps, but cannot guarantee a model will ignore instructions hidden in a comment.
- Fingerprints are not encryption. Common lines can be guessed and hashed. File names, line numbers, comment text and hashes are all readable.
- Comments may contain sensitive reasoning. Treat `.comment` files like source: same access control, Git hygiene, backups and secret scanning.
- Anyone who can edit a `.comment` file can change what it claims, just like an inline comment. There are no signatures.

## Limits

- Source and `.comment` files: 2 MiB each, UTF-8 text, no NUL bytes.
- Workspace scans stop at 200,000 entries or 5,000 sidecars and report an error instead of a partial result.

## Not provided

No `.gitignore`-aware scanning, secret detection, remote filesystem support, author signatures, MCP authentication (the server is local stdio only), or signed VSIX. Enterprise extension policies may block an unsigned VSIX.
