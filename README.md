# dry

Deterministic code clone detector. Finds functions, methods, and components that are structurally identical or very similar — candidates for extraction and componentization.

No LLM. No embeddings. No external services. Every result is reproducible.

---

## What it does

`dry` indexes a codebase, computes structural fingerprints for every code unit (function, method, component, class), and detects which ones share the same shape — even when variable names, types, and API calls differ.

Two commands:

- **`index`** — parses the codebase and saves the fingerprint index to `.dry/index.json`
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

Parameters used:
- `K = 5` (minimum match length in tokens)
- `W = 4` (window size; controls fingerprint density)

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

`dry` avoids it with a hash-bucket pre-filter:

1. Build a map: `hash → [unit indices]`
2. Any two units that share at least one fingerprint hash are *candidate pairs*
3. Compute Jaccard only for candidate pairs

In practice, only a small fraction of all possible pairs share any hash, so the actual number of Jaccard computations is much closer to O(N) than O(N²).

### 6. Clone grouping — Union-Find

Clone pairs are often transitive: if A is similar to B and B is similar to C, all three belong to the same group. `dry` clusters them with a **Union-Find** (disjoint set) data structure, producing clone *groups* rather than a flat list of pairs.

### 7. Visual diff — LCS on normalized lines

With `--show-code`, `dry` shows both code blocks side by side with each structurally duplicated line marked with `≡`.

The matching is done with **Longest Common Subsequence (LCS)** on normalized lines: each line is independently normalized (same identifier → `ID` substitution), and the LCS of these normalized sequences identifies which lines are structurally identical across the two functions.

---

## Storage

The index is stored at `.dry/index.json` relative to the directory where `dry index` was run. It persists between runs — `dry check` reads it without re-indexing.

When `dry` is invoked from a subdirectory, it walks up the directory tree to find the nearest `.dry/` folder, similar to how `git` finds `.git/`.

---

## Installation

```bash
git clone https://github.com/yourorg/dry
cd dry
npm install
npm run build
npm link        # makes `dry` available globally
```

Or run directly without installing:

```bash
npx ts-node /path/to/dry/src/cli.ts <command>
```

---

## Commands

### `dry index [paths...]`

Indexes all `.ts`, `.tsx`, and `.rb` files under the given paths. Saves the result to `.dry/index.json` in the current directory.

```bash
dry index                          # index from current directory
dry index src/                     # index a specific path
dry index src/ lib/                # index multiple paths
dry index --verbose                # print each indexed file
```

Ignored automatically: `node_modules`, `dist`, `tmp`, `vendor`, `coverage`, `.git`, `spec/fixtures`.

---

### `dry check`

Compares files against the index and reports clone groups. Behavior depends on the flags passed.

```bash
dry check                                   # uncommitted changes (staged + unstaged + untracked)
dry check --all                             # all indexed files — full scan
dry check --from=main                       # all changes in current branch vs main
dry check src/hooks/useMyHook.ts            # specific file
dry check src/hooks/                        # all files in a directory
dry check src/hooks/ src/components/        # multiple directories and files
```

When a path argument is a directory, `dry` globs all `.ts`, `.tsx`, and `.rb` files inside it automatically.

Options:
| Flag | Default | Description |
|------|---------|-------------|
| `--all` | — | Scan all indexed files instead of changed files |
| `--from=ref` | — | Git ref to diff against (e.g. `main`, `HEAD~3`) |
| `--threshold=N` | `0.75` | Minimum Jaccard similarity (0.0–1.0) |
| `--min-tokens=N` | `20` | Ignore units with fewer normalized tokens |
| `--show-code` | — | Show duplicated lines side by side |

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

```
src/
  types.ts          — CodeUnit, ClonePair, CloneGroup interfaces
  normalizer.ts     — AST node → normalized token sequence
  fingerprinter.ts  — Winnowing algorithm + FNV-1a hash + Jaccard
  parser.ts         — tree-sitter: extracts code units from TS and Ruby
  store.ts          — JSON index persistence (.dry/index.json)
  detector.ts       — hash bucket filtering + Jaccard computation
  reporter.ts       — Union-Find grouping + report formatting
  indexer.ts        — glob + parse + save pipeline
  checker.ts        — git-aware diff check + per-file insertion/modification split
  git.ts            — git changed files, file-at-ref content
  diff.ts           — LCS-based side-by-side visual diff
  format.ts         — unified output formatter (shared by check and report paths)
  cli.ts            — index / check commands
```

---

## References

- Schleimer, Wilkerson, Aiken. *Winnowing: Local Algorithms for Document Fingerprinting*. SIGMOD 2003.
- tree-sitter. [https://tree-sitter.github.io](https://tree-sitter.github.io)
- Clone taxonomy (Type 1–4): Roy, Cordy, Koschke. *Comparison and Evaluation of Code Clone Detection Techniques*. 2009.
