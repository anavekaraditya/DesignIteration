import { groupDesignerChanges } from "./designerChanges.js";
import type { Change, ChangeCategory, ChangeImpact, Changelog, DesignerChange, RawDiff } from "./types.js";

export type ChangelogInput = {
  id: string;
  projectId: string;
  sectionId?: string;
  iterationId?: string;
  fromCheckpointId: string;
  toCheckpointId: string;
  title: string;
  diffs: RawDiff[];
  createdAt?: string;
};

export function generateChangelog(input: ChangelogInput): Changelog {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const designerChanges = groupDesignerChanges(input.diffs);
  const changes = designerChanges.map((change, index) => designerChangeToChange(input.id, change, index + 1));
  const summary = summarizeChanges(changes);
  const markdown = renderChangelogMarkdown(input.title, summary, changes);

  return {
    id: input.id,
    projectId: input.projectId,
    sectionId: input.sectionId,
    iterationId: input.iterationId,
    fromCheckpointId: input.fromCheckpointId,
    toCheckpointId: input.toCheckpointId,
    title: input.title,
    summary,
    status: "draft",
    changes,
    markdown,
    createdAt
  };
}

export function designerChangeToChange(changelogId: string, designerChange: DesignerChange, order: number): Change {
  const needsReview = designerChange.confidence < 0.7;
  return {
    id: `${changelogId}_change_${order}`,
    changelogId,
    category: designerChange.category,
    impact: needsReview ? "needs_clarification" : designerChange.impact,
    nodeId: designerChange.nodeId,
    nodePath: designerChange.nodePath,
    before: designerChange.before,
    after: designerChange.after,
    implementationNote: needsReview
      ? `${designerChange.summary} ${designerChange.implementationHint} Review match: ${designerChange.matchReason ?? "low confidence semantic match"}.`
      : `${designerChange.summary} ${designerChange.implementationHint}`,
    confidence: designerChange.confidence,
    approved: !needsReview && designerChange.impact !== "needs_clarification"
  };
}

export function diffToChange(changelogId: string, diff: RawDiff, order: number): Change {
  const category = categoryForDiff(diff);
  const impact = impactForDiff(diff, category);

  return {
    id: `${changelogId}_change_${order}`,
    changelogId,
    category,
    impact,
    nodeId: diff.nodeId,
    nodePath: diff.nodePath,
    before: diff.before,
    after: diff.after,
    implementationNote: implementationNoteForDiff(diff, impact),
    confidence: confidenceForDiff(diff),
    approved: impact !== "needs_clarification"
  };
}

export function renderChangelogMarkdown(title: string, summary: string, changes: Change[]): string {
  const groups = [
    ["Code changes required", changes.filter((change) => change.impact === "code_required")],
    ["Copy-only changes", changes.filter((change) => change.impact === "copy_only")],
    [
      "Style/token changes",
      changes.filter((change) => change.impact === "style_token_update" || change.impact === "layout_update")
    ],
    ["Component/API changes", changes.filter((change) => change.impact === "component_api_change")],
    ["No implementation impact", changes.filter((change) => change.impact === "no_implementation_impact")]
  ] as const;

  const body = groups
    .filter(([, groupChanges]) => groupChanges.length > 0)
    .map(([heading, groupChanges]) => {
      const entries = groupChanges
        .map((change, index) => {
          const before = change.before === undefined ? "" : `\n- Before: \`${formatValue(change.before)}\``;
          const after = change.after === undefined ? "" : `\n- After: \`${formatValue(change.after)}\``;
          return `#### ${index + 1}. ${change.implementationNote}\n- Node: \`${change.nodePath}\`${before}${after}\n- Impact: \`${change.impact}\``;
        })
        .join("\n\n");
      return `### ${heading}\n${entries}`;
    })
    .join("\n\n");

  return `# DeltaFrame Changelog\n\n## ${title}\n\n### Summary\n${summary}\n\n${body}`;
}

export function buildAgentBrief(changelog: Changelog): string {
  const relevant = changelog.changes.filter((change) => change.approved && change.impact !== "no_implementation_impact");
  const noImpact = changelog.changes.filter((change) => change.impact === "no_implementation_impact");
  const required = relevant
    .map(
      (change, index) =>
        `${index + 1}. [${change.category}/${change.impact}, confidence ${change.confidence}] ${change.implementationNote} (${change.nodePath})`
    )
    .join("\n");
  const skipped = noImpact.map((change) => `- ${change.implementationNote} (${change.nodePath})`).join("\n");

  return [
    "# Design Delta Brief",
    changelog.summary,
    "",
    "Required code changes:",
    required || "None.",
    "",
    "No implementation needed:",
    skipped || "None.",
    "",
    "Affected nodes:",
    relevant.map((change) => `- ${change.nodeId}: ${change.nodePath}`).join("\n") || "None.",
    "",
    "Implementation rule:",
    "Update only the code touched by these deltas. If a change is ambiguous or confidence is below 0.7, inspect the affected Figma node before editing."
  ].join("\n");
}

function categoryForDiff(diff: RawDiff): ChangeCategory {
  if (diff.kind === "added" || diff.kind === "removed") return "structure";
  if (diff.property === "text") return "copy";
  if (diff.property.startsWith("typography")) return "style";
  if (diff.property === "fills" || diff.property === "strokes" || diff.property === "effects" || diff.property === "cornerRadius") {
    return "style";
  }
  if (diff.property === "variables") return "token";
  if (diff.property.startsWith("component.")) return "component";
  if (diff.property === "visible") return "visibility";
  if (["width", "height", "x", "y", "constraints"].includes(diff.property) || diff.property.startsWith("layout.")) return "layout";
  if (diff.property === "name") return "unknown";
  return "unknown";
}

