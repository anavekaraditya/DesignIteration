import { stableStringify } from "./hash.js";
import type { ChangeCategory, ChangeImpact, DesignerChange, DesignerChangeType, RawDiff } from "./types.js";

type DiffGroup = {
  key: string;
  diffs: RawDiff[];
};

type DesignerEventInput = {
  type: DesignerChangeType;
  diffs: RawDiff[];
  category: ChangeCategory;
  impact: ChangeImpact;
  summary: string;
  implementationHint: string;
  before?: unknown;
  after?: unknown;
};

const PADDING_PROPS = [
  "layout.paddingLeft",
  "layout.paddingRight",
  "layout.paddingTop",
  "layout.paddingBottom"
];

const TYPOGRAPHY_PROPS = [
  "typography.fontFamily",
  "typography.fontStyle",
  "typography.fontWeight",
  "typography.fontSize",
  "typography.lineHeightPx",
  "typography.letterSpacing"
];

const LAYOUT_PROPS = [
  "layout.mode",
  "layout.primaryAxisSizingMode",
  "layout.counterAxisSizingMode",
  "layout.primaryAxisAlignItems",
  "layout.counterAxisAlignItems",
  "constraints"
];

const COLOR_PROPS = ["fills", "strokes", "effects", "cornerRadius"];
const COMPONENT_PROPS = ["component.key", "component.mainComponentId", "component.variantProperties", "component.componentProperties"];

export function groupDesignerChanges(diffs: RawDiff[]): DesignerChange[] {
  const groups = groupDiffs(diffs.filter((diff) => diff.property !== "name"));
  const changes = groups.flatMap((group) => groupToDesignerChanges(group));
  return changes.sort((a, b) => impactSort(a.impact) - impactSort(b.impact) || a.nodePath.localeCompare(b.nodePath));
}

function groupDiffs(diffs: RawDiff[]): DiffGroup[] {
  const groups = new Map<string, RawDiff[]>();
  for (const diff of diffs) {
    const key = diff.afterNodeId ?? diff.beforeNodeId ?? diff.nodeId;
    groups.set(key, [...(groups.get(key) ?? []), diff]);
  }
  return [...groups.entries()].map(([key, groupDiffs]) => ({ key, diffs: groupDiffs }));
}

