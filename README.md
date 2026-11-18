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
  highlighted at every level; inside cards, added lines are green and removed lines show inline,
  struck through, where they were (toggle with **Show removed lines** in the canvas toolbar). Functions the change deletes stay
  on the canvas as dashed "ghost" cards, read from the old version of the file, which VisualCode
  rebuilds by applying the diff in reverse.
  Pin comments to any block, file or folder. Comments are saved in the browser (IndexedDB) and can
  be exported as Markdown or JSON, and imported again from JSON.
- **Changes**: every changed block of the change set as one story across files, with the file path
  on each card. Order it by **call flow**, **foundations first** (called code before its callers),
  **tests first** or **largest first**.
- **Impact**: the details panel's Impact tab lists who calls a block (or imports a file), grouped
  by file, and the tests that reach it through up to three calls. Changed cards show their caller
  count.
- **System design**: the **System** view shows the project's apps, data stores, brokers and external
  services, and how they connect. It is read from docker compose and Kubernetes files, package
  manifests, client libraries in the code (Postgres, MySQL, MongoDB, Redis, Kafka, RabbitMQ, S3),
  connection URLs, and HTTP calls matched to the routes other apps serve. Every part links to the
  lines it was found in. Add, connect, move and remove parts; edits are saved in the browser.
  Adding Postgres, MongoDB, Redis, Kafka, RabbitMQ or S3 opens a step-by-step guide for one of your
  apps: the package for its language (TypeScript, Python, Go, Java), the compose service, the
  environment variables, the client code, and the exact blocks to change (for Redis: the functions
  that read from the database, to cache). With a Claude key, Claude can draft those changes.
  Export the design as **Mermaid** or **Structurizr DSL** (C4).
- **Optional AI**: paste a Claude API key in Settings to get **Explain** and **Suggest review
  notes** on a block. Answers are saved as comments. The key goes from the browser straight to
  the Anthropic API.

Inputs: a public GitHub repo, folder or pull request URL; a local folder or `.zip`; pasted code
and/or a pasted diff.

## Languages

| Language | Parser | Cross-file links |
| --- | --- | --- |
| JavaScript / TypeScript | TypeScript compiler API | relative imports |
| Python | line-based parser | absolute and relative imports |
| Java, Kotlin | Tree-sitter | package imports, same-package classes |
| Go | Tree-sitter | package imports (folders), same-package names |
| C# | Tree-sitter | types by name (namespaces do not map to files) |
| Rust | Tree-sitter | `use` paths and `mod` declarations |
| C, C++ | Tree-sitter | `#include "…"`, functions by name |
| PHP | Tree-sitter | `use` (PSR-4-style paths), `require`/`include` |
| Ruby | Tree-sitter | `require` / `require_relative`, constants by name |
| Swift | Tree-sitter | types by name (module-wide) |

Methods declared away from their type are attached to it: Go receivers, Rust `impl` blocks, Swift
`extension`s, C++ `Type::method` definitions, reopened Ruby and partial C# classes. In languages with
an implicit `this`, a bare call inside a class finds the class's own method first. Where a language
has no file-level import (packages, namespaces, C linkage), a call that is still unresolved links to a
definition with that name if exactly one exists in the same folder, then in the project; ambiguous
names stay unlinked rather than guessed.

Any other code or config file (shell, SQL, YAML, HTML, CSS, Scala, Dart, Lua, …) is shown as one
whole-file block, so its changes are never hidden in a review.

Tree-sitter grammars are loaded only for the languages a project contains and are cached for offline
use the first time they are needed.

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
  -> changes diff lines mapped onto files and blocks; old file versions rebuilt for deleted blocks
  -> views   folder map (edges lifted to visible nodes)  |  file storyline (flow order)
             changes story (all changed blocks)  |  system design (detected + edited)