function impactForDiff(diff: RawDiff, category: ChangeCategory): ChangeImpact {
  if (diff.kind === "removed") return "removed_element";
  if (diff.kind === "added") return "code_required";
  if (category === "copy") return "copy_only";
  if (category === "style" || category === "token") return "style_token_update";
  if (category === "layout") return "layout_update";
  if (category === "component") return "component_api_change";
  if (category === "visibility") return "code_required";
  if (diff.property === "name") return "no_implementation_impact";
  return "needs_clarification";
}

function implementationNoteForDiff(diff: RawDiff, impact: ChangeImpact): string {
  const target = nodeLabel(diff);
  const before = formatValue(diff.before);
  const after = formatValue(diff.after);

  if (diff.kind === "added") return `Add ${target} to the implementation.`;
  if (diff.kind === "removed") return `Remove ${target} from the implementation.`;
  if (diff.property === "text") {
    return `Update copy for ${target} from "${String(diff.before ?? "")}" to "${String(diff.after ?? "")}".`;
  }
  if (diff.property === "visible") {
    return diff.after === false ? `Hide or conditionally remove ${target}.` : `Show or render ${target}.`;
  }
  if (diff.property.startsWith("typography.")) {
    return `Update ${propertyLabel(diff.property)} for ${target} from ${before} to ${after}.`;
  }
  if (diff.property === "fills" || diff.property === "strokes" || diff.property === "effects" || diff.property === "cornerRadius") {
    return `Update ${propertyLabel(diff.property)} styling for ${target} from ${before} to ${after}.`;
  }
  if (diff.property === "variables") {
    return `Update design token bindings for ${target} from ${before} to ${after}.`;
  }
  if (diff.property.startsWith("component.")) {
    return `Update ${propertyLabel(diff.property)} for ${target} from ${before} to ${after}.`;
  }
  if (diff.property === "width" || diff.property === "height") {
    return `Resize ${target}: ${diff.property} changed from ${before}px to ${after}px.`;
  }
  if (diff.property === "x" || diff.property === "y") {
    return `Reposition ${target}: ${diff.property} changed from ${before}px to ${after}px.`;
  }
  if (diff.property.startsWith("layout.")) {
    return `Update auto-layout ${propertyLabel(diff.property)} for ${target} from ${before} to ${after}.`;
  }
  if (diff.property === "constraints") {
    return `Update responsive constraints for ${target} from ${before} to ${after}.`;
  }
  if (impact === "no_implementation_impact") return `No implementation change needed for ${target}; only the layer name changed.`;
  return `Review ${propertyLabel(diff.property)} change for ${target} from ${before} to ${after}.`;
}

function confidenceForDiff(diff: RawDiff): number {
  const matchConfidence = diff.matchConfidence ?? 1;
  let propertyConfidence = 0.72;
  if (["text", "visible", "variables"].includes(diff.property) || diff.property.startsWith("component.")) propertyConfidence = 0.95;
  if (["width", "height", "fills", "strokes"].includes(diff.property) || diff.property.startsWith("layout.")) propertyConfidence = 0.86;
  if (diff.property.startsWith("typography.")) propertyConfidence = 0.88;
  if (diff.property === "name") propertyConfidence = 0.65;
  if (diff.kind === "added" || diff.kind === "removed") propertyConfidence = 0.9;
  return Math.round(Math.min(propertyConfidence, Math.max(matchConfidence, 0.45)) * 100) / 100;
}

function summarizeChanges(changes: Change[]): string {
  if (changes.length === 0) return "No implementation-relevant changes detected.";
  const counts = changes.reduce<Record<string, number>>((acc, change) => {
    acc[change.category] = (acc[change.category] ?? 0) + 1;
    return acc;
  }, {});
  return `Detected ${changes.length} change${changes.length === 1 ? "" : "s"}: ${Object.entries(counts)
    .map(([category, count]) => `${count} ${category}`)
    .join(", ")}.`;
}

function nodeLabel(diff: RawDiff): string {
  const label = diff.afterNodePath ?? diff.beforeNodePath ?? diff.nodePath ?? diff.nodeName;
  return `\`${label}\``;
}

function propertyLabel(property: string): string {
  const labels: Record<string, string> = {
    "typography.fontFamily": "font family",
    "typography.fontStyle": "font style",
    "typography.fontWeight": "font weight",
    "typography.fontSize": "font size",
    "typography.lineHeightPx": "line height",
    "typography.letterSpacing": "letter spacing",
    fills: "fill",
    strokes: "stroke",
    effects: "effect",
    cornerRadius: "corner radius",
    "layout.mode": "mode",
    "layout.primaryAxisSizingMode": "primary axis sizing",
    "layout.counterAxisSizingMode": "counter axis sizing",
    "layout.primaryAxisAlignItems": "primary axis alignment",
    "layout.counterAxisAlignItems": "counter axis alignment",
    "layout.paddingLeft": "left padding",
    "layout.paddingRight": "right padding",
    "layout.paddingTop": "top padding",
    "layout.paddingBottom": "bottom padding",
    "layout.itemSpacing": "item spacing",
    "component.key": "component key",
    "component.mainComponentId": "main component reference",
    "component.variantProperties": "variant properties",
    "component.componentProperties": "instance component properties"
  };
  return labels[property] ?? property;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "unset";
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
