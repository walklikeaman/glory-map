# Codebase Structure

**Analysis Date:** 2026-07-21

## Directory Layout

```text
glory-map/
├── app/                    # Executable Next.js App Router surface
│   ├── layout.jsx          # Root metadata and HTML/body shell
│   └── page.jsx            # Server-rendered `/` readiness page
├── config/                 # Cross-runtime MCP server catalog
│   └── mcp.json
├── Context/                # Immutable raw knowledge inbox
│   └── clipped/            # Web clips and other captured source material
├── docs/                   # Long-form architecture reference and static team site
│   ├── agent-framework.md
│   └── index.html
├── notes/                  # Unstructured team/agent scratch notes
├── prompts/                # Repository copies of Codex slash-command workflows
├── wiki/                   # Agent-maintained durable knowledge graph
│   ├── concepts/           # Topic and workflow pages
│   ├── entities/           # Person, service, and component pages
│   ├── sources/            # Summaries of raw Context inputs
│   ├── index.md            # Knowledge catalog; read first
│   ├── log.md              # Newest-first operation journal
│   └── overview.md         # One-page project synthesis
├── .codex/                 # Repository-scoped Codex automation
│   └── hooks.json
├── .loops/                 # Persistent quality-loop state
│   ├── guardrails.md
│   └── reflexion.md
├── .obsidian/              # Shared Obsidian vault/graph configuration
├── .planning/codebase/     # Generated GSD codebase map
├── AGENTS.md               # Always-read agent contract and scope gate
├── TASKS.md                # Team ownership, task board, and data contract
├── TEAMWORK.md             # Branch, role, and integration rules
├── README.md               # Repository overview and quick start
├── GUIDE.md                # Complete teammate onboarding guide
├── INSTALL.md              # Clean-machine installation checklist
├── PREFLIGHT.md             # Short pre-event setup checklist
├── IDEAS.md                # Candidate project briefs and prompts
├── TEAM.md                 # Chat-ready teammate onboarding message
├── setup.sh                # Machine/tool/MCP bootstrap
├── scaffold.sh             # App dependency and local-env bootstrap
├── package.json            # Next.js package and command manifest
├── package-lock.json       # Locked npm dependency graph
├── next.config.mjs         # Next.js configuration
└── vercel.json             # Vercel framework selection
```

The root is both the Next.js application root and the agent workspace root. Do not look for a nested `src/`, `frontend/`, or `app/package.json`; executable application code starts directly at `app/`, while operating procedures and durable agent state live beside it.

## Directory Purposes

**`app/`:**
- Purpose: Hold the complete executable Next.js App Router application.
- Contains: Framework-reserved route files and future route segments, route handlers, layouts, loading states, and error boundaries.
- Key files: `app/page.jsx`, `app/layout.jsx`

**`config/`:**
- Purpose: Store tool configuration intended for alternate coding-agent runtimes.
- Contains: A JSON catalog of CodeGraph, Supabase, Vercel, and Playwright MCP servers.
- Key files: `config/mcp.json`

**`Context/`:**
- Purpose: Receive raw briefs, exports, screenshots, transcripts, and web clips without modifying their source form.
- Contains: Placeholder files and future source artifacts; browser-clipped content belongs in `Context/clipped/`.
- Key files: `Context/.gitkeep`, `Context/clipped/.gitkeep`

**`docs/`:**
- Purpose: Publish project method documentation and a static onboarding page independent of Next.js.
- Contains: The reference operating framework and a self-contained bilingual HTML/CSS/JavaScript guide.
- Key files: `docs/agent-framework.md`, `docs/index.html`

**`notes/`:**
- Purpose: Hold unstructured short-lived notes that do not yet belong in the task board or knowledge graph.
- Contains: Free-form Markdown notes.
- Key files: `notes/README.md`

**`prompts/`:**
- Purpose: Version reusable Codex command workflows before `setup.sh` copies them to `~/.codex/prompts/`.
- Contains: Autopilot, shipping, quality-loop, schema, UI-polish, and pitch prompt files.
- Key files: `prompts/autopilot.md`, `prompts/ship.md`, `prompts/loop-demo.md`, `prompts/loop-lint.md`, `prompts/loop-debug.md`, `prompts/schema.md`