function groupToDesignerChanges(group: DiffGroup): DesignerChange[] {
  const remaining = [...group.diffs];
  const events: DesignerEventInput[] = [];

  const removed = pull(remaining, (diff) => diff.kind === "removed");
  for (const diff of removed) {
    events.push({
      type: "element_removed",
      diffs: [diff],
      category: "structure",
      impact: "removed_element",
      summary: `${nodeName(diff)} was removed.`,
      implementationHint: "Remove or hide this UI element in code.",
      before: diff.before,
      after: diff.after
    });
  }

  const added = pull(remaining, (diff) => diff.kind === "added");
  for (const diff of added) {
    events.push({
      type: "element_added",
      diffs: [diff],
      category: "structure",
      impact: "code_required",
      summary: `${nodeName(diff)} was added.`,
      implementationHint: "Add this UI element or state to the implementation.",
      before: diff.before,
      after: diff.after
    });
  }

  const text = pull(remaining, (diff) => diff.property === "text");
  for (const diff of text) {
    events.push({
      type: "copy_changed",
      diffs: [diff],
      category: "copy",
      impact: "copy_only",
      summary: `${nodeName(diff)} copy changed from "${String(diff.before ?? "")}" to "${String(diff.after ?? "")}".`,
      implementationHint: "Update the displayed copy.",
      before: diff.before,
      after: diff.after
    });
  }

  const visibility = pull(remaining, (diff) => diff.property === "visible");
  for (const diff of visibility) {
    const hidden = diff.after === false;
    events.push({
      type: "visibility_changed",
      diffs: [diff],
      category: "visibility",
      impact: "code_required",
      summary: `${nodeName(diff)} was ${hidden ? "hidden" : "shown"}.`,
      implementationHint: hidden ? "Hide or conditionally remove this UI." : "Render or reveal this UI.",
      before: diff.before,
      after: diff.after
    });
  }

  const movement = pull(remaining, (diff) => diff.property === "x" || diff.property === "y");
  if (movement.length > 0) {
    const x = movement.find((diff) => diff.property === "x");
    const y = movement.find((diff) => diff.property === "y");
    events.push({
      type: "moved",
      diffs: movement,
      category: "layout",
      impact: "layout_update",
      summary: `${nodeName(movement[0])} moved ${movementSummary(x, y)}.`,
      implementationHint: "Update positioning, alignment, or surrounding layout spacing.",
      before: compactValues(movement, "before"),
      after: compactValues(movement, "after")
    });
  }

  const size = pull(remaining, (diff) => diff.property === "width" || diff.property === "height");
  if (size.length > 0) {
    const width = size.find((diff) => diff.property === "width");
    const height = size.find((diff) => diff.property === "height");
    events.push({
      type: "resized",
      diffs: size,
      category: "layout",
      impact: "layout_update",
      summary: `${nodeName(size[0])} ${resizeSummary(width, height)}.`,
      implementationHint: "Update dimensions, constraints, or responsive sizing.",
      before: compactValues(size, "before"),
      after: compactValues(size, "after")
    });
  }

  const padding = pull(remaining, (diff) => PADDING_PROPS.includes(diff.property));
  if (padding.length > 0) {
    events.push({
      type: "spacing_changed",
      diffs: padding,
      category: "layout",
      impact: "layout_update",
      summary: `${nodeName(padding[0])} padding changed: ${propertyListSummary(padding)}.`,
      implementationHint: "Update container padding or spacing tokens.",
      before: compactValues(padding, "before"),
      after: compactValues(padding, "after")
    });
  }

  const itemSpacing = pull(remaining, (diff) => diff.property === "layout.itemSpacing");
  if (itemSpacing.length > 0) {
    const diff = itemSpacing[0];
    events.push({
      type: "spacing_changed",
      diffs: itemSpacing,
      category: "layout",
      impact: "layout_update",
      summary: `${nodeName(diff)} spacing changed from ${formatPx(diff.before)} to ${formatPx(diff.after)}.`,
      implementationHint: "Update gap, stack spacing, or spacing token.",
      before: diff.before,
      after: diff.after
    });
  }

  const typography = pull(remaining, (diff) => TYPOGRAPHY_PROPS.includes(diff.property));
  if (typography.length > 0) {
    events.push({
      type: "typography_changed",
      diffs: typography,
      category: "style",
      impact: "style_token_update",
      summary: `${nodeName(typography[0])} font changed: ${propertyListSummary(typography)}.`,
      implementationHint: "Update type style, text component props, or typography tokens.",
      before: compactValues(typography, "before"),
      after: compactValues(typography, "after")
    });
  }

  const color = pull(remaining, (diff) => COLOR_PROPS.includes(diff.property));
  if (color.length > 0) {
    events.push({
      type: "color_changed",
      diffs: color,
      category: "style",
      impact: "style_token_update",
      summary: `${nodeName(color[0])} visual styling changed: ${propertyListSummary(color)}.`,
      implementationHint: "Update color, border, shadow, radius, or visual style tokens.",
      before: compactValues(color, "before"),
      after: compactValues(color, "after")
    });
  }

  const layout = pull(remaining, (diff) => LAYOUT_PROPS.includes(diff.property));
  if (layout.length > 0) {
    events.push({
      type: "layout_changed",
      diffs: layout,
      category: "layout",
      impact: "layout_update",
      summary: `${nodeName(layout[0])} layout behavior changed: ${propertyListSummary(layout)}.`,
      implementationHint: "Update layout mode, alignment, sizing, or constraints.",
      before: compactValues(layout, "before"),
      after: compactValues(layout, "after")
    });
  }

  const component = pull(remaining, (diff) => COMPONENT_PROPS.includes(diff.property));
  if (component.length > 0) {
    events.push({
      type: "component_variant_changed",
      diffs: component,
      category: "component",
      impact: "component_api_change",
      summary: `${nodeName(component[0])} variant or component properties changed: ${propertyListSummary(component)}.`,
      implementationHint: "Update component props, selected variant, or instance mapping.",
      before: compactValues(component, "before"),
      after: compactValues(component, "after")
    });
  }

  const tokens = pull(remaining, (diff) => diff.property === "variables");
  if (tokens.length > 0) {
    events.push({
      type: "token_changed",
      diffs: tokens,
      category: "token",
      impact: "style_token_update",
      summary: `${nodeName(tokens[0])} design token bindings changed: ${propertyListSummary(tokens)}.`,
      implementationHint: "Update token references or mapped theme values.",
      before: compactValues(tokens, "before"),
      after: compactValues(tokens, "after")
    });
  }

  for (const diff of remaining) {
    events.push({
      type: diff.kind === "renamed" ? "renamed" : "unknown_changed",
      diffs: [diff],
      category: diff.kind === "renamed" ? "unknown" : "layout",
      impact: diff.kind === "renamed" ? "no_implementation_impact" : "needs_clarification",
      summary: `${nodeName(diff)} changed.`,
      implementationHint: diff.kind === "renamed" ? "No implementation change is needed unless this name is part of handoff." : "Review this change before implementation.",
      before: diff.before,
      after: diff.after
    });
  }

  return events.map((event, index) => makeDesignerChange(group.key, event, index + 1));
}

