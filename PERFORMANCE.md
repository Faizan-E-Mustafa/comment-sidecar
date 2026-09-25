# Line Comments 0.1.3: performance and cleanup

## Implementation

The editor extension, shared core, filesystem service, CLI and optional stdio MCP server are plain JavaScript (CommonJS). Python 3 only packages the local VSIX using its standard library. There are no Rust source files, Cargo manifests, native addons or external npm runtime dependencies in this source distribution.

## Measured comparison

Node v22.16.0, linux/x64, AMD EPYC 9V74 80-Core Processor. Recorded 2026-09-25T10:46:07.467Z.

Synthetic 10,000-line source; format 2. Warm, same-process measurements: 10 warmups and 100 timed samples for these operations. Baseline source is the supplied, unmodified 0.1.2 archive. Timing includes only the specified operation. No running VS Code/Cursor UI, real MCP client, disk read or model request is included.

| Operation | 0.1.2 median | 0.1.3 median |
|---|---:|---:|
| Resolve unchanged revision (200 notes) | 10.813 ms | 0.555 ms |
| Resolve external leading-line insertion (200 notes) | 11.385 ms | 10.064 ms |
| Track live insertion (200 notes) | 2.303 ms | 2.490 ms |
| Render 200 source lines with notes | 0.856 ms | 0.408 ms |
| Store change handling, zero notes | 3.468 ms | 0.143 ms |

Do not interpret the unchanged-revision speedup as the entire extension being that much faster. External relocation still needs a scan. The live-edit tracking algorithm was not rewritten; its measured result is not an improvement in this run. Sub-millisecond timings and p95 values vary with hardware, JIT warmup, allocation and host contention. No statistically controlled cross-machine study was performed.

The full JSON comparison includes p95 results, both sidecar formats and both source sizes. Run:

```sh
npm run benchmark
npm run benchmark -- --baseline /absolute/path/to/extracted/0.1.2
```

Output: reports/BENCHMARK.json or reports/PERFORMANCE-COMPARISON.json. Reports are ignored, not embedded into the runtime package.

## Actual changes

1. Build a full line-hash search index only when at least one comment needs relocation. A source-revision match still requires a target-line hash match. All prior ambiguity/detachment semantics remain.
2. Reuse the service's resolved snapshot when the editor buffer matches it, instead of resolving twice.
3. Cache the results grouped by source line; hover reads that index rather than filtering every note. Rebuild the index when attachments change, including undo and deletion.
4. Skip source hashing, line-offset construction and undo-history snapshots on edits in a cached file with no annotations. Source/size/version updates and preview notification remain. Annotated files retain the existing tracking and 16-snapshot history.
5. Hash normalized text directly without allocating a split/join array solely for revision hashing. SHA-256, newline normalization, NUL validation and write guards remain unchanged.

## Rust and further work

A Rust native module or worker is not implemented in this release. Profile real large-workspace and large-file behavior first. If reconciliation blocks the extension host, a long-lived Node worker is a smaller next experiment than a cross-platform Rust rewrite. A native worker or a Rust/WASM core is another possible later design, not a measured speed guarantee. Keep any worker off the hover path, reuse it instead of spawning per operation, and discard stale results by document revision.

The current engine still scans full source on external changes, hashes source revisions for annotated edits, and schedules presentation refreshes. Worker offload, incremental line indexes for live edits, watcher scaling, bounded background queues, and desktop CPU/memory profiling remain future work. No Git-history lineage engine was added.

## Files and cleanup

Runtime modules are in src/core, src/node and src/extension plus src/cli.js and src/mcp.js. Keep both format parsers for compatibility and keep integration instructions for agent setup.

Development-only files remain available in the source distribution: test/, scripts/, examples/, TESTING.md, PERFORMANCE.md, ROADMAP.md and REFERENCES.md. They are not needed in the installed VSIX.

Build archives belong in dist/; measurements and logs belong in reports/. Both are ignored. The clean command defaults to a preview and removes only allowlisted generated files with --apply. It does not touch source, sidecars, active locks, arbitrary notes, patch files or directories reached through symlinks. Removing reports is a disk/repository cleanup, not a hover performance optimization.

## Validation boundary

106 automated tests pass in Linux normal and aliased-TMPDIR runs. The editor API is mocked. The local unsigned VSIX is ZIP/manifest checked; actual VS Code/Cursor/macOS rendering and large-workspace behavior are not tested in this environment.
