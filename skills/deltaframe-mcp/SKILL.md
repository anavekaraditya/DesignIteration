---
name: deltaframe-mcp
description: Use when implementing code from DeltaFrame section iteration changelogs via MCP, including fetching section timelines, reading latest deltas, mapping design changes to code edits, and marking iterations implemented.
---

# DeltaFrame MCP

Use DeltaFrame as design-change memory for Figma-to-code work. DeltaFrame complements Figma MCP: DeltaFrame answers what changed between section iterations; Figma MCP answers what the full selected design looks like now.

## Workflow

1. Confirm the DeltaFrame backend and MCP server are available. The MCP server usually points at `DELTAFRAME_API_URL=http://localhost:8788`.
2. Call `list_sections` to find the tracked design section family.
3. Call `get_section_timeline` when you need baseline and iteration history.
4. Call `get_latest_section_delta` with `include_drafts: true` during active collaboration, or without drafts for approved implementation work.
5. Call `get_section_agent_brief` before editing code. Treat it as the compact source of truth for changed nodes, implementation notes, confidence, and impact.
6. Edit only the code affected by the delta. Preserve unrelated UI behavior.
7. If a brief is ambiguous, confidence is below `0.7`, or the code requires exact layout context, fetch the affected node with Figma MCP before changing code.
8. After the code change is complete, call `mark_iteration_implemented` with the iteration id and a concise implementation reference.

## Rules

- Prefer section-aware tools over older project/checkpoint tools.
- Do not infer design changes that are not present in the DeltaFrame delta or confirmed through Figma MCP.
- Use `approved` deltas for production work. Use draft deltas only when the designer is actively asking for iteration help.
- Pay special attention to `copy`, `layout`, `style`, `token`, `component`, `visibility`, and `structure` categories; they map to different code surfaces.
- Low-confidence matches usually mean a copied or renamed Figma layer was semantically matched. Verify exact context before broad refactors.
- If DeltaFrame reports no implementation-relevant changes, do not re-read or rebuild the whole design unless the user explicitly asks.

## Change Mapping

- `copy_only`: update text, labels, placeholders, aria labels, or localized content.
- `layout_update`: update spacing, dimensions, responsive constraints, alignment, grid/flex behavior, or layout tokens.
- `style_token_update`: update colors, typography, radii, shadows, borders, or token bindings.
- `component_api_change`: update component props, variants, states, slots, or instance mappings.
- `code_required`: add/show/render changed UI elements.
- `removed_element`: remove/hide/deprecate affected UI elements.
- `needs_clarification`: inspect Figma MCP context or ask the user before implementation.
