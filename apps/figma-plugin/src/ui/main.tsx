import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Change, Changelog, Checkpoint, NormalizedNode } from "@deltaframe/core/types";
import "./styles.css";

type SelectionNode = { id: string; name: string; type: string };
type SnapshotPayload = {
  figmaNodeId: string;
  nodeName: string;
  rawSnapshot: unknown;
  normalizedTree: NormalizedNode;
};

type Screen = "home" | "save" | "compare" | "review" | "publish";

const DEFAULT_API_URL = "http://localhost:8787";

function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem("deltaframe.apiUrl") ?? DEFAULT_API_URL);
  const [projectId, setProjectId] = useState(() => localStorage.getItem("deltaframe.projectId") ?? "");
  const [projectName, setProjectName] = useState("DeltaFrame Beta Project");
  const [selection, setSelection] = useState<SelectionNode[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotPayload | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState("");
  const [screen, setScreen] = useState<Screen>("home");
  const [checkpointName, setCheckpointName] = useState("");
  const [description, setDescription] = useState("");
  const [isBaseline, setIsBaseline] = useState(false);
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [status, setStatus] = useState("Ready.");

  const selectedNode = selection[0];
  const canUseBackend = projectId.length > 0;

  useEffect(() => {
    window.onmessage = (event: MessageEvent) => {
      const message = event.data.pluginMessage;
      if (!message) return;
      if (message.type === "selection") setSelection(message.payload);
      if (message.type === "snapshot") {
        setSnapshot(message.payload);
        setCheckpointName(message.payload.nodeName);
        setStatus("Snapshot exported from Figma.");
      }
      if (message.type === "error") setStatus(message.payload);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("deltaframe.apiUrl", apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("deltaframe.projectId", projectId);
    void refreshCheckpoints(projectId);
  }, [projectId]);

  const groupedChanges = useMemo(() => {
    const groups: Record<string, Change[]> = {};
    for (const change of changelog?.changes ?? []) {
      const key = change.impact;
      groups[key] = (groups[key] ?? []).concat(change);
    }
    return groups;
  }, [changelog]);

  async function refreshCheckpoints(nextProjectId = projectId) {
    if (!nextProjectId) return;
    const response = await fetch(`${apiUrl}/projects/${nextProjectId}/checkpoints`);
    const data = await response.json();
    setCheckpoints(data.checkpoints ?? []);
  }

  function exportSelection() {
    setStatus("Exporting selected Figma node...");
    parent.postMessage({ pluginMessage: { type: "export-selection" } }, "*");
  }

  async function saveCheckpoint() {
    if (!snapshot) return setStatus("Export a snapshot first.");
    const response = await fetch(`${apiUrl}/checkpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: projectId || undefined,
        projectName,
        figmaNodeId: snapshot.figmaNodeId,
        name: checkpointName,
        description,
        isImplementationBaseline: isBaseline,
        rawSnapshot: snapshot.rawSnapshot,
        normalizedTree: snapshot.normalizedTree
      })
    });
    const data = await response.json();
    if (!response.ok) return setStatus(data.error ?? "Failed to save checkpoint.");
    setProjectId(data.project.id);
    setSelectedCheckpointId(data.checkpoint.id);
    setStatus(`Saved checkpoint ${data.checkpoint.name}.`);
    await refreshCheckpoints(data.project.id);
    setScreen("home");
  }

  async function generateChangelog() {
    if (!snapshot) return setStatus("Export the current selection first.");
    if (!projectId || !selectedCheckpointId) return setStatus("Choose a project checkpoint to compare against.");
    const response = await fetch(`${apiUrl}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        fromCheckpointId: selectedCheckpointId,
        current: {
          figmaNodeId: snapshot.figmaNodeId,
          name: checkpointName || `${snapshot.nodeName} current`,
          description,
          isImplementationBaseline: false,
          rawSnapshot: snapshot.rawSnapshot,
          normalizedTree: snapshot.normalizedTree
        }
      })
    });
    const data = await response.json();
    if (!response.ok) return setStatus(data.error ?? "Failed to compare checkpoints.");
    setChangelog(data.changelog);
    setStatus("Generated draft changelog.");
    setScreen("review");
    await refreshCheckpoints();
  }

  async function approveChangelog() {
    if (!changelog) return;
    await saveChangelogEdits();
    const response = await fetch(`${apiUrl}/changelogs/${changelog.id}/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return setStatus(data.error ?? "Failed to approve changelog.");
    setChangelog(data.changelog);
    setStatus("Approved and published to MCP.");
    setScreen("publish");
  }

  async function saveChangelogEdits() {
    if (!changelog) return;
    const response = await fetch(`${apiUrl}/changelogs/${changelog.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: changelog.title,
        summary: changelog.summary,
        changes: changelog.changes
      })
    });
    const data = await response.json();
    if (response.ok) setChangelog(data.changelog);
  }

  async function copy(text: string) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    setStatus("Copied.");
  }

  function updateChange(changeId: string, patch: Partial<Change>) {
    if (!changelog) return;
    setChangelog(
      Object.assign({}, changelog, {
        changes: changelog.changes.map((change) => (change.id === changeId ? Object.assign({}, change, patch) : change))
      })
    );
  }

  function removeChange(changeId: string) {
    if (!changelog) return;
    setChangelog(Object.assign({}, changelog, { changes: changelog.changes.filter((change) => change.id !== changeId) }));
  }

  return (
    <main>
      <header>
        <div>
          <h1>DeltaFrame</h1>
          <p>Implementation-aware design deltas.</p>
        </div>
        <span className="pill">Private beta</span>
      </header>

      <section className="settings">
        <label>
          API URL
          <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
        </label>
        <label>
          Project
          <input value={projectId || projectName} onChange={(event) => setProjectName(event.target.value)} />
        </label>
      </section>

      <nav>
        {(["home", "save", "compare", "review", "publish"] as Screen[]).map((item) => (
          <button key={item} className={screen === item ? "active" : ""} onClick={() => setScreen(item)}>
            {item}
          </button>
        ))}
      </nav>

      {screen === "home" && (
        <section>
          <h2>Current Selection</h2>
          <div className="selection">
            {selectedNode ? (
              <>
                <strong>{selectedNode.name}</strong>
                <span>{selectedNode.type}</span>
              </>
            ) : (
              <span>Select one frame, component, or instance.</span>
            )}
          </div>
          <div className="actions">
            <button onClick={exportSelection}>Export Snapshot</button>
            <button onClick={() => setScreen("save")} disabled={!snapshot}>
              Save Checkpoint
            </button>
            <button onClick={() => setScreen("compare")} disabled={!snapshot || !canUseBackend}>
              Compare
            </button>
          </div>
        </section>
      )}

      {screen === "save" && (
        <section>
          <h2>Save Checkpoint</h2>
          <label>
            Name
            <input value={checkpointName} onChange={(event) => setCheckpointName(event.target.value)} />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={isBaseline} onChange={(event) => setIsBaseline(event.target.checked)} />
            Mark as implementation baseline
          </label>
          <button onClick={saveCheckpoint} disabled={!snapshot || !checkpointName}>
            Save checkpoint
          </button>
        </section>
      )}

      {screen === "compare" && (
        <section>
          <h2>Compare</h2>
          <label>
            Previous checkpoint
            <select value={selectedCheckpointId} onChange={(event) => setSelectedCheckpointId(event.target.value)}>
              <option value="">Choose checkpoint</option>
              {checkpoints.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>
                  {checkpoint.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={generateChangelog} disabled={!snapshot || !selectedCheckpointId}>
            Generate changelog
          </button>
        </section>
      )}

      {screen === "review" && changelog && (
        <section>
          <h2>Changelog Review</h2>
          <label>
            Summary
            <textarea
              value={changelog.summary}
              onChange={(event) => setChangelog(Object.assign({}, changelog, { summary: event.target.value }))}
            />
          </label>
          {Object.entries(groupedChanges).map(([impact, changes]) => (
          <div className="group" key={impact}>
              <h3>{impact.split("_").join(" ")}</h3>
              {changes.map((change) => (
                <article className="change" key={change.id}>
                  <div>
                    <strong>{change.nodePath}</strong>
                    <button onClick={() => removeChange(change.id)}>Delete</button>
                  </div>
                  <select
                    value={change.impact}
                    onChange={(event) => updateChange(change.id, { impact: event.target.value as Change["impact"] })}
                  >
                    {[
                      "code_required",
                      "copy_only",
                      "style_token_update",
                      "layout_update",
                      "component_api_change",
                      "new_state_or_variant",
                      "removed_element",
                      "prototype_only",
                      "no_implementation_impact",
                      "needs_clarification"
                    ].map((impactOption) => (
                      <option key={impactOption} value={impactOption}>
                        {impactOption}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={change.implementationNote}
                    onChange={(event) => updateChange(change.id, { implementationNote: event.target.value })}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={change.approved}
                      onChange={(event) => updateChange(change.id, { approved: event.target.checked })}
                    />
                    Approved
                  </label>
                </article>
              ))}
            </div>
          ))}
          <div className="actions">
            <button onClick={saveChangelogEdits}>Save edits</button>
            <button onClick={approveChangelog}>Approve changelog</button>
          </div>
        </section>
      )}

      {screen === "publish" && changelog && (
        <section>
          <h2>Published</h2>
          <p className="mono">{changelog.id}</p>
          <div className="actions">
            <button onClick={() => copy(changelog.markdown)}>Copy Markdown</button>
            <button onClick={() => copy(JSON.stringify(changelog, null, 2))}>Copy JSON</button>
          </div>
        </section>
      )}

      <footer>{status}</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
