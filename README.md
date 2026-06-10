<img width="100%"  alt="image" src="https://github.com/user-attachments/assets/1f55b27f-3a1e-411c-997b-8102deea610f" />


Deterministic code clone detector. Finds functions, methods, and components that are structurally identical or very similar — candidates for extraction and componentization.

No LLM. No embeddings. No external services. Every result is reproducible.

---

## What it does

`surgex` indexes a codebase, computes structural fingerprints for every code unit (function, method, component, class), and detects which ones share the same shape — even when variable names, types, and API calls differ.

Two commands:

- **`index`** — parses the codebase and saves the fingerprint index to `.surgex/index.json`
- **`check`** — compares files against the index and reports clone groups

---

## How it works

### 1. Parsing — tree-sitter

Source files are parsed with [tree-sitter](https://tree-sitter.github.io/tree-sitter/), a fast incremental parser that produces a concrete syntax tree. Supported languages: **TypeScript**, **TSX**, **Ruby**.

The parser walks the AST and extracts *code units*: `function_declaration`, `method_definition`, `arrow_function` (when assigned to a `const`), and `class` nodes.

### 2. Normalization — Type-2 clone detection

Raw source tokens are normalized before any comparison. This enables detecting **Type-2 clones**: code that is structurally identical but uses different names.

The normalization rules:
- All identifiers (`userId`, `productId`, `token`) → `ID`
- All string literals (`"hello"`, `` `template` ``) → `STR`
- All numeric literals (`42`, `3.14`) → `NUM`
- All structural tokens (keywords, operators, brackets) are kept as-is

This means two functions that do the same thing with different variable names produce the same normalized token sequence — and the same fingerprint.

Example:
```ts
// useProducts.ts
const [products, setProducts] = useState<Product[]>([])
apiClient.getProducts(token)

// useCategories.ts
const [categories, setCategories] = useState<Category[]>([])
apiClient.getCategories(token)
```

After normalization, both lines become:
```
const [ ID , ID ] = ID < ID > ( [ ] )
ID . ID ( ID )
```

### 3. Fingerprinting — Winnowing

Each normalized token sequence is fingerprinted using the **Winnowing algorithm** (Schleimer, Wilkerson, Aiken — SIGMOD 2003), the same technique used by Stanford's MOSS plagiarism detector.

The algorithm guarantees: *any shared token subsequence of length ≥ K will be detected*.

Steps:

1. **k-grams** — generate all overlapping windows of K consecutive tokens, joined into strings.
2. **FNV-1a hash** — hash each k-gram with a fast, low-collision hash function.
3. **Winnowing** — slide a window of size W over the hash sequence; select the minimum hash in each window.

The selected minimums form a set — the unit's fingerprint. Two units that share code share fingerprint hashes.

Default parameters (tunable via `surgex index --kgram=N --window=N`):
- `K = 5` (minimum match length in tokens)
- `W = 4` (window size; controls fingerprint density)

The parameters are stored in the index and reused by `check`, so fingerprints
always match the index they are compared against.

### 4. Similarity — Jaccard coefficient

Given two fingerprints A and B (sets of hashes), similarity is:

```
Jaccard(A, B) = |A ∩ B| / |A ∪ B|
```

- `1.0` = structurally identical
- `0.75+` = very similar, strong candidate for extraction
- `0.0` = nothing in common

This is deterministic, symmetric, and requires no training data.

### 5. Candidate pairs — hash bucket filtering

Comparing all pairs of N units naively is O(N²). For large codebases this is slow.

`surgex` avoids it with a hash-bucket pre-filter:

1. Build a map: `hash → [unit indices]`
2. Any two units that share at least one fingerprint hash are *candidate pairs*
3. Compute Jaccard only for candidate pairs

In practice, only a small fraction of all possible pairs share any hash, so the actual number of Jaccard computations is much closer to O(N) than O(N²).

### 6. Clone grouping — Union-Find

Clone pairs are often transitive: if A is similar to B and B is similar to C, all three belong to the same group. `surgex` clusters them with a **Union-Find** (disjoint set) data structure, producing clone *groups* rather than a flat list of pairs.

### 7. Visual diff — LCS on normalized lines

With `--show-code`, `surgex` shows both code blocks side by side with each structurally duplicated line marked with `≡`.

The matching is done with **Longest Common Subsequence (LCS)** on normalized lines: each line is independently normalized (same identifier → `ID` substitution), and the LCS of these normalized sequences identifies which lines are structurally identical across the two functions.

---

## Storage

The index is stored at `.surgex/index.json` relative to the directory where `surgex index` was run. It persists between runs — `surgex check` reads it without re-indexing.

File paths are stored relative to the project root, so the index keeps working when the project is moved or checked out on another machine (e.g. CI).

When `surgex` is invoked from a subdirectory, it walks up the directory tree to find the nearest `.surgex/` folder, similar to how `git` finds `.git/`. The walk stops at the git repository root.

---

## Installation

```bash
git clone https://github.com/henriquesml/surgex
cd surgex
npm install
npm run build
npm link        # makes `surgex` available globally
```

Or run directly without installing:

```bash
npx ts-node /path/to/surgex/src/cli/index.ts <command>
```

---

## Commands

### `surgex index [paths...]`

Indexes all `.ts`, `.tsx`, and `.rb` files under the given paths. Saves the result to `.surgex/index.json` in the current directory.

Indexing is **incremental**: each file's `mtime` and size are stored in the index, and on re-index only files that changed are re-parsed — unchanged files have their fingerprints carried over from the previous run. Deleted files drop out of the index automatically. The cache is bypassed when the Winnowing parameters change (old fingerprints would not match) or with `--force`.

```bash
surgex index                          # index from current directory
surgex index src/                     # index a specific path
surgex index src/ lib/                # index multiple paths
surgex index --verbose                # print each indexed file (parsed vs cached)
surgex index --force                  # re-parse everything, ignoring the cache
surgex index --kgram=7 --window=5     # tune Winnowing parameters
```

Ignored automatically: `node_modules`, `dist`, `tmp`, `vendor`, `coverage`, `.git`, `spec/fixtures`.

---

### `surgex check`

Compares files against the index and reports clone groups. Behavior depends on the flags passed.

```bash
surgex check                                   # uncommitted changes (staged + unstaged + untracked)
surgex check --all                             # all indexed files — full scan
surgex check --from=main                       # all changes in current branch vs main
surgex check src/hooks/useMyHook.ts            # specific file
surgex check src/hooks/                        # all files in a directory
surgex check src/hooks/ src/components/        # multiple directories and files
```

When a path argument is a directory, `surgex` globs all `.ts`, `.tsx`, and `.rb` files inside it automatically.

Options:
| Flag | Default | Description |
|------|---------|-------------|
| `--all` | — | Scan all indexed files instead of changed files |
| `--from=ref` | — | Git ref to diff against (e.g. `main`, `HEAD~3`) |
| `--threshold=N` | `0.75` | Minimum Jaccard similarity (0.0–1.0) |
| `--min-tokens=N` | `20` | Ignore units with fewer normalized tokens |
| `--show-code` | — | Show duplicated lines side by side |
| `--json` | — | Machine-readable JSON output |
| `--fail-on-found` | — | Exit with code 1 if clones are found (CI gate) |

`check` also detects clones *within the checked files themselves* — two
identical new files added in the same branch are reported even though neither
is in the index yet.

Using as a CI gate:

```bash
surgex check --from=origin/main --fail-on-found --json > clones.json
```

Both commands show progress in real time:

```
Checking 127 file(s) [all indexed files]
  42/127  hooks/useTimeout.ts
```

---

## Clone types

| Type | Condition | Description |
|------|-----------|-------------|
| Type-1 | similarity = 100%, same line count | Exact copy — only whitespace or comments differ |
| Type-2 | similarity = 100%, different line count | Same structure, different names or types |
| Type-3 | similarity < 100% | Similar structure with insertions or removals |

Results are grouped by type so the most actionable duplicates appear first.

---

## Example output

```
Checking 127 file(s) [all indexed files]

Found 5 item(s):

── Type-1  exact copy (only names/whitespace may differ)  (2 items)

   #1  100%  3 functions under hooks/data/

        useProducts                               [function]  hooks/data/useProducts.ts:6
        useCategories                             [function]  hooks/data/useCategories.ts:6
        useSuppliers                              [function]  hooks/data/useSuppliers.ts:6

   #2  100%  2 functions in the same file

        fetchUserById                             [function]  services/userService.ts:12
        fetchCompanyById                          [function]  services/userService.ts:34

── Type-3  similar structure with insertions/removals  (3 items)

   #3  87%  2 functions across different directories

        validateEmail                             [function]  utils/validation.ts:5
        validateCpf                               [function]  models/customer.ts:18
```

With `--show-code`:

```
   #1  100%  3 functions under hooks/data/
   ...

    useProducts (new)                              useCategories (existing)
    ──────────────────────────────────────────────────────────────────────
    export function useProducts({ enabled }) {   ≡  export function useCategories({ enabled }) {
      const { token } = useAuth()               ≡    const { token } = useAuth()
      const [items, setItems] = useState([])         const [list, setList] = useState([])
      const [error, setError] = useState(false) ≡    const [error, setError] = useState(false)
                                                 ≡  
      useEffect(() => {                          ≡    useEffect(() => {
        ...                                      ≡      ...
      }, [enabled, token])                       ≡    }, [enabled, token])
    }                                            ≡  }
    ──────────────────────────────────────────────────────────────────────
    8 of 9 lines structurally duplicated (89%)
```

---

## Project structure

The code is organized in layers; the dependency direction points inward, so
`core/` never imports from the outer layers.

```
src/
  core/                 — pure algorithms, no I/O (deterministic in → out)
    normalizer.ts       — AST node → normalized token sequence
    fingerprint.ts      — Winnowing algorithm + FNV-1a hash + Jaccard
    detector.ts         — hash bucket filtering + Jaccard computation
    grouping.ts         — Union-Find clustering of clone pairs
  lang/
    parser.ts           — tree-sitter: extracts code units from TS and Ruby
  io/                   — the boundary with the outside world
    store.ts            — JSON index persistence (.surgex/index.json)
    git.ts              — git changed files, file-at-ref content
    source.ts           — reading source line ranges
  pipeline/             — orchestration (core + lang + io)
    indexer.ts          — glob + parse + save pipeline
    checker.ts          — git-aware diff check + insertion/modification split
  report/               — presentation
    format.ts           — unified output formatter
    report.ts           — builds display groups for check and report paths
    diff.ts             — LCS-based side-by-side visual diff
  cli/
    index.ts            — index / check command dispatch
    help.ts             — usage text
  types.ts              — CodeUnit, ClonePair, CloneGroup interfaces
  errors.ts             — UsageError (expected, user-facing errors)
  index.ts              — public library API
tests/                  — vitest suite (core, parser, store, checker, CLI smoke)
```

---

## References

- Schleimer, Wilkerson, Aiken. *Winnowing: Local Algorithms for Document Fingerprinting*. SIGMOD 2003.
- tree-sitter. [https://tree-sitter.github.io](https://tree-sitter.github.io)
- Clone taxonomy (Type 1–4): Roy, Cordy, Koschke. *Comparison and Evaluation of Code Clone Detection Techniques*. 2009.