```

| Path | Responsibility |
| --- | --- |
| `src/parse/` | Language registry, TS and Python parsers, Tree-sitter engine and per-language specs, module-level sections |
| `src/diff/` | Unified diff parsing (git and plain) |
| `src/graph/` | Graph building, per-language import resolution, call resolution, change index, map view, storyline order, review order |
| `src/analysis/` | Pipeline that turns a `Project` into an `Analysis` |
| `src/ingest/` | GitHub, folder/zip/drop and paste loaders |
| `src/review/` | Notes and viewed-state storage, Markdown/JSON export and import |
| `src/state/` | Workspace store (reducer + context) and keyboard shortcuts |
| `src/ui/` | Design-system primitives: Button, badges, fields, segmented control, dialog, toasts, logo |
| `src/app/` | App shell: top bar, left rail (Outline / Review), canvas area, inspector, welcome, dialogs, search |
| `src/canvas/` | Map canvas, storyline canvas (block cards, flow arrows, layout) and system canvas (components, details panel, catalog, export) |
| `src/system/` | System design: detection, technology catalog with integration guides, integration plans, saved edits, layout, Mermaid and Structurizr export |
| `src/styles/` | `tokens.css` (generated from the design system) and global base styles |
| `src/demo/` | The built-in demo project |

## Security and privacy

VisualCode has no server: GitHub Pages serves the app's files and everything runs in your browser.

- **Loaded code stays in the page.** A folder, zip or paste is read in memory and never uploaded or
  stored. GitHub code is fetched by your browser from `api.github.com` and `raw.githubusercontent.com`.
  Code is parsed and shown as text, never run.
- **Only three outside hosts.** The built app carries a Content-Security-Policy that lets the page
  connect only to itself, GitHub and `api.anthropic.com`, so even a compromised dependency could not
  send code elsewhere.
- **Claude asks first.** Before Explain, Suggest review notes or a draft, a dialog lists exactly which
  files and lines will be sent. "Don't ask again" is remembered per project until you clear its data.
- **Keys stay in the tab by default.** The Claude key and GitHub token are kept until the tab closes;
  choose "On this device" in Settings to keep them longer. Either way they are unencrypted, and every
  page on the same address can read them. On `*.github.io` that includes the owner's other Pages sites,
  so use a read-only GitHub token and a Claude key with a spending limit.
- **Clear your data.** Settings → Data in this browser deletes one project's notes, viewed marks,
  system edits and AI permission, or everything including keys.

## Design system

The UI follows the **VisualCode Design System** ("margin ink"): one ink colour for the reading path, change colours only for changes, code as the hero. Tokens live in `src/styles/tokens.css`; components use CSS modules that read only those tokens. Light and dark themes are both first-class, and every text pair meets WCAG AA in both.

## Keyboard

| Key | Action |
| --- | --- |
| Ctrl/⌘ K | Search blocks, files and commands |
| J / K | Next / previous step in the storyline |
| N / Shift N | Next / previous changed block |
| V | Mark the selected block viewed |
| C | Write a note on the selected block |
| M | Switch Map / Story (Changes and System are in the view switch) |
| F | Fit the canvas |
| Esc | Clear the selection, otherwise go up one level |
| ? | All shortcuts |

## Known limitations (POC)

- Call resolution is name-based, not type-based. It handles local functions, imports, `this`/`self`
  methods and `Type.method`. A call through a variable links only when the variable is named after
  its class (`cart.total()` with an imported `Cart`); other variables, dynamic dispatch, path
  aliases (`@/…`) and library code stay unlinked.
- System detection reads conventions, not running systems: apps come from compose, Kubernetes and
  manifests; connections from client libraries, connection URLs and HTTP calls whose paths match a
  route another app defines. Calls built from runtime values, service meshes and infrastructure
  defined elsewhere (Terraform, cloud consoles) are not seen; add those parts by hand.
- Nested types and functions are part of their enclosing block rather than blocks of their own.
- The Python parser is line-based: nested functions are part of their parent block, and only
  methods directly inside top-level classes become their own blocks.
- A pasted diff must match the loaded code's **new** version (load the PR head, not the base).
- GitHub loading supports public repositories only; refs containing `/` are not supported in
  `…/tree/<ref>/…` URLs. Very large repos need a sub-folder URL.
- Phones get a read-only view (no commenting); the app is designed for desktop.
- The review checklist (viewed state and progress) can be turned off in Settings.
