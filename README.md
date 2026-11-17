# VisualCode

A PWA proof of concept for **reading and reviewing code as a storyline**.

Code is written top to bottom, but logic doesn't flow in that order. VisualCode cuts each file into
blocks (functions, methods, class headers and module-level sections such as imports, types, setup
and the entry point). It then rearranges the blocks by what calls what: you start at the entry
points and follow arrows from each call line to the code it runs.

## What it does

- **Folder map**: the project's folders and files with import and call edges between them. Code
  outside the current folder appears as dashed "ghost" nodes. Click to select; click twice (or
  double-tap) to open.
- **Storyline (per file)**: blocks are numbered in reading order. The main path runs down the left
  column. Called code branches into columns to the right, level with the line that calls it, and
  each arrow starts at the exact call line. Calls into other files show as collapsed cards. Click
  **Expand** to pull that code into the story, or **Open** to jump to that file's storyline.
- **Review**: load a GitHub pull request, or paste a unified diff. Changed files and blocks are
  highlighted at every level; inside cards, added lines are green and removals are marked red.
  Pin comments to any block, file or folder. Comments are saved in the browser (IndexedDB) and can
  be exported as Markdown or JSON, and imported again from JSON.
- **Optional AI**: paste a Claude API key in Settings to get **Explain** and **Suggest review
  notes** on a block. Answers are saved as comments. The key goes from the browser straight to
  the Anthropic API.

Inputs: a public GitHub repo, folder or pull request URL; a local folder or `.zip`; pasted code
and/or a pasted diff. Supported languages are JavaScript, TypeScript and Python.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (parsers, diff, graph, storyline)
npm run build      # production build + service worker into dist/
npm run preview    # serve the built PWA
```

## How it works

```
ingest (GitHub / folder / zip / paste)
  -> parse   TypeScript compiler API (JS/TS), line-based parser (Python)
  -> sections  module-level code between declarations becomes blocks
  -> graph   folder > file > block hierarchy; import + call edges (with call-site lines)
  -> changes diff lines mapped onto files and blocks
  -> views   folder map (edges lifted to visible nodes)  |  file storyline (flow order)
```

| Path | Responsibility |
| --- | --- |
| `src/parse/` | Language detection, TS and Python parsers, module-level sections |
| `src/diff/` | Unified diff parsing (git and plain) |
| `src/graph/` | Graph building, import/call resolution, change index, map view, storyline order |
| `src/analysis/` | Pipeline that turns a `Project` into an `Analysis` |
| `src/ingest/` | GitHub, folder/zip and paste loaders |
| `src/review/` | Comment storage and import/export |
| `src/ai/` | Optional Claude calls |
| `src/components/` | React UI: map canvas, storyline canvas, panels, dialogs |

## Known limitations (POC)

- Call resolution is name-based. It handles local functions, imports (named, default, namespace,
  Python modules), `this.`/`self.` methods and `Class.method`. Dynamic dispatch, path aliases
  (`@/…`) and package code are not resolved.
- The Python parser is line-based: nested functions are part of their parent block, and only
  methods directly inside top-level classes become their own blocks.
- A pasted diff must match the loaded code's **new** version (load the PR head, not the base).
- GitHub loading supports public repositories only; refs containing `/` are not supported in
  `…/tree/<ref>/…` URLs. Very large repos need a sub-folder URL.
- Phones get a read-only view (no commenting); the app is designed for desktop.
