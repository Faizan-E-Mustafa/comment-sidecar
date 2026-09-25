# Line Comments patch format · v1

The unit is one physical source line. A note is a run of `+// ` lines immediately before its target context line. It is not a Markdown document, symbol documentation or an AST annotation. `//` is the sidecar format marker in every source language; it is never inserted into the executable file.

```diff
# line-comments v1
--- app.tsx
+++ app.tsx.annotated
@@ -2,5 +2,6 @@ id=lc_loading base=<64 lowercase hex characters> state=attached
   const { user, loading } = useSession();
 
+// Wait for session restoration before choosing a screen.
   if (loading) return <Splash />;
   if (!user) return <Login />;
 
```

The shortened hash above is illustrative; parsers require a complete SHA-256 value. The actual examples/app.tsx.comment has valid hashes.

## Rules

The first three lines are the version and informational source/virtual-output names. The virtual `.annotated` name does not refer to a file that must be created. Paths from headers are never used to read or write files; the sibling relationship is authoritative.

Each hunk is an independent insertion-only patch over its own recorded source revision. Coordinates are one-based. Old count is the number of context lines; new count is old count plus comment-body lines. New start equals old start, because each hunk is independent rather than a cumulative multi-hunk patch. Hunk windows may overlap. Do not apply these files with git/patch utilities.

A hunk stores up to two context lines before the target and two after. Lines prefixed with a single space are original source text; remove only that one prefix. Exactly one contiguous comment block starts with `+// `. The first context line following it is the target. Deletions, arbitrary code additions, multiple comment blocks within a hunk and malformed counts are rejected. Use tools to update coordinates and metadata.

The source revision `base` is SHA-256 of UTF-8 source after CRLF→LF normalization. A final newline is significant. The note ID remains stable when edited or reattached. It is not a magic identity for source code. `state` is attached, review or detached. Detached is a persistent tombstone produced by precise destructive editor changes and cleared only by explicit reattachment (or recent in-memory undo recovery). Ambiguous and moved are resolution results, not persisted states.

`attached` means the recorded positioning matched, not that the explanation is true. Neighboring-context matches across revisions are an anchoring heuristic, not evidence of historical or semantic identity. An exact copied block can be indistinguishable from an original that was deleted; no textual-only scheme can establish intent in that case.

Comments can be multiline or contain code-like text; every body line retains its `+// ` prefix. Sidecars must end with a newline. A source file and its sidecar are limited to 2 MiB each, with at most 1000 notes per file and 16,000 characters per comment. Binary, invalid UTF-8 and NUL-containing input are rejected. UTF-16 offsets from editor changes are used for live position tracking; external anchors use full line text.

## Reconciliation

Matching whole-file base + target uses the recorded position. Across revisions, a unique complete window matches; a unique target without matching context is provisional, except tiny generic targets which detach. Multiple target candidates without a unique complete window are ambiguous. Missing targets detach. The resolver does not guess by nearest line, whitespace-insensitive matching, symbol names or embeddings.

The source and sidecar hashes returned by agent reads are independent write guards. A sidecar write requires both; adding and reattaching additionally require the exact current target line text. Writer locks and atomic rename coordinate cooperating writers; see SECURITY.md for filesystem race limitations.
