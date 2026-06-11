# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Incremental indexing: `surgex index` stores each file's mtime and size in
  the index (format v3) and only re-parses files that changed since the last
  run; deleted files drop out automatically. The cache is bypassed when the
  Winnowing parameters change or with the new `index --force` flag.
- `check --json` — machine-readable output for CI and editor integrations.
- `check --fail-on-found` — exits with code 1 when clones are found, so
  `surgex` can gate CI pipelines.
- `index --kgram=N` / `index --window=N` — tune the Winnowing parameters. They
  are stored in the index and reused by `check`, so fingerprints always match.
- `check` now also detects clones *within the changeset itself*: two new
  identical files added in the same branch are reported even though neither is
  in the index yet.
- The TypeScript parser now extracts `memo(...)`/`forwardRef(...)`-wrapped
  components, class property arrows (`handle = () => {}`), object literal
  function entries, anonymous `function` expressions, and `export default`
  functions.
- Test suite (vitest) covering core algorithms, parser extraction, the store,
  the checker pipeline, and CLI smoke tests; CI now runs it.

### Changed
- The index stores file paths relative to the project root, so it keeps
  working when the project moves or is checked out on another machine. The
  index format is now versioned and validated on load (old indexes must be
  rebuilt with `surgex index`).
- Index format bumped to v3: normalization now folds TypeScript destructuring
  shorthand and Ruby instance/class/global variables and symbols, so older
  fingerprints no longer match and pre-v3 indexes are rejected with a prompt to
  re-run `surgex index`.
- The index is written atomically (temp file + `rename`), so an interrupted
  write (Ctrl-C, OOM) can no longer leave a truncated `.surgex/index.json`.
- `check <file>`/`check <dir>` anchor report paths at the git repository root
  instead of the current working directory, matching the paths used for
  git-derived changes.
- `Store.discover` no longer walks above the git repository root when looking
  for `.surgex/`.
- `check <dir>` now uses the same ignore list as `index` (previously only
  `node_modules` and `dist` were skipped).
- Expected errors (missing index, bad flag values, not a git repo) print a
  one-line message instead of a stack trace. Invalid numeric flags (e.g.
  `--threshold=abc`) abort instead of silently matching nothing.
- Clone groups no longer list units that are fully contained in another unit
  of the same group (a cloned class no longer re-lists each of its methods).
- The `report/diff.ts` presentation module was renamed to
  `report/structural-match-view.ts`, and `--show-code` now consistently refers
  to structural matches rather than diffs.

### Fixed
- Type-2 detection gaps: TypeScript destructuring shorthand (`{ token }`) and
  Ruby instance variables (`@user`), class/global variables, and symbols
  (`:user_key`) were left un-normalized, so structurally identical code that
  differed only in those names was missed. They now normalize like any other
  identifier (symbols to a distinct `SYM` token), so these clones are detected.
- `surgex report` crashed with infinite recursion (`Maximum call stack size
  exceeded`).
- Git commands are now invoked with argument arrays (`execFileSync`) instead
  of interpolated shell strings — file names or refs containing shell
  metacharacters can no longer inject commands.
- Git **argument** injection via `--from`/refs: a ref such as
  `--from=--output=/path` was parsed by git itself as an option (not a
  revision), letting a caller pass arbitrary git flags. Refs that look like
  options are now rejected, and refs are passed after `--end-of-options`.
- Modified-unit detection no longer collides on repeated names (e.g. multiple
  Ruby `initialize` methods in one file).
- The candidate-pair key in the detector no longer collides on very large
  codebases.
- `--show-code` no longer risks out-of-memory on extremely large units; the
  structural match view is skipped above ~1M line-pair comparisons.
- The parser no longer indexes malformed TypeScript or Ruby units with empty
  names when tree-sitter produces partial nodes from invalid source.

### Performance
- The hash → unit lookup map is built once per check instead of twice per
  checked file.
- Jaccard similarity reuses one fingerprint `Set` per unit instead of
  allocating two new `Set`s per compared pair.
- `check` now skips structural-noise hashes shared by very many indexed units
  (the same cap full-scan detection already used), so one common fingerprint
  hash no longer forces every checked unit into an O(N) scan of the index.
- The `--show-code` structural match view caches each file's lines (invalidated
  by mtime) instead of re-reading the whole file for every line range.
- tree-sitter grammars are loaded lazily, so library consumers of the pure
  fingerprint/Jaccard API don't pay the cost of loading native grammars.

### Internal
- Reorganized the source into layered modules (`core`, `lang`, `io`,
  `pipeline`, `report`, `cli`). The pure detection algorithms now live in
  `core/` with no I/O dependencies.
- The index store is now a `Store` class that loads and writes the index in a
  single pass, instead of re-serializing the whole index per file — indexing
  no longer performs O(N²) disk I/O on large codebases.
- The published binary now uses a `#!/usr/bin/env node` shebang and `bin`
  resolves to the correct compiled entry point.
- Test coverage now exercises the full repository at 100% statements,
  branches, functions, and lines.

## [0.1.0]

### Added
- Initial release: deterministic code clone detector with `index` and `check`
  commands. Winnowing fingerprints, Jaccard similarity, Union-Find grouping,
  and an LCS-based side-by-side structural match view. Supports TypeScript,
  TSX, and Ruby.
