# Contributing to surgex

Thanks for your interest in improving surgex! This guide covers how to get set
up and what we expect from contributions.

## Getting started

```bash
git clone https://github.com/henriquesml/surgex
cd surgex
npm install
npm run build
```

Run the CLI from source during development:

```bash
npm run dev -- index           # surgex index
npm run dev -- check --all     # surgex check --all
```

## Project layout

The code is organized in layers. The dependency direction always points
inward — `core/` never imports from the outer layers.

```
src/
  core/      Pure algorithms. No I/O. Deterministic in → deterministic out.
             normalizer, fingerprint (Winnowing + Jaccard), detector, grouping.
  lang/      Language/syntax knowledge (tree-sitter parsing).
  io/        The boundary with the outside world: filesystem, git, index store.
  pipeline/  Orchestration — combines core + lang + io (indexer, checker).
  report/    Presentation: formatting and the side-by-side diff.
  cli/        Argument parsing and command dispatch.
  index.ts   Public library API.
```

When adding code, put it in the layer that matches its responsibility. If you
find yourself wanting to import `io/` from `core/`, that logic probably belongs
in `pipeline/` instead.

## Before opening a pull request

```bash
npm run build         # must compile cleanly
npm run lint          # must pass
npm run format:check  # must pass (run `npm run format` to fix)
```

(Test suite is coming — see the roadmap in the README. Until then, please
describe how you manually verified your change in the PR.)

## Coding style

- No semicolons, single quotes, 2-space indent (enforced by Prettier).
- Keep functions small and named for what they do.
- Comments explain *why*, not *what* — match the density of the surrounding code.

## Reporting bugs

Open an issue with a minimal reproduction: the input code, the command you ran,
and what you expected versus what happened. Because surgex is deterministic, a
reproduction is usually all we need.
