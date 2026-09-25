# Security and data handling

No model requests, telemetry, analytics, HTTP listener or outbound networking are implemented. All extension metadata stays in local files/memory. CLI/MCP output may be sent to an external model by the agent client that invokes it; that is outside this tool's control. Sidecars can duplicate nearby source and can contain sensitive rationale: apply the same access, Git, backup and secret-scanning controls as source.

Hover bodies use escaped plain text in an untrusted MarkdownString with HTML disabled. No note text is evaluated or executed. Agent output quotes comment bodies and labels them as repository data. This reduces ambiguity but does not prove an external model is immune to prompt injection.

Workspace trust gates extension writes. The standalone MCP server starts read-only unless explicitly launched with --allow-write; writable tools change sidecars only. The CLI performs only the explicit requested operation. Both are confined to a selected root by normal path/canonical-path validation, reject final source/sidecar symlinks, and reject directory symlink escapes. Internal directory symlinks are canonicalized.

This is not an OS sandbox. A malicious process that can concurrently modify filesystem paths could race path validation or atomic replacement. Cooperating tool writers use an exclusive sidecar lock, source/sidecar revision guards and same-directory temp-file rename. Noncooperating editor/file processes are checked optimistically, but there is no kernel-level compare-and-swap across source and sidecar. No multi-file transaction or power-loss durability guarantee is claimed. Do not run against repositories writable by hostile local users without OS isolation.

Locks use `<source>.comment.lock`. A crash may leave one behind. Do not remove it while another writer is active. Once that is ruled out, remove the stale lock and retry. The tool does not automatically delete somebody else's lock. Ordinary writes use mode 0600 for newly replaced sidecars; no executable source permissions are changed.

The source and sidecar each have a 2 MiB limit. Scans exclude common dependency/generated/VCS directories, limit traversal to 200,000 entries and 5000 sidecars, and report failure rather than claiming a partial scan is complete. There is no broad full-repository model ingestion.

Caveats: no .gitignore-compatible scanner, no secrets classifier, no remote filesystem-provider support, no cryptographic comment author signatures, no external editor interception, no MCP auth because the server is local stdio only. The VSIX is unsigned and unpublished. Enterprise extension policies may disallow it.
