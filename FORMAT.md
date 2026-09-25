# Line Comments patch formats

The attachment unit is a physical source line, not a function, symbol or Markdown section. The editor and CLI can read both versions. New service-created sidecars default to v2; existing sidecars retain their version unless explicitly converted. No source file is modified by comment operations.

## V2: comments and fingerprints, no copied source context

Illustrative example (replace each `<...>` with a real 64-character lowercase hex digest; tools do this automatically):

```diff
# line-comments v2
--- app.tsx
+++ app.tsx.annotated
@@ 4 @@ id=lc_loading base=<source-sha256> state=attached
@anchor sha256 before=2 after=2 strong=1 target=<target-sha256> context=<context-sha256>
+// Wait for session restoration before choosing a screen.
```

`@@ 4 @@` is an absolute one-based source line, not a unified-diff cumulative hunk coordinate. Each body line starts with `+// `; multiline bodies, including empty lines and code-like user-authored text, are preserved. The format adds no copied code lines. Metadata field order is fixed. The whole file ends with a newline. General-purpose `git apply`/`patch` tools must not be used on annotation sidecars.

`base` is SHA-256 of the complete source, UTF-8 encoded after CRLF→LF normalization. Final newlines matter. `target` is SHA-256 of the exact target line excluding its newline. `context` is SHA-256 of `JSON.stringify([...beforeLines, targetLine, ...afterLines])`; JSON array encoding preserves line boundaries. Neighbor counts are integers from zero to two. `strong` is 1 when the original target's trimmed UTF-16 length exceeds three characters; otherwise 0. This prevents a lone brace or blank line becoming a target-only provisional match after context disappears.

The resolver hashes current source lines and compares the stored target/context fingerprints. The same source revision and target use the stored line. On another revision, a unique complete matching context can attach/move; a unique strong target alone requires review. Multiple matches are ambiguous; absent targets detach. Hash equality is a matching heuristic with the usual cryptographic collision assumption, not proof of historical or semantic identity. The tool does not find approximate matches from a digest. This format does not use an AST, embedding, hidden database or Git-history lookup.

`state` persists `attached`, `review`, or `detached`; a live deletion's detached tombstone stays detached even if identical source reappears. `moved` and `ambiguous` are resolution results, not persisted states. `id` is a stable comment ID. File headers are informational; the sibling filename controls file access. All size/count/body limits of v1 below also apply to v2.

### Conversion and compatibility

`compact` converts recorded v1 context into v2 fingerprints without changing comment text, IDs, recorded base or persisted state. It does not require locating the old code, so unresolved anchors can be preserved without inventing attachment. Source and sidecar revision guards are required. Conversion is idempotent. There is no automatic v2-to-v1 expansion: the old code is no longer in the sidecar and must not be fabricated. Restore the old sidecar from version control when downgrading.

Core `serialize(name, notes, {version})` accepts an explicit format; without it, existing in-memory text-context notes use v1 for compatibility and fingerprint notes use v2. The filesystem service always passes its stored format version, with v2 for new files. Agents keep using the existing combined/notes-only reader, so no per-note fingerprint data is added to their output.

## Legacy v1 (still readable and writable)

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

The shortened hash above is illustrative; parsers require a complete SHA-256 value. The bundled example now uses v2; v1 tests generate valid legacy fixtures.

### V1 rules

The first three lines are the version and informational source/virtual-output names. The virtual `.annotated` name does not refer to a file that must be created. Paths from headers are never used to read or write files; the sibling relationship is authoritative.

Each hunk is an independent insertion-only patch over its own recorded source revision. Coordinates are one-based. Old count is the number of context lines; new count is old count plus comment-body lines. New start equals old start, because each hunk is independent rather than a cumulative multi-hunk patch. Hunk windows may overlap. Do not apply these files with git/patch utilities.

A hunk stores up to two context lines before the target and two after. Lines prefixed with a single space are original source text; remove only that one prefix. Exactly one contiguous comment block starts with `+// `. The first context line following it is the target. Deletions, arbitrary code additions, multiple comment blocks within a hunk and malformed counts are rejected. Use tools to update coordinates and metadata.

The source revision `base` is SHA-256 of UTF-8 source after CRLF→LF normalization. A final newline is significant. The note ID remains stable when edited or reattached. It is not a magic identity for source code. `state` is attached, review or detached. Detached is a persistent tombstone produced by precise destructive editor changes and cleared only by explicit reattachment (or recent in-memory undo recovery). Ambiguous and moved are resolution results, not persisted states.

`attached` means the recorded positioning matched, not that the explanation is true. Neighboring-context matches across revisions are an anchoring heuristic, not evidence of historical or semantic identity. An exact copied block can be indistinguishable from an original that was deleted; no textual-only scheme can establish intent in that case.

Comments can be multiline or contain code-like text; every body line retains its `+// ` prefix. Sidecars must end with a newline. A source file and its sidecar are limited to 2 MiB each, with at most 1000 notes per file and 16,000 characters per comment. Binary, invalid UTF-8 and NUL-containing input are rejected. UTF-16 offsets from editor changes are used for live position tracking; external anchors use full line text.

### Shared reconciliation rules

Matching whole-file base + target uses the recorded position. Across revisions, a unique complete window matches; a unique target without matching context is provisional, except tiny generic targets which detach. Multiple target candidates without a unique complete window are ambiguous. Missing targets detach. The resolver does not guess by nearest line, whitespace-insensitive matching, symbol names or embeddings.

The source and sidecar hashes returned by agent reads are independent write guards. A sidecar write requires both; adding and reattaching additionally require the exact current target line text. Writer locks and atomic rename coordinate cooperating writers; see SECURITY.md for filesystem race limitations.