**`wiki/`:**
- Purpose: Persist agent-derived knowledge, decisions, relationships, and operation history.
- Contains: The catalog, synthesis, newest-first log, and the `sources/`, `entities/`, and `concepts/` graph partitions.
- Key files: `wiki/index.md`, `wiki/overview.md`, `wiki/log.md`

**`.codex/`:**
- Purpose: Hold repository-scoped Codex runtime automation.
- Contains: Session lifecycle hooks only; there are no project-local skills under `.codex/skills/`.
- Key files: `.codex/hooks.json`

**`.loops/`:**
- Purpose: Persist learned constraints and debug attempts used by command loops.
- Contains: Permanent guardrails and the current/reflexive debugging record.
- Key files: `.loops/guardrails.md`, `.loops/reflexion.md`

**`.obsidian/`:**
- Purpose: Make the repository a shared Obsidian vault with a graph focused on the knowledge partitions.
- Contains: Shared application, plugin, and graph settings; per-user workspace state remains ignored.
- Key files: `.obsidian/app.json`, `.obsidian/core-plugins.json`, `.obsidian/graph.json`

**`.planning/codebase/`:**
- Purpose: Provide machine-readable/current-state guidance to later GSD planning and execution workflows.
- Contains: Architecture, structure, stack, integration, convention, testing, and concern maps as generated by the mapper run.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `app/page.jsx`: Root `/` route and current user-visible product surface.
- `app/layout.jsx`: Root document wrapper for every App Router route.
- `package.json`: `dev`, `build`, and `start` command entry points.
- `setup.sh`: Machine and integration setup entry point.
- `scaffold.sh`: Local application setup entry point.
- `.codex/hooks.json`: Codex SessionStart entry point.
- `prompts/*.md`: Slash-command entry points after prompt installation.
- `docs/index.html`: Independent static onboarding entry point.

**Configuration:**
- `AGENTS.md`: Project scope, behavioral constraints, startup ritual, knowledge rules, and safety gates.
- `TASKS.md`: Current ownership, work queue, and data contract.
- `TEAMWORK.md`: Branching and integration contract.
- `package.json`: Runtime dependencies and npm commands.
- `package-lock.json`: Reproducible npm resolution.
- `next.config.mjs`: Next.js configuration; currently an empty configuration object.
- `vercel.json`: Vercel framework declaration.
- `config/mcp.json`: Optional MCP configuration catalog for Cursor users.
- `.codex/hooks.json`: Repository Codex hook configuration.
- `.gitignore`: Secret, dependency, build, editor, tool-index, and scratch exclusions.
- `.env.example`: Tracked environment-variable template; note its existence without placing values in documentation.

**Core Logic:**
- `app/page.jsx`: Current application logic; checks public configuration presence and renders status.
- `app/layout.jsx`: Global render shell and metadata.
- `setup.sh`: CLI installation, MCP registration, and prompt installation logic.
- `scaffold.sh`: Dependency installation and non-overwriting local-environment seeding.
- `docs/index.html`: Static guide language switching and copy-to-clipboard logic.
- `prompts/autopilot.md`: End-to-end autonomous task workflow.
- `prompts/ship.md`: Safe stage/commit/push/verify workflow.
- `prompts/loop-*.md`: Reusable verification and recovery loops.

**Testing:**
- Not detected: the repository has no test directory, test files, test runner configuration, or `test` npm script (`package.json`).
- Build verification uses `npm run build` from `package.json`; agent loop selection is described in `prompts/loop-lint.md`.

**Knowledge and Coordination:**
- `wiki/index.md`: First lookup point for existing knowledge.
- `wiki/log.md`: Durable operation history.
- `wiki/overview.md`: Project synthesis.
- `Context/`: Immutable source intake.
- `.loops/guardrails.md`: Permanent constraints.
- `.loops/reflexion.md`: Failed debug attempt history.
- `TASKS.md`: Team task board and shared API/data contract.

**Human Documentation:**
- `README.md`: Repository purpose, quick start, and top-level map.
- `GUIDE.md`: Consolidated team guide.
- `INSTALL.md`: Full setup checklist.
- `PREFLIGHT.md`: Short pre-hackathon checklist.
- `IDEAS.md`: Candidate product briefs.
- `TEAM.md`: Short onboarding message for team chat.
- `docs/agent-framework.md`: Detailed reference architecture for the agent operating method.
- `docs/index.html`: Static bilingual onboarding page.

