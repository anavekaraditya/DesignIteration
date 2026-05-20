# DeltaFrame

Implementation-aware changelogs for Figma-to-code workflows.

DeltaFrame is a private beta scaffold for a Figma plugin, backend, shared diff engine, MCP server, and Codex skill. It helps designers save a Figma section as a baseline, copy that section for iterations, generate a visible changelog frame beside the iteration, and expose the section timeline to AI coding agents.

## Workspace

```text
apps/
  figma-plugin/   Figma plugin main thread and framework-free UI
  server/         Hono API with file-backed SQLite via sql.js
  mcp-server/     MCP stdio server for AI coding agents
packages/
  core/           Shared schemas, normalizer, diff engine, changelog logic
skills/
  deltaframe-mcp/ Codex skill for consuming DeltaFrame MCP tools
```

## Quick Start

```bash
npm install
npm run build
npm test
npm run dev:server
```

The backend defaults to `http://localhost:8787` and persists to `data/deltaframe.sqlite`.
For local Figma testing on the alternate port:

```bash
PORT=8788 npm run dev:server
```

## Figma Plugin

Build the plugin:

```bash
npm run build -w @deltaframe/figma-plugin
```

In Figma Desktop, import `apps/figma-plugin/manifest.json` as a development plugin. The default plugin flow is output-driven:

1. Select a top-level section frame/component.
2. Click `Create changelog`.
3. If it is new, DeltaFrame saves it as a baseline.
4. Copy the section and make a design iteration.
5. Select the iteration and click `Create changelog`.
6. DeltaFrame smart-matches the section, compares against the previous iteration, and writes a draft changelog frame beside it.
7. Optionally review/edit the changelog and approve it so MCP can serve it.

Advanced settings keep the API URL, Gemini key, manual section picker, and manual baseline/iteration controls available for beta debugging.

## Gemini Visual Enhancement

DeltaFrame can optionally use Gemini to compare before/after checkpoint screenshots and improve the deterministic changelog. The deterministic Figma JSON diff still runs first; Gemini only rewrites the summary/implementation notes and can add obvious visual-only changes for designer review.

```bash
GEMINI_API_KEY=your_key_here GEMINI_MODEL=gemini-2.5-flash PORT=8788 npm run dev:server
```

If `GEMINI_API_KEY` is missing, DeltaFrame falls back to deterministic changelogs. The Figma plugin exports a PNG screenshot with each section iteration, stores it in the local beta database, and the backend sends the before/after images to Gemini during `POST /sections/:sectionId/iterations`.

The MCP server does not need a separate Gemini integration. Once a changelog is approved, MCP tools such as `get_section_agent_brief` and `get_latest_section_delta` automatically return the Gemini-enhanced changelog.

## Comparison Engine

DeltaFrame now compares iterations in the same spirit as a Figma MCP audit:

- Normalizes Figma `JSON_REST_V1` exports into stable trees with layout, typography, styling, token, component, and variable metadata.
- Semantically matches copied or renamed layers using node type, name similarity, text, component keys, main component ids, size, position, depth, and parent role.
- Diffs exact properties including copy, visibility, width/height, movement above 2px, auto-layout settings, padding, item spacing, fills, strokes, effects, corner radius, typography, variable bindings, variant props, and component props.
- Groups raw property diffs into designer-level events such as moved, resized, padding changed, spacing changed, color changed, font changed, copy changed, added, removed, hidden, and variant changed.
- Suggests likely section families for untagged copied iterations so the plugin can create changelogs without exposing an export step.
- Carries `matchConfidence` and `matchReason` into the changelog so low-confidence copied-layer matches can be reviewed before implementation.
- Uses Gemini only as an enhancement layer for summary quality, grouping, implementation notes, and obvious visual-only observations.

## MCP Server

Run the backend first, then run the MCP server:

```bash
DELTAFRAME_API_URL=http://localhost:8788 npm run dev:mcp
```

Tools exposed:

- `list_sections`
- `get_section_timeline`
- `get_latest_section_delta`
- `get_section_agent_brief`
- `mark_iteration_implemented`
- `list_projects`
- `list_checkpoints`
- `get_project_status`
- `list_changelogs`
- `get_latest_changelog`
- `get_changelog_by_id`
- `get_changes_since_checkpoint`
- `get_affected_nodes`
- `get_agent_brief`
- `mark_implemented`

## Codex Skill

The repo includes a local skill at `skills/deltaframe-mcp/SKILL.md`. Install or copy that skill into your Codex skills directory when you want Codex to automatically follow the DeltaFrame workflow:

1. `list_sections`
2. `get_section_timeline`
3. `get_latest_section_delta`
4. `get_section_agent_brief`
5. Use Figma MCP only for ambiguous or low-confidence affected nodes.
6. `mark_iteration_implemented`

## API Surface

- `GET /health`
- `GET /sections`
- `POST /sections/suggest-match`
- `POST /sections`
- `GET /sections/:sectionId/timeline`
- `POST /sections/:sectionId/iterations`
- `GET /sections/:sectionId/latest-delta`
- `GET /sections/:sectionId/agent-brief`
- `POST /iterations/:iterationId/implemented`
- `GET /projects`
- `GET /projects/:projectId/status`
- `GET /projects/:projectId/checkpoints`
- `GET /projects/:projectId/changelogs`
- `POST /checkpoints`
- `POST /compare`
- `GET /changelogs/:changelogId`
- `PATCH /changelogs/:changelogId`
- `POST /changelogs/:changelogId/approve`
- `POST /changelogs/:changelogId/implemented`
- `GET /projects/:projectId/latest-changelog`
- `GET /projects/:projectId/agent-brief`
- `GET /projects/:projectId/changes-since/:checkpointId`

## Shipping Notes

This repo is aimed at a private beta first. Before Figma Community submission, prepare a support contact, privacy policy, network access disclosure, demo file, and review checklist for empty selection, wrong node type, large files, deleted nodes, variants, and offline backend behavior.
