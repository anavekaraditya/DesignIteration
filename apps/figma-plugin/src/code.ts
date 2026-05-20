import { normalizeFigmaRestExport } from "@deltaframe/core/normalizer";

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

sendSelection();
figma.on("selectionchange", sendSelection);

figma.ui.onmessage = async (message: { type: string; payload?: unknown }) => {
  if (message.type === "export-selection") {
    await exportSelection();
  }
  if (message.type === "tag-selection") {
    tagSelection(message.payload as TagPayload);
  }
  if (message.type === "write-changelog-frame") {
    await writeChangelogFrame(message.payload as ChangelogFramePayload);
  }
};

function sendSelection(): void {
  const selection = figma.currentPage.selection.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    sectionId: node.getSharedPluginData("deltaframe", "sectionId") || undefined,
    iterationId: node.getSharedPluginData("deltaframe", "iterationId") || undefined,
    changelogFrameId: node.getSharedPluginData("deltaframe", "changelogFrameId") || undefined
  }));
  figma.ui.postMessage({ type: "selection", payload: selection });
}

async function exportSelection(): Promise<void> {
  const node = figma.currentPage.selection[0];
  if (!node) {
    figma.ui.postMessage({ type: "error", payload: "Select a frame, component, or instance before exporting." });
    return;
  }

  try {
    const rawSnapshot = await node.exportAsync({ format: "JSON_REST_V1" });
    const screenshotBytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
    const normalizedTree = normalizeFigmaRestExport(rawSnapshot);
    figma.ui.postMessage({
      type: "snapshot",
      payload: {
        figmaNodeId: node.id,
        nodeName: node.name,
        sectionId: node.getSharedPluginData("deltaframe", "sectionId") || undefined,
        iterationId: node.getSharedPluginData("deltaframe", "iterationId") || undefined,
        changelogFrameId: node.getSharedPluginData("deltaframe", "changelogFrameId") || undefined,
        screenshotPngBase64: bytesToBase64(screenshotBytes),
        normalizedTree
      }
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      payload: error instanceof Error ? error.message : "Failed to export selected node."
    });
  }
}

type TagPayload = {
  sectionId?: string;
  iterationId?: string;
  changelogFrameId?: string;
};

type ChangelogFramePayload = {
  sectionId: string;
  iterationId: string;
  changelogId: string;
  title: string;
  summary: string;
  status?: string;
  matchConfidence?: number;
  matchReason?: string;
  changes: Array<{
    impact: string;
    nodePath: string;
    implementationNote: string;
    confidence: number;
  }>;
};

function tagSelection(payload: TagPayload): void {
  const node = figma.currentPage.selection[0];
  if (!node) {
    figma.ui.postMessage({ type: "error", payload: "Select the section frame before tagging it." });
    return;
  }
  if (payload.sectionId) node.setSharedPluginData("deltaframe", "sectionId", payload.sectionId);
  if (payload.iterationId) node.setSharedPluginData("deltaframe", "iterationId", payload.iterationId);
  if (payload.changelogFrameId) node.setSharedPluginData("deltaframe", "changelogFrameId", payload.changelogFrameId);
  sendSelection();
}

async function writeChangelogFrame(payload: ChangelogFramePayload): Promise<void> {
  const selected = figma.currentPage.selection[0];
  if (!selected || !("x" in selected) || !("y" in selected) || !("width" in selected)) {
    figma.ui.postMessage({ type: "error", payload: "Select the iteration frame before writing the changelog." });
    return;
  }

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });

  const existingId = selected.getSharedPluginData("deltaframe", "changelogFrameId");
  const existing = existingId ? figma.currentPage.findOne((node) => node.id === existingId && node.type === "FRAME") : null;
  const frame = existing && existing.type === "FRAME" ? existing : figma.createFrame();
  frame.name = `DeltaFrame Changelog - ${payload.title}`;
  frame.resize(360, 520);
  frame.x = selected.x + selected.width + 48;
  frame.y = selected.y;
  frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  frame.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.85, b: 0.89 } }];
  frame.cornerRadius = 12;
  frame.clipsContent = false;
  frame.setSharedPluginData("deltaframe", "sectionId", payload.sectionId);
  frame.setSharedPluginData("deltaframe", "iterationId", payload.iterationId);
  frame.setSharedPluginData("deltaframe", "changelogId", payload.changelogId);
  frame.setSharedPluginData("deltaframe", "kind", "changelogFrame");

  for (const child of [...frame.children]) child.remove();

  let y = 24;
  const addText = (text: string, size: number, weight: "Regular" | "Semi Bold", color = { r: 0.12, g: 0.14, b: 0.17 }) => {
    const node = figma.createText();
    node.fontName = { family: "Inter", style: weight };
    node.fontSize = size;
    node.characters = text;
    node.fills = [{ type: "SOLID", color }];
    node.x = 24;
    node.y = y;
    node.resize(312, Math.max(24, node.height));
    frame.appendChild(node);
    y += node.height + 12;
  };

  addText("DeltaFrame Changelog", 18, "Semi Bold");
  addText(payload.status === "approved" ? "Approved" : "Draft", 11, "Semi Bold", { r: 0.08, g: 0.35, b: 0.72 });
  addText(payload.title, 13, "Semi Bold", { r: 0.22, g: 0.25, b: 0.3 });
  addText(payload.summary || "No summary available.", 12, "Regular", { r: 0.28, g: 0.31, b: 0.36 });
  addText(`MCP ID: ${payload.changelogId}`, 10, "Regular", { r: 0.43, g: 0.46, b: 0.52 });
  if (payload.matchConfidence !== undefined && payload.matchConfidence < 0.72) {
    addText(`Match confidence: ${payload.matchConfidence}. ${payload.matchReason ?? "Review selected section."}`, 10, "Regular", { r: 0.64, g: 0.38, b: 0.08 });
  }

  for (const change of payload.changes.slice(0, 8)) {
    addText(change.impact.replace(/_/g, " "), 11, "Semi Bold", { r: 0.08, g: 0.35, b: 0.72 });
    addText(`${change.implementationNote}\n${change.nodePath}`, 10, "Regular", { r: 0.24, g: 0.27, b: 0.32 });
    if (y > 470) break;
  }

  selected.setSharedPluginData("deltaframe", "sectionId", payload.sectionId);
  selected.setSharedPluginData("deltaframe", "iterationId", payload.iterationId);
  selected.setSharedPluginData("deltaframe", "changelogFrameId", frame.id);

  figma.ui.postMessage({ type: "changelog-frame-written", payload: { changelogFrameId: frame.id } });
  sendSelection();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