## Naming Conventions

**Files:**
- Use Next.js App Router reserved lowercase names for route modules: `app/page.jsx` and `app/layout.jsx`; add `route.js`, `loading.jsx`, `error.jsx`, and nested `page.jsx` only for their framework-defined roles.
- Use PascalCase for extracted React component files under a component directory, for example `app/components/StatusCard.jsx`; the current route components are named through reserved framework filenames rather than component names.
- Use lowercase kebab-case for reusable prompt commands: `prompts/loop-docs-sync.md`, `prompts/ui-polish.md`, and `prompts/ship.md`. Prefix iterative gates with `loop-`.
- Use lowercase kebab-case slugs for future knowledge pages such as `wiki/concepts/data-contract.md`, matching the slug guidance in `docs/agent-framework.md`.
- Use uppercase descriptive names for root operational/team documents: `AGENTS.md`, `TASKS.md`, `TEAMWORK.md`, `GUIDE.md`, `INSTALL.md`, `PREFLIGHT.md`, and `IDEAS.md`.
- Use lowercase action names for shell entry points: `setup.sh` and `scaffold.sh`.
- Use UPPERCASE names for GSD codebase-map documents under `.planning/codebase/`, including `ARCHITECTURE.md` and `STRUCTURE.md`.

**Directories:**
- Preserve framework-reserved lowercase directories such as `app/` and domain-neutral lowercase operational directories such as `prompts/`, `wiki/`, `notes/`, `config/`, and `docs/`.
- Preserve the capitalized `Context/` path exactly; it is the canonical immutable inbox named throughout `AGENTS.md`, `.obsidian/app.json`, and the documentation.
- Use hidden dot-directories for tool-owned configuration/state: `.codex/`, `.loops/`, `.obsidian/`, and `.planning/`.
- Use plural knowledge partitions exactly as established: `wiki/sources/`, `wiki/entities/`, and `wiki/concepts/`.

## Where to Add New Code

**New User-Facing Route:**
- Primary code: `app/<route>/page.jsx`
- Route-specific layout: `app/<route>/layout.jsx` only when the route needs a shell distinct from `app/layout.jsx`.
- Route status boundaries: `app/<route>/loading.jsx` and `app/<route>/error.jsx` when asynchronous work is introduced.
- Tests: Not established; define the test convention alongside the first test runner configuration rather than scattering ad hoc files.

**New API Endpoint:**
- Implementation: `app/api/<endpoint>/route.js`
- Shared server logic: `lib/<service>.js` in a newly established `lib/` directory; keep privileged environment access there and import it from route handlers, not client components.
- Contract: Record request/response shape in `TASKS.md` before frontend/backend parallel work, as required by `TEAMWORK.md:22`.

**New Component/Module:**
- Shared React component: `app/components/<PascalCase>.jsx`; create `app/components/` with the first genuinely reused component.
- Route-local component: `app/<route>/_components/<PascalCase>.jsx`; underscore-prefix keeps support code visually distinct from route segments.
- Shared layout or metadata: Extend `app/layout.jsx` only for behavior required by all routes.
- Avoid adding abstraction-only directories before a second consumer exists; the simplicity rule is defined in `AGENTS.md:23`.

**New External Integration:**
- Server-only client: `lib/<provider>.js` once the first endpoint needs it.
- HTTP boundary: `app/api/<feature>/route.js`.
- MCP/operator configuration: `setup.sh` for Codex registration and `config/mcp.json` for alternate runtimes.
- Environment names: Add names only to `.env.example`; keep all actual values in ignored local/server environment storage governed by `.gitignore` and `AGENTS.md:116`.

**New Database Schema:**
- Gate: Fill the scope and demo path in `AGENTS.md` and the data contract in `TASKS.md` before adding schema artifacts.
- Migration location: Establish `supabase/migrations/` with the first checked-in migration if the project chooses local Supabase migrations; do not create the directory speculatively.
- Operational workflow: Follow `prompts/schema.md` for minimal schema design and `prompts/loop-migrate.md` for migration verification.

