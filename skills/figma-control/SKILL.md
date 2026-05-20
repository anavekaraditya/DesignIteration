---
name: figma-control
description: Use whenever a task may write to, modify, create, delete, move, resize, reorder, or otherwise change Figma content through Figma MCP or another Figma automation tool. Enforces Figma Control pre-flight confirmation before Figma writes and a structured changelog after Figma writes.
---

# Figma Control

Use this skill before any Figma write through MCP or another Figma automation tool.

Read and follow `figma-control.md` in this folder. It contains the portable, model-neutral Figma Control rules.

## Required Behavior

1. Before any Figma write, inspect current node state if needed.
2. Output a `FIGMA CONTROL PRE-FLIGHT` block.
3. Wait for explicit approval unless the user already clearly said to proceed.
4. Perform the Figma write only after approval or explicit opt-out.
5. Output a `FIGMA CONTROL CHANGELOG` immediately after all writes complete.
6. If any write fails or partially completes, stop and output a `FIGMA CONTROL PARTIAL CHANGELOG`.

## Boundary

Read-only Figma inspection does not require pre-flight. Any action that changes Figma document content does.

Treat Figma writes as higher-risk than normal code edits because they can be difficult to audit or recover after the session ends.