function makeDesignerChange(groupKey: string, event: DesignerEventInput, index: number): DesignerChange {
  const first = event.diffs[0];
  const confidence = Math.round(Math.min(...event.diffs.map((diff) => diff.matchConfidence ?? 1)) * 100) / 100;
  return {
    id: `${groupKey}:${event.type}:${index}`,
    type: event.type,
    category: event.category,
    impact: event.impact,
    nodeId: first.afterNodeId ?? first.beforeNodeId ?? first.nodeId,
    nodePath: first.afterNodePath ?? first.beforeNodePath ?? first.nodePath,
    nodeName: first.nodeName,
    summary: event.summary,
    implementationHint: event.implementationHint,
    before: event.before,
    after: event.after,
    rawDiffIds: event.diffs.map((diff) => diff.id),
    confidence,
    matchReason: confidence < 0.7 ? first.matchReason : undefined
  };
}

function pull(diffs: RawDiff[], predicate: (diff: RawDiff) => boolean): RawDiff[] {
  const pulled: RawDiff[] = [];
  for (let index = diffs.length - 1; index >= 0; index -= 1) {
    const diff = diffs[index];
    if (!predicate(diff)) continue;
    pulled.unshift(diff);
    diffs.splice(index, 1);
  }
  return pulled;
}

function nodeName(diff: RawDiff): string {
  return diff.nodeName || lastPathSegment(diff.nodePath);
}

function movementSummary(x?: RawDiff, y?: RawDiff): string {
  const parts: string[] = [];
  if (x) parts.push(direction(Number(x.after) - Number(x.before), "right", "left"));
  if (y) parts.push(direction(Number(y.after) - Number(y.before), "down", "up"));
  return parts.join(" and ");
}

function resizeSummary(width?: RawDiff, height?: RawDiff): string {
  const parts: string[] = [];
  if (width) parts.push(sizeDirection("width", Number(width.after) - Number(width.before)));
  if (height) parts.push(sizeDirection("height", Number(height.after) - Number(height.before)));
  return parts.join(" and ");
}

function direction(delta: number, positive: string, negative: string): string {
  const amount = Math.abs(Math.round(delta * 100) / 100);
  return `${delta >= 0 ? positive : negative} by ${amount}px`;
}

function sizeDirection(label: string, delta: number): string {
  const amount = Math.abs(Math.round(delta * 100) / 100);
  return `${label} ${delta >= 0 ? "increased" : "decreased"} by ${amount}px`;
}

function propertyListSummary(diffs: RawDiff[]): string {
  return diffs.map((diff) => `${propertyLabel(diff.property)} from ${formatValue(diff.before)} to ${formatValue(diff.after)}`).join(", ");
}

function compactValues(diffs: RawDiff[], side: "before" | "after"): Record<string, unknown> {
  return Object.fromEntries(diffs.map((diff) => [propertyLabel(diff.property), diff[side]]));
}

function propertyLabel(property: string): string {
  const labels: Record<string, string> = {
    x: "horizontal position",
    y: "vertical position",
    width: "width",
    height: "height",
    "layout.paddingLeft": "left padding",
    "layout.paddingRight": "right padding",
    "layout.paddingTop": "top padding",
    "layout.paddingBottom": "bottom padding",
    "layout.itemSpacing": "spacing",
    "layout.mode": "layout mode",
    "layout.primaryAxisSizingMode": "primary axis sizing",
    "layout.counterAxisSizingMode": "counter axis sizing",
    "layout.primaryAxisAlignItems": "primary axis alignment",
    "layout.counterAxisAlignItems": "counter axis alignment",
    "typography.fontFamily": "font family",
    "typography.fontStyle": "font style",
    "typography.fontWeight": "font weight",
    "typography.fontSize": "font size",
    "typography.lineHeightPx": "line height",
    "typography.letterSpacing": "letter spacing",
    fills: "fill",
    strokes: "stroke",
    effects: "effects",
    cornerRadius: "corner radius",
    constraints: "constraints",
    "component.key": "component key",
    "component.mainComponentId": "main component",
    "component.variantProperties": "variant properties",
    "component.componentProperties": "component properties",
    variables: "tokens"
  };
  return labels[property] ?? property;
}

function formatPx(value: unknown): string {
  return typeof value === "number" ? `${value}px` : formatValue(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return `${value}px`;
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (value === undefined) return "unset";
  return stableStringify(value);
}

function lastPathSegment(path: string): string {
  const parts = path.split(" / ");
  return parts[parts.length - 1] ?? path;
}

function impactSort(impact: ChangeImpact): number {
  const order: ChangeImpact[] = [
    "code_required",
    "removed_element",
    "copy_only",
    "layout_update",
    "style_token_update",
    "component_api_change",
    "new_state_or_variant",
    "needs_clarification",
    "prototype_only",
    "no_implementation_impact"
  ];
  return order.indexOf(impact) === -1 ? 99 : order.indexOf(impact);
}
