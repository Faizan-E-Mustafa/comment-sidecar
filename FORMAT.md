# Line Comments sidecar format

The attachment unit is a physical source line, not a function, symbol or Markdown section. Each source file may have one sibling sidecar, such as `app.tsx.comment`. No source file is modified by comment operations.

The header must be exactly `# line-comments v2`. Any other header, or any malformed content, is reported as an error; the file is never treated as empty or overwritten.

## Syntax

Illustrative example (replace each `<...>` with a real 64-character lowercase hex digest; tools do this automatically):

```diff
# line-comments v2
--- app.tsx
+++ app.tsx.annotated
@@ 4 @@ id=lc_loading base=<source-sha256> state=attached
@anchor sha256 before=2 after=2 strong=1 target=<target-sha256> context=<context-sha256>
+// Wait for session restoration before choosing a screen.
```

The first three lines are the version and informational source/virtual-output names. The `.annotated` name does not refer to a file that must be created. Paths from headers are never used to read or write files; the sibling relationship is authoritative.

`@@ 4 @@` is an absolute one-based source line, not a unified-diff cumulative hunk coordinate. Each body line starts with `+// `; multiline bodies, including empty lines and code-like user-authored text, are preserved. `//` is the sidecar body marker in every source language; it is never inserted into the executable file. The format contains no copied code lines: context lines, code additions and deletions are rejected. Metadata field order is fixed. Notes are written sorted by line, then ID. The whole file ends with a newline; CRLF sidecars are read, and writes use LF. General-purpose `git apply`/`patch` tools must not be used on annotation sidecars.

## Fingerprints

`base` is SHA-256 of the complete source, UTF-8 encoded after CRLF→LF normalization. Final newlines matter. `target` is SHA-256 of the exact target line excluding its newline. `context` is SHA-256 of `JSON.stringify([...beforeLines, targetLine, ...afterLines])`; JSON array encoding preserves line boundaries. `before` and `after` are the number of neighboring lines, from zero to two. `strong` is 1 when the original target's trimmed UTF-16 length exceeds three characters; otherwise 0. This prevents a lone brace or blank line becoming a target-only provisional match after context disappears.

In memory, a note has exactly this shape; `anchor.target` and `anchor.context` are digests, not source text:

```js
{ id, base, state, line, text, anchor: { before, after, strong, target, context } }
```

## States and reconciliation

`state` persists `attached`, `review`, or `detached`. Detached is a persistent tombstone produced by precise destructive editor changes and cleared only by explicit reattachment (or recent in-memory undo recovery); it stays detached even if identical source reappears. `moved` and `ambiguous` are resolution results, never persisted states. `id` is a stable comment ID that survives edits and reattachment; it is not an identity for source code.

The resolver hashes current source lines and compares the stored fingerprints. Matching whole-file base + target uses the recorded position. Across revisions, a unique complete matching context attaches or moves; a unique strong target alone requires review; tiny generic targets detach. Multiple matches are ambiguous. Missing targets detach. The resolver does not guess by nearest line, whitespace-insensitive matching, symbol names, embeddings, an AST, a hidden database or Git history, and it cannot find approximate matches from a digest.

`attached` means the recorded positioning matched, not that the explanation is true. Hash equality is a matching heuristic with the usual cryptographic collision assumption, not proof of historical or semantic identity. An exact copied block can be indistinguishable from an original that was deleted.

## Limits and validation

A source file and its sidecar are limited to 2 MiB each, with at most 1000 notes per file and 16,000 characters per comment. IDs match `lc_[a-zA-Z0-9_-]{1,64}` and must be unique within a file. Hashes are complete lowercase SHA-256 values. Binary, invalid UTF-8 and NUL-containing input are rejected. UTF-16 offsets from editor changes are used for live position tracking; external anchors use full line text.

The source and sidecar hashes returned by agent reads are independent write guards. A sidecar write requires both; adding and reattaching additionally require the exact current target line text. Writer locks and atomic rename coordinate cooperating writers; see SECURITY.md for filesystem race limitations. Agents use the combined or comments-only reader, which does not emit per-note fingerprints.

