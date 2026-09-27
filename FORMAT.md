# The `.comment` file format

Each source file can have one sibling file with the same name plus `.comment`, for example `app.tsx.comment`.
It holds comments attached to single lines of the source. Tools write these files; you should not need to edit them by hand.

## Example

```diff
# comment-sidecar v2
--- app.tsx
+++ app.tsx.annotated
@@ 4 @@ id=lc_loading base=<sha256> state=attached
@anchor sha256 before=2 after=2 strong=1 target=<sha256> context=<sha256>
+// Wait for session restoration before choosing a screen.
@@ 5 @@ id=lc_signedout base=<sha256> state=review
@anchor sha256 before=2 after=2 strong=1 target=<sha256> context=<sha256>
+// A missing user means signed out only after loading finishes.
+// Second line of the same comment.
```

Each `<sha256>` is a full 64-character lowercase hex SHA-256 digest.

## Structure

**Header** (first three lines):

| Line | Content |
| --- | --- |
| 1 | Exactly `# comment-sidecar v2`. |
| 2 | `--- <source file name>` |
| 3 | `+++ <source file name>.annotated` (a label only; no such file exists). |

The names in the header are informational. The tool always finds the source by the sibling file name, never by the header.

**One block per comment**, sorted by line, then by ID:

| Line | Content |
| --- | --- |
| `@@ <line> @@ id=<id> base=<sha256> state=<state>` | Where the comment was last attached. |
| `@anchor sha256 before=<0-2> after=<0-2> strong=<0 or 1> target=<sha256> context=<sha256>` | The line's fingerprint. |
| `+// <text>` | One line of comment text. Repeat for multi-line comments. Empty lines are `+// `. |

Rules:

- `<line>` is the 1-based line number in the source. It is not a diff offset.
- `<id>` matches `lc_[a-zA-Z0-9_-]{1,64}` and is unique in the file. It never changes, even when the comment is edited or reattached.
- `<state>` is `attached`, `review` or `detached`.
- Field order is fixed.
- No source code is ever stored. Lines starting with a space (context), `+` without `// `, or `-` are rejected.
- The file ends with a newline. Files with CRLF line endings are read; the tool writes LF.
- `+// ` is the marker in every language. Nothing is ever inserted into the source file.
- Do not use `git apply` or `patch` on these files. They look like diffs but are not.

## Fingerprints

| Field | How it is computed |
| --- | --- |
| `base` | SHA-256 of the whole source file (UTF-8, CRLF converted to LF). |
| `target` | SHA-256 of the target line's exact text, without its newline. |
| `context` | SHA-256 of `JSON.stringify([...linesBefore, targetLine, ...linesAfter])`. |
| `before`, `after` | How many neighbor lines were used, 0 to 2 each (fewer at the start or end of the file). |
| `strong` | `1` if the trimmed target line is longer than 3 characters, else `0`. |

`strong` stops a blank line or a lone `}` from being matched on its own after its neighbors change.

In memory, a comment ("note") has exactly this shape:

```js
{ id, base, state, line, text, anchor: { before, after, strong, target, context } }
```

## Finding the line again

When the source changes, the tool hashes every current line and compares:

1. **Saved as `detached`**: stays `detached`.
2. **Same file revision and target matches at the saved line**: keep the saved state there.
3. **Exactly one place where target and neighbors all match**: `attached` if at the same line, `moved` otherwise (or `review` if the saved state is `review`).
4. **The target (or target and neighbors) matches in several places**: `ambiguous`. The tool never picks the nearest one.
5. **Only the target line matches, in exactly one place, and it is strong**: `review` there.
6. **Otherwise**: `detached`.

A comment becomes `detached` when its line is deleted, split or rewritten in the editor. It stays detached until someone reattaches it, even if identical code reappears.

`moved` and `ambiguous` are computed on every read and never saved.

Matching is by exact hashes only. There is no fuzzy matching, AST, symbol lookup or Git history. "Attached" means the position matched, not that the comment is still correct.

## Limits

- Source file and `.comment` file: 2 MiB each, UTF-8 text, no NUL bytes.
- 1000 comments per file.
- 16,000 characters per comment.

## Errors

If a `.comment` file has a different header or any invalid content, every operation on it fails with an error that names the problem. The file is never treated as empty and never overwritten.