**New Prompt/Workflow:**
- General command: `prompts/<command>.md`
- Iterative quality gate: `prompts/loop-<gate>.md`
- Installation path: Keep `setup.sh:104` as the copy mechanism to `~/.codex/prompts/`; do not hand-maintain a divergent global-only version.
- Durable lessons: Add project constraints to `.loops/guardrails.md` and reusable decisions to `wiki/log.md` / `wiki/concepts/`, not to code comments.

**New Knowledge:**
- Raw material: `Context/<source>` or `Context/clipped/<source>`; do not edit after intake.
- Source synthesis: `wiki/sources/<slug>.md`
- Named actors/services/components: `wiki/entities/<slug>.md`
- Rules, workflows, and topics: `wiki/concepts/<slug>.md`
- Catalog and operation record: Update `wiki/index.md` and prepend `wiki/log.md` in the same ingest operation.

**New Documentation:**
- Repository quick-start change: `README.md`
- Complete team instruction change: `GUIDE.md`
- Installation-specific change: `INSTALL.md` or `PREFLIGHT.md`
- Agent-method reference change: `docs/agent-framework.md`
- Public static onboarding change: Update both language trees and any matching interaction code in `docs/index.html`; cross-check repeated facts against `GUIDE.md`, `IDEAS.md`, and `TEAMWORK.md` using `prompts/loop-docs-sync.md`.

**Utilities:**
- Shared application helpers: Create `lib/<purpose>.js` only when logic is used by more than one route/module.
- One-off investigation: Use ignored `_probe_*` files at the repository root or a temporary directory, then remove them before shipping according to `.gitignore` and `prompts/loop-de-sloppify.md`.
- Machine bootstrap helpers: Keep setup-only shell functions inside `setup.sh` unless they gain a second caller.

## Special Directories

**`Context/`:**
- Purpose: Immutable human-owned raw source inbox.
- Generated: No; populated by people or capture tools.
- Committed: Yes; directory placeholders are tracked, and future source sensitivity must be assessed before commit.

**`wiki/`:**
- Purpose: Agent-owned, cross-linked, durable knowledge base.
- Generated: Partly; pages are synthesized by agents from real work and sources.
- Committed: Yes; `wiki/index.md`, `wiki/log.md`, and `wiki/overview.md` are tracked.

**`prompts/`:**
- Purpose: Repository source for slash commands copied into each operator's Codex configuration.
- Generated: No; maintained as project workflow code.
- Committed: Yes; all current prompt files are tracked.

**`.loops/`:**
- Purpose: Persistent learning state for verification/debug loops.
- Generated: Entries are produced by agent workflows; seed documents are maintained manually.
- Committed: Yes; both `.loops/guardrails.md` and `.loops/reflexion.md` are tracked.

**`.obsidian/`:**
- Purpose: Shared human visualization configuration for the knowledge graph.
- Generated: No for the tracked shared settings; Obsidian may create per-user workspace files.
- Committed: Partly; shared JSON files are tracked, while `.obsidian/workspace.json` and `.obsidian/workspace-mobile.json` are ignored by `.gitignore`.

**`.codex/`:**
- Purpose: Repository-specific Codex lifecycle automation.
- Generated: No.
- Committed: Yes; `.codex/hooks.json` is tracked.

**`docs/`:**
- Purpose: Reference documentation and static GitHub Pages-compatible onboarding.
- Generated: No; `docs/index.html` is a hand-maintained standalone artifact.
- Committed: Yes; `docs/agent-framework.md` and `docs/index.html` are tracked.

**`.planning/codebase/`:**
- Purpose: Current-state map consumed by GSD planning and execution agents.
- Generated: Yes; produced by the codebase mapping workflow.
- Committed: No at analysis time; the orchestrator owns subsequent git operations.

**Ignored Runtime Directories:**
- Purpose: Hold local dependencies, builds, deployments, indexes, and optional generated graphs.
- Generated: Yes; `node_modules/`, `.next/`, `.vercel/`, `.codegraph/`, `dist/`, `build/`, and `graphify-out/` are tool outputs listed in `.gitignore`.
- Committed: No; none is tracked, and none is present in the analyzed checkout.

---

*Structure analysis: 2026-07-21*
