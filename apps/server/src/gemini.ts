import type { Change, Changelog, RawDiff, Snapshot } from "@deltaframe/core";

export type GeminiEnhancementInput = {
  changelog: Changelog;
  diffs: RawDiff[];
  beforeSnapshot: Snapshot;
  afterSnapshot: Snapshot;
  apiKey?: string;
};

type GeminiChangePatch = {
  nodeId?: string;
  nodePath?: string;
  category?: Change["category"];
  impact?: Change["impact"];
  before?: unknown;
  after?: unknown;
  implementationNote?: string;
  confidence?: number;
};

type GeminiResult = {
  summary?: string;
  changes?: GeminiChangePatch[];
};

const DEFAULT_MODEL = "gemini-2.5-flash";

export async function enhanceChangelogWithGemini(input: GeminiEnhancementInput): Promise<Changelog> {
  const apiKey = input.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) return input.changelog;
  if (!input.beforeSnapshot.screenshotPngBase64 || !input.afterSnapshot.screenshotPngBase64) return input.changelog;

  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: buildPrompt(input) },
            { inline_data: { mime_type: "image/png", data: input.beforeSnapshot.screenshotPngBase64 } },
            { inline_data: { mime_type: "image/png", data: input.afterSnapshot.screenshotPngBase64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    console.warn(`Gemini changelog enhancement failed: ${response.status} ${await response.text()}`);
    return input.changelog;
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) return input.changelog;

  try {
    return applyGeminiResult(input.changelog, JSON.parse(text) as GeminiResult);
  } catch (error) {
    console.warn("Gemini returned invalid changelog JSON.", error);
    return input.changelog;
  }
}

function buildPrompt(input: GeminiEnhancementInput): string {
  return [
    "You are DeltaFrame, an implementation-aware design changelog assistant.",
    "Compare the two screenshots and the deterministic Figma JSON diffs like a careful Figma MCP design audit.",
    "Your job is not to describe the whole screen. Your job is to sharpen the designer-level change log between the BEFORE iteration and the AFTER iteration.",
    "Return compact JSON only, with this shape:",
    '{"summary":"string","changes":[{"nodeId":"string optional","nodePath":"string","category":"copy|layout|style|token|component|variant|prototype|visibility|structure|asset|unknown","impact":"code_required|copy_only|style_token_update|layout_update|component_api_change|new_state_or_variant|removed_element|prototype_only|no_implementation_impact|needs_clarification","before":"optional","after":"optional","implementationNote":"developer-facing note","confidence":0.0}]}',
    "Rules:",
    "- Preserve deterministic diffs. Rewrite or group their implementation notes, but do not drop evidence-backed changes.",
    "- Use designer language first: moved, resized, padding changed, spacing changed, color changed, font changed, copy changed, added, removed, hidden, or variant changed.",
    "- Avoid raw property names such as layout.paddingLeft, typography.fontSize, fills, x, or y in implementationNote unless needed for debugging.",
    "- Use nodePath, beforeNodePath, afterNodePath, matchConfidence, and matchReason to understand renamed or copied layers.",
    "- Do not invent code component names unless visible or present in node paths.",
    "- Prefer implementation-relevant changes over cosmetic design commentary.",
    "- Use deterministic diffs as the source of truth when screenshots are ambiguous.",
    "- Add visual-only changes only when they are obvious in the screenshots and absent from JSON, such as image/content swaps or visual hierarchy shifts.",
    "- Mention exact values when available: text, px sizes, padding, spacing, font size, colors, variant props, token bindings.",
    "- Keep implementationNote actionable for frontend developers and coding agents.",
    "- Mark ambiguous visual observations as needs_clarification with confidence below 0.7.",
    "",
    "Existing draft changelog:",
    JSON.stringify(
      {
        summary: input.changelog.summary,
        changes: input.changelog.changes.map((change) => ({
          nodeId: change.nodeId,
          nodePath: change.nodePath,
          category: change.category,
          impact: change.impact,
          before: change.before,
          after: change.after,
          implementationNote: change.implementationNote,
          confidence: change.confidence
        }))
      },
      null,
      2
    ),
    "",
    "Deterministic diffs:",
    JSON.stringify(input.diffs, null, 2)
  ].join("\n");
}

function applyGeminiResult(changelog: Changelog, result: GeminiResult): Changelog {
  const changes = mergeChanges(changelog.id, changelog.changes, result.changes ?? []);
  const summary = result.summary?.trim() || changelog.summary;
  return {
    ...changelog,
    summary,
    changes,
    markdown: renderEnhancedMarkdown(changelog.title, summary, changes)
  };
}

function mergeChanges(changelogId: string, existing: Change[], patches: GeminiChangePatch[]): Change[] {
  const next = existing.map((change) => ({ ...change }));

  for (const patch of patches) {
    const matchIndex = next.findIndex(
      (change) =>
        (patch.nodeId && change.nodeId === patch.nodeId) ||
        (patch.nodePath && change.nodePath.toLowerCase() === patch.nodePath.toLowerCase())
    );

    if (matchIndex >= 0) {
      next[matchIndex] = {
        ...next[matchIndex],
        category: patch.category ?? next[matchIndex].category,
        impact: patch.impact ?? next[matchIndex].impact,
        before: patch.before ?? next[matchIndex].before,
        after: patch.after ?? next[matchIndex].after,
        implementationNote: patch.implementationNote ?? next[matchIndex].implementationNote,
        confidence: clampConfidence(patch.confidence ?? next[matchIndex].confidence)
      };
      continue;
    }

    if (!patch.nodePath || !patch.implementationNote) continue;
    next.push({
      id: `${changelogId}_gemini_${next.length + 1}`,
      changelogId,
      category: patch.category ?? "unknown",
      impact: patch.impact ?? "needs_clarification",
      nodeId: patch.nodeId ?? "visual-only",
      nodePath: patch.nodePath,
      before: patch.before,
      after: patch.after,
      implementationNote: patch.implementationNote,
      confidence: clampConfidence(patch.confidence ?? 0.7),
      approved: false
    });
  }

  return next;
}

function renderEnhancedMarkdown(title: string, summary: string, changes: Change[]): string {
  const lines = [`# DeltaFrame Changelog`, "", `## ${title}`, "", `### Summary`, summary];
  for (const change of changes) {
    lines.push(
      "",
      `### ${change.impact}`,
      `- Node: \`${change.nodePath}\``,
      `- Implementation: ${change.implementationNote}`,
      `- Confidence: ${change.confidence}`
    );
    if (change.before !== undefined) lines.push(`- Before: \`${formatValue(change.before)}\``);
    if (change.after !== undefined) lines.push(`- After: \`${formatValue(change.after)}\``);
  }
  return lines.join("\n");
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.max(0, Math.min(1, value));
}

function formatValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}
