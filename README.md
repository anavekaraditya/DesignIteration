# Figma Control

Figma MCP safety and changelog rules for AI agents.

Figma Control v1 is intentionally small: one portable skill file that makes any AI agent ask before it changes Figma and report exactly what it changed afterward.

> No AI agent should silently change a Figma file.

## What v1 Solves

Figma MCP lets AI agents write directly to design files. That is powerful, but risky:

- the agent may change more than you expected;
- Figma undo may not help after the session moves on;
- version history gives visual snapshots, not a structured list of changes;
- small edits such as copy, spacing, opacity, or variant changes are easy to miss.

Figma Control v1 teaches the agent two behaviors:

1. **Pre-flight confirmation** before Figma writes.
2. **Post-write changelog** after Figma writes.

That is the complete v1.

## Repository Layout

```text
skills/
  figma-control/
    figma-control.md       Portable model-neutral rules file
    SKILL.md            Codex-compatible skill wrapper
    agents/openai.yaml  Skill UI metadata
  figma-control-future-mcp/       Future-track backend/MCP changelog skill
docs/
  figma-control-v1-evaluation.md
apps/
packages/
```

The existing `apps/` and `packages/` plugin/backend prototype remains in the repo as deferred experimental work. It is not the v1 product focus.

## Install

### Claude Code

Copy the portable rules file into your project:

```bash
mkdir -p .claude/skills/figma-control
cp skills/figma-control/figma-control.md .claude/skills/figma-control/figma-control.md
```

Or paste the contents of `skills/figma-control/figma-control.md` into your Claude project instructions.

### Cursor

Copy the same rules file into Cursor rules:

```bash
mkdir -p .cursor/rules
cp skills/figma-control/figma-control.md .cursor/rules/figma-control.md
```

### OpenAI Codex

Use the local Codex skill folder:

```text
skills/figma-control/SKILL.md
```

Or paste the contents of `skills/figma-control/figma-control.md` into the system/developer instructions for any agent that has Figma MCP write access.

### Any Other Agent

Paste `figma-control.md` into the agent's persistent rules, project instructions, or system prompt.

The skill does not require a backend, plugin, database, Gemini key, or Figma plugin install.

## Rule 1: Pre-flight Confirmation

Before any Figma write operation, the agent must output:

```text
---FIGMA CONTROL PRE-FLIGHT---
I am about to make the following changes to your Figma file:

Frame: Hero — Desktop
  - CTA Button  |  resized       |  height 44px → height 56px
  - CTA Button  |  color changed |  #9CA3AF → #1A56DB
  - CTA Button  |  copy changed  |  "Get Started" → "Start Free Trial"

Total: 3 changes across 1 frame.
Shall I proceed?
---END PRE-FLIGHT---
```

The agent must wait for explicit approval before writing unless the original prompt already clearly says to proceed, such as "go ahead", "do it", or "no need to confirm".

## Rule 2: Post-write Changelog

After all Figma writes complete, the agent must output:

```text
---FIGMA CONTROL CHANGELOG---
file:      My Product Design System
timestamp: 2026-05-19 14:32 UTC
version_history: https://www.figma.com/file/aBcDeFgH/My-Product-Design-System

changes:

  Frame: Hero — Desktop
    - layer:     CTA Button
      property:  resized
      from:      height 44px
      to:        height 56px

    - layer:     CTA Button
      property:  color changed
      from:      #9CA3AF
      to:        #1A56DB

    - layer:     CTA Button
      property:  copy changed
      from:      "Get Started"
      to:        "Start Free Trial"

summary:   3 changes across 1 frame.
           Updated CTA size, color, and copy in the desktop hero.
---END CHANGELOG---
```

The changelog must list every changed node/property individually and use designer-level event names such as `moved`, `resized`, `color changed`, `copy changed`, `hidden`, `shown`, `added`, or `removed`.

## What Counts as a Figma Write

The rules apply to any action that changes Figma content:

- create, update, duplicate, move, resize, reorder, hide, show, rename, or delete nodes;
- change fills, strokes, copy, typography, variables, styles, variants, component properties, effects, or images;
- import assets or replace images.

Read-only Figma inspection does not trigger the rules.

## Evaluation

Use [docs/figma-control-v1-evaluation.md](docs/figma-control-v1-evaluation.md) to test whether an agent follows the skill.

The v1 pass criteria are simple:

- the agent stops before Figma writes;
- the pre-flight tells you what will change;
- the changelog tells you what changed;
- partial failures are reported safely.

## Not in v1

Do not build these until the safety skill is tested on real Figma MCP prompts:

- persistent changelog storage;
- automatic Figma version snapshots;
- plugin UI inside Figma;
- semantic intent prompts;
- LLM/Gemini synthesis;
- backend MCP changelog delivery;
- revert-from-changelog.

## Future Track

The older plugin/backend prototype can still become a future Figma Control product if v1 proves useful. That future track may include stored changelog timelines, Figma plugin review UI, MCP tools for approved deltas, and implementation loop-closing.

For now, v1 is one file and two rules.
