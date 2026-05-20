# Figma Control — Figma MCP Safety and Changelog Skill

## Purpose

When you use Figma MCP to make changes to a Figma file, follow these two rules without exception.

These rules exist because Figma writes are harder to review and recover than normal text/code edits. The designer needs control before the change and a clear record after the change.

---

## Rule 1 — Pre-flight Confirmation

Before calling any Figma MCP tool, plugin API, or agent action that writes to, modifies, creates, deletes, duplicates, moves, resizes, reorders, or rearranges nodes in a Figma file:

1. Stop before executing.
2. Inspect the current node state first if needed so old values are known.
3. Output a `FIGMA CONTROL PRE-FLIGHT` block in this exact shape.
4. Wait for explicit user approval before writing.

Exception: if the user's original prompt clearly says to proceed without confirmation, for example "go ahead", "do it", "make the change", or "no need to confirm", skip pre-flight approval and still output the changelog afterward.

```text
---FIGMA CONTROL PRE-FLIGHT---
I am about to make the following changes to your Figma file:

Frame: [frame name]
  - [layer name]  |  [designer-level event]  |  [current value] → [new value]
  - [layer name]  |  [designer-level event]  |  [current value] → [new value]

Frame: [frame name]
  - [layer name]  |  [designer-level event]  |  [current value] → [new value]

Total: [N] changes across [M] frames.
Shall I proceed?
---END PRE-FLIGHT---
```

If the current value cannot be determined after inspection, write `unknown`; do not omit the field.

---

## Rule 2 — Post-write Changelog

Immediately after completing all Figma write operations in a single response, output a `FIGMA CONTROL CHANGELOG` block.

```text
---FIGMA CONTROL CHANGELOG---
file:      [Figma file name, or unknown]
timestamp: [date and time]
version_history: [Figma file URL or version history URL, or unavailable]

changes:

  Frame: [frame name]
    - layer:     [layer name]
      property:  [designer-level event]
      from:      [old value]
      to:        [new value]

    - layer:     [layer name]
      property:  [designer-level event]
      from:      [old value]
      to:        [new value]

  Frame: [frame name]
    - layer:     [layer name]
      property:  [designer-level event]
      from:      [old value]
      to:        [new value]

summary:   [N] changes across [M] frames.
           [One plain-English sentence about what was done.]
---END CHANGELOG---
```

Changelog rules:

- List every node/property changed. No hidden grouping.
- Use designer-level event names, not raw property names.
- Include old and new values for every entry.
- If the old value is unknown, write `unknown`.
- Always include the `version_history` field. If the agent cannot construct the URL, write `unavailable` and mention how the user can verify through Figma history.

---

## Designer-level Event Vocabulary

Translate raw Figma properties into these event names:

- `moved`: x or y position changed
- `resized`: width or height changed
- `padding changed`: paddingTop, paddingRight, paddingBottom, or paddingLeft changed
- `gap changed`: itemSpacing changed
- `color changed`: fill color or stroke color changed
- `opacity changed`: opacity changed
- `font changed`: fontFamily, fontWeight, fontSize, line height, or letter spacing changed
- `copy changed`: text content changed
- `variant changed`: component variant or component property changed
- `added`: new node created
- `removed`: node deleted
- `hidden`: visibility set to false
- `shown`: visibility set to true
- `reordered`: layer order or z-index changed
- `renamed`: node name changed
- `corner changed`: cornerRadius changed
- `border changed`: stroke weight, stroke color, or stroke style changed

---

## What Counts as a Write Operation

Apply these rules to any action that modifies a Figma file, including:

- creating frames, components, layers, sections, instances, or text nodes
- updating node properties
- changing fills, strokes, effects, typography, copy, variables, styles, variants, or component properties
- moving, resizing, duplicating, grouping, ungrouping, reordering, hiding, showing, renaming, or deleting nodes
- importing assets or replacing images
- any tool whose result changes Figma document content

Read-only inspection, such as fetching file context, node context, variables, comments, screenshots, or metadata, does not trigger pre-flight or changelog requirements.

---

## Partial Failure

If any Figma write fails or only partially completes:

1. Stop immediately.
2. Do not retry silently.
3. Output a `FIGMA CONTROL PARTIAL CHANGELOG` listing everything that succeeded before the failure.
4. State what failed and why.
5. Ask the user how to proceed.

```text
---FIGMA CONTROL PARTIAL CHANGELOG---
file:      [Figma file name, or unknown]
timestamp: [date and time]
version_history: [Figma file URL or version history URL, or unavailable]

completed_changes:
  Frame: [frame name]
    - layer:     [layer name]
      property:  [designer-level event]
      from:      [old value]
      to:        [new value]

failed_change:
  Frame: [frame name]
  Layer: [layer name]
  Intended property: [designer-level event]
  Reason: [error or failure reason]

Next step: Please tell me whether to retry, stop, or adjust the change.
---END PARTIAL CHANGELOG---
```

---

## Tone

Be specific and brief. The pre-flight is a confirmation, not a design rationale.

Wrong:

```text
I will update the button to make it more visible per your request for better CTA prominence.
```

Right:

```text
Hero Section | CTA Button | resized       | height 44px → height 56px
Hero Section | CTA Button | color changed | #9CA3AF → #1A56DB
```
