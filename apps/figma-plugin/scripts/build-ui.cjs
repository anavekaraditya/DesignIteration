const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const distDir = resolve(__dirname, "../dist");
mkdirSync(distDir, { recursive: true });

writeFileSync(
  resolve(distDir, "index.html"),
  `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeltaFrame</title>
    <style>
      :root {
        color: var(--figma-color-text, #f5f5f5);
        background: var(--figma-color-bg, #2c2c2c);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--figma-color-bg, #2c2c2c); }
      main { display: grid; gap: 14px; padding: 16px; }
      header, .row, .change-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      h1, h2, h3, p { margin: 0; }
      h1 { font-size: 18px; line-height: 1.2; }
      h2 { font-size: 14px; margin-bottom: 8px; }
      h3 { font-size: 12px; margin: 10px 0 6px; }
      p, label, span, footer, button, input, textarea, select, summary { font-size: 12px; line-height: 1.4; }
      section, details { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--figma-color-border, #555); border-radius: 8px; }
      summary { cursor: pointer; font-weight: 600; }
      button, input, textarea, select { border: 1px solid var(--figma-color-border, #555); border-radius: 6px; font-family: inherit; }
      button { min-height: 34px; padding: 0 12px; color: var(--figma-color-text-onbrand, white); background: var(--figma-color-bg-brand, #0d99ff); cursor: pointer; }
      button.primary { width: 100%; min-height: 44px; font-size: 13px; font-weight: 700; }
      button.secondary, button.ghost { background: var(--figma-color-bg-secondary, #3a3a3a); color: var(--figma-color-text, #f5f5f5); }
      button.ghost { border-color: transparent; }
      button:disabled { opacity: 0.45; cursor: not-allowed; }
      input, textarea, select { width: 100%; min-height: 32px; padding: 7px 8px; color: var(--figma-color-text, #f5f5f5); background: var(--figma-color-bg, #2c2c2c); }
      textarea { min-height: 72px; resize: vertical; }
      label { display: grid; gap: 6px; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .actions > button { flex: 1 1 auto; }
      .panel { padding: 10px; border-radius: 6px; background: var(--figma-color-bg-secondary, #3a3a3a); }
      .pill { padding: 4px 8px; border-radius: 999px; color: var(--figma-color-text-brand, #8ecbff); background: var(--figma-color-bg-brand-tertiary, #17324a); }
      .list { display: grid; gap: 8px; }
      .item { padding: 10px; border: 1px solid var(--figma-color-border, #555); border-radius: 8px; cursor: pointer; }
      .item.active { border-color: var(--figma-color-bg-brand, #0d99ff); }
      .change { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--figma-color-border, #555); border-radius: 8px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; overflow-wrap: anywhere; }
      .muted { color: var(--figma-color-text-secondary, #aaa); }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>DeltaFrame</h1>
          <p>Design iteration changelogs.</p>
        </div>
        <span class="pill">Draft first</span>
      </header>

      <section>
        <h2>Selected Section</h2>
        <div class="panel">
          <div class="row"><strong id="selectionName">No selection</strong><span id="selectionType">Select a section</span></div>
          <p id="selectionMeta" class="mono muted">Select a section or copied iteration in Figma.</p>
        </div>
        <button id="primaryBtn" class="primary" disabled>Create changelog</button>
        <div id="matchPanel" class="hidden">
          <h3>Choose section to compare</h3>
          <div id="candidateList" class="list"></div>
        </div>
      </section>

      <section id="resultPanel" class="hidden">
        <h2>Output</h2>
        <p id="resultText">No changelog yet.</p>
        <div class="actions">
          <button id="reviewBtn" class="secondary">Review changelog</button>
          <button id="approveBtn" class="secondary">Approve for MCP</button>
        </div>
        <p id="changelogId" class="mono muted">No changelog yet.</p>
      </section>

      <section id="reviewPanel" class="hidden">
        <h2>Review Changelog</h2>
        <label>Summary <textarea id="summary"></textarea></label>
        <div id="changes" class="list"></div>
        <div class="actions">
          <button id="saveEditsBtn">Save edits</button>
          <button id="writeCanvasBtn" class="secondary">Write to canvas</button>
        </div>
      </section>

      <details id="advanced">
        <summary>Advanced</summary>
        <label>API URL <input id="apiUrl" value="http://localhost:8788" /></label>
        <label>Project name <input id="projectName" value="DeltaFrame Beta Project" /></label>
        <label>Gemini API key <input id="geminiKey" type="password" placeholder="Optional local beta key" /></label>
        <label>Manual section <select id="sectionSelect"><option value="">Choose section</option></select></label>
        <div class="actions">
          <button id="refreshBtn" class="secondary">Refresh sections</button>
          <button id="manualBaselineBtn" class="secondary">Save as baseline</button>
          <button id="manualIterationBtn" class="secondary">Compare manually</button>
        </div>
        <div id="sectionsList" class="list"></div>
      </details>

      <footer id="status" class="panel">Ready.</footer>
    </main>

    <script>
      var HIGH_CONFIDENCE = 0.72;
      var LOW_CONFIDENCE = 0.58;
      var state = {
        projectId: safeGet("deltaframe.projectId") || "",
        sections: [],
        selectedSectionId: safeGet("deltaframe.sectionId") || "",
        selection: null,
        snapshot: null,
        changelog: null,
        iteration: null,
        pendingFlow: null,
        matchInfo: null,
        candidates: []
      };
      var impacts = ["code_required","copy_only","style_token_update","layout_update","component_api_change","new_state_or_variant","removed_element","prototype_only","no_implementation_impact","needs_clarification"];

      function el(id) { return document.getElementById(id); }
      function apiUrl() { return el("apiUrl").value.replace(/\\/$/, ""); }
      function setStatus(text) { el("status").textContent = text; }
      function safeGet(key) { try { return localStorage.getItem(key); } catch (_) { return ""; } }
      function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }

      function updatePrimaryButton() {
        var button = el("primaryBtn");
        button.disabled = !state.selection || state.pendingFlow;
        if (!state.selection) {
          button.textContent = "Select a section";
        } else if (state.selection.sectionId) {
          button.textContent = "Create changelog";
        } else {
          button.textContent = state.sections.length ? "Create changelog" : "Save as baseline";
        }
      }

      function updateSelection(selection) {
        var first = (selection || [])[0] || null;
        state.selection = first;
        el("selectionName").textContent = first ? first.name : "No selection";
        el("selectionType").textContent = first ? first.type : "Select a section";
        el("selectionMeta").textContent = first && first.sectionId
          ? "Tracked section. " + (first.iterationId ? "Latest selected iteration metadata is present." : "Baseline metadata is present.")
          : first ? "Untracked selection. DeltaFrame will baseline or smart-match it." : "Select a section or copied iteration in Figma.";
        if (first && first.sectionId) {
          state.selectedSectionId = first.sectionId;
          safeSet("deltaframe.sectionId", first.sectionId);
          el("sectionSelect").value = first.sectionId;
        }
        el("matchPanel").className = "hidden";
        updatePrimaryButton();
      }

      function updateSnapshot(payload) {
        state.snapshot = payload;
        if (payload.sectionId) {
          state.selectedSectionId = payload.sectionId;
          safeSet("deltaframe.sectionId", payload.sectionId);
          el("sectionSelect").value = payload.sectionId;
        }
        if (state.pendingFlow === "primary") {
          createChangelogFromSnapshot(payload).catch(function () {
            state.pendingFlow = null;
            updatePrimaryButton();
            setStatus("Could not create changelog. Check the backend URL in Advanced.");
          });
        } else if (state.pendingFlow === "manual-baseline") {
          saveBaseline(payload).finally(clearPending);
        } else if (state.pendingFlow === "manual-iteration") {
          saveIteration(payload, el("sectionSelect").value || state.selectedSectionId, null).finally(clearPending);
        } else {
          setStatus("Snapshot captured.");
        }
      }

      function clearPending() {
        state.pendingFlow = null;
        updatePrimaryButton();
      }

      async function createPrimaryFlow() {
        if (!state.selection) return setStatus("Select a section or copied iteration in Figma.");
        state.pendingFlow = "primary";
        updatePrimaryButton();
        el("matchPanel").className = "hidden";
        setStatus("Reading selected section...");
        parent.postMessage({ pluginMessage: { type: "export-selection" } }, "*");
      }

      async function createChangelogFromSnapshot(snapshot) {
        if (snapshot.sectionId) {
          await saveIteration(snapshot, snapshot.sectionId, null);
          return clearPending();
        }

        var suggestion = await suggestMatch(snapshot);
        var best = suggestion.best;
        state.candidates = suggestion.candidates || [];
        if (best && best.confidence >= HIGH_CONFIDENCE) {
          await saveIteration(snapshot, best.section.id, best);
          return clearPending();
        }
        if (best && best.confidence >= LOW_CONFIDENCE) {
          renderCandidates(state.candidates);
          setStatus("Choose the section to compare. DeltaFrame found a possible match.");
          state.pendingFlow = null;
          updatePrimaryButton();
          return;
        }
        await saveBaseline(snapshot);
        clearPending();
      }

      async function suggestMatch(snapshot) {
        var response = await fetch(apiUrl() + "/sections/suggest-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: state.projectId || undefined,
            projectName: el("projectName").value || "DeltaFrame Beta Project",
            figmaNodeId: snapshot.figmaNodeId,
            name: snapshot.nodeName || "Section",
            normalizedTree: snapshot.normalizedTree,
            screenshotPngBase64: snapshot.screenshotPngBase64
          })
        });
        var data = await readJson(response);
        if (!response.ok) return { candidates: [] };
        return data;
      }

      async function saveBaseline(snapshot) {
        setStatus("Saving baseline...");
        var response = await fetch(apiUrl() + "/sections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: state.projectId || undefined,
            projectName: el("projectName").value || "DeltaFrame Beta Project",
            sectionName: snapshot.nodeName || "Section",
            figmaNodeId: snapshot.figmaNodeId,
            name: snapshot.nodeName || "Baseline",
            isImplementationBaseline: true,
            normalizedTree: snapshot.normalizedTree,
            screenshotPngBase64: snapshot.screenshotPngBase64
          })
        });
        var data = await readJson(response);
        if (!response.ok) return setStatus(data.error || data.message || "Failed to save baseline.");
        state.projectId = data.project.id;
        state.selectedSectionId = data.section.id;
        safeSet("deltaframe.projectId", state.projectId);
        safeSet("deltaframe.sectionId", state.selectedSectionId);
        parent.postMessage({ pluginMessage: { type: "tag-selection", payload: { sectionId: data.section.id, iterationId: data.iteration.id } } }, "*");
        await refreshSections(false);
        el("resultPanel").className = "";
        el("resultText").textContent = "Baseline saved. Copy this section, make changes, then click Create changelog on the iteration.";
        el("changelogId").textContent = "Section ID: " + data.section.id;
        setStatus("Baseline saved for " + data.section.name + ".");
      }

      async function saveIteration(snapshot, sectionId, matchInfo) {
        if (!sectionId) return setStatus("Choose the section this iteration belongs to.");
        setStatus("Creating changelog...");
        var response = await fetch(apiUrl() + "/sections/" + encodeURIComponent(sectionId) + "/iterations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            figmaNodeId: snapshot.figmaNodeId,
            name: snapshot.nodeName || "Iteration",
            normalizedTree: snapshot.normalizedTree,
            screenshotPngBase64: snapshot.screenshotPngBase64,
            geminiApiKey: el("geminiKey").value || undefined
          })
        });
        var data = await readJson(response);
        if (!response.ok) return setStatus(data.error || data.message || "Failed to save iteration.");
        state.selectedSectionId = data.section.id;
        state.iteration = data.iteration;
        state.changelog = data.changelog;
        state.matchInfo = matchInfo;
        safeSet("deltaframe.sectionId", data.section.id);
        parent.postMessage({ pluginMessage: { type: "tag-selection", payload: { sectionId: data.section.id, iterationId: data.iteration.id } } }, "*");
        renderChangelog();
        writeCanvasChangelog(matchInfo);
        await refreshSections(false);
        el("resultPanel").className = "";
        el("resultText").textContent = "Draft changelog written beside the selected iteration.";
        el("changelogId").textContent = data.changelog.id;
        setStatus("Draft changelog created.");
      }

      async function refreshSections(showStatus) {
        var query = state.projectId ? "?projectId=" + encodeURIComponent(state.projectId) : "";
        var response = await fetch(apiUrl() + "/sections" + query);
        var data = await readJson(response);
        if (!response.ok) {
          if (showStatus !== false) setStatus(data.error || "Could not load sections.");
          return;
        }
        state.sections = data.sections || [];
        renderSections();
        updatePrimaryButton();
        if (showStatus !== false) setStatus("Loaded " + state.sections.length + " tracked section" + (state.sections.length === 1 ? "." : "s."));
      }

      function renderSections() {
        var list = el("sectionsList");
        var select = el("sectionSelect");
        list.innerHTML = "";
        select.innerHTML = '<option value="">Choose section</option>';
        state.sections.forEach(function (section) {
          var option = document.createElement("option");
          option.value = section.id;
          option.textContent = section.name;
          if (section.id === state.selectedSectionId) option.selected = true;
          select.appendChild(option);

          var item = document.createElement("div");
          item.className = "item" + (section.id === state.selectedSectionId ? " active" : "");
          item.setAttribute("data-section-id", section.id);
          item.innerHTML = '<strong></strong><p class="mono muted"></p>';
          item.querySelector("strong").textContent = section.name;
          item.querySelector("p").textContent = section.id;
          list.appendChild(item);
        });
      }

      function renderCandidates(candidates) {
        var panel = el("matchPanel");
        var list = el("candidateList");
        list.innerHTML = "";
        panel.className = "";
        candidates.forEach(function (candidate) {
          var item = document.createElement("button");
          item.className = "secondary";
          item.setAttribute("data-compare-section", candidate.section.id);
          item.textContent = candidate.section.name + " · " + Math.round(candidate.confidence * 100) + "%";
          list.appendChild(item);
        });
        var baseline = document.createElement("button");
        baseline.className = "ghost";
        baseline.id = "candidateBaselineBtn";
        baseline.textContent = "Save as new baseline instead";
        list.appendChild(baseline);
      }

      function renderChangelog() {
        if (!state.changelog) return;
        el("summary").value = state.changelog.summary || "";
        var container = el("changes");
        container.innerHTML = "";
        state.changelog.changes.forEach(function (change, index) {
          var article = document.createElement("article");
          article.className = "change";
          article.innerHTML =
            '<div class="change-head"><strong></strong><button class="secondary" data-delete="' + index + '">Delete</button></div>' +
            '<select data-impact="' + index + '"></select>' +
            '<textarea data-note="' + index + '"></textarea>' +
            '<label><input type="checkbox" data-approved="' + index + '" /> Approved</label>';
          article.querySelector("strong").textContent = change.nodePath;
          var select = article.querySelector("select");
          impacts.forEach(function (impact) {
            var option = document.createElement("option");
            option.value = impact;
            option.textContent = impact;
            if (impact === change.impact) option.selected = true;
            select.appendChild(option);
          });
          article.querySelector("textarea").value = change.implementationNote || "";
          article.querySelector("input").checked = !!change.approved;
          container.appendChild(article);
        });
      }

      function collectChangelogEdits() {
        if (!state.changelog) return;
        state.changelog.summary = el("summary").value;
        Array.prototype.forEach.call(document.querySelectorAll("[data-impact]"), function (node) {
          state.changelog.changes[Number(node.getAttribute("data-impact"))].impact = node.value;
        });
        Array.prototype.forEach.call(document.querySelectorAll("[data-note]"), function (node) {
          state.changelog.changes[Number(node.getAttribute("data-note"))].implementationNote = node.value;
        });
        Array.prototype.forEach.call(document.querySelectorAll("[data-approved]"), function (node) {
          state.changelog.changes[Number(node.getAttribute("data-approved"))].approved = node.checked;
        });
      }

      async function saveChangelogEdits() {
        if (!state.changelog) return;
        collectChangelogEdits();
        var response = await fetch(apiUrl() + "/changelogs/" + encodeURIComponent(state.changelog.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: state.changelog.title, summary: state.changelog.summary, changes: state.changelog.changes })
        });
        var data = await readJson(response);
        if (!response.ok) return setStatus(data.error || "Failed to save edits.");
        state.changelog = data.changelog;
        renderChangelog();
        setStatus("Saved changelog edits.");
      }

      async function approveChangelog() {
        if (!state.changelog) return setStatus("Create a changelog first.");
        await saveChangelogEdits();
        var response = await fetch(apiUrl() + "/changelogs/" + encodeURIComponent(state.changelog.id) + "/approve", { method: "POST" });
        var data = await readJson(response);
        if (!response.ok) return setStatus(data.error || "Failed to approve changelog.");
        state.changelog = data.changelog;
        writeCanvasChangelog(state.matchInfo);
        setStatus("Approved for MCP.");
      }

      function writeCanvasChangelog(matchInfo) {
        if (!state.changelog || !state.iteration) return setStatus("Generate a changelog first.");
        collectChangelogEdits();
        parent.postMessage({
          pluginMessage: {
            type: "write-changelog-frame",
            payload: {
              sectionId: state.selectedSectionId,
              iterationId: state.iteration.id,
              changelogId: state.changelog.id,
              title: state.changelog.title,
              summary: state.changelog.summary,
              status: state.changelog.status,
              matchConfidence: matchInfo ? matchInfo.confidence : undefined,
              matchReason: matchInfo ? matchInfo.reason : undefined,
              changes: state.changelog.changes
            }
          }
        }, "*");
      }

      async function readJson(response) {
        var text = await response.text();
        if (!text) return {};
        try { return JSON.parse(text); } catch (_) { return { error: text }; }
      }

      window.onmessage = function (event) {
        var message = event.data && event.data.pluginMessage;
        if (!message) return;
        if (message.type === "selection") updateSelection(message.payload);
        if (message.type === "snapshot") updateSnapshot(message.payload);
        if (message.type === "changelog-frame-written") setStatus("Wrote changelog frame beside iteration.");
        if (message.type === "error") {
          state.pendingFlow = null;
          updatePrimaryButton();
          setStatus(message.payload);
        }
      };

      document.addEventListener("click", function (event) {
        var target = event.target;
        if (target.id === "primaryBtn") createPrimaryFlow();
        if (target.id === "refreshBtn") refreshSections();
        if (target.id === "manualBaselineBtn") { state.pendingFlow = "manual-baseline"; parent.postMessage({ pluginMessage: { type: "export-selection" } }, "*"); }
        if (target.id === "manualIterationBtn") { state.pendingFlow = "manual-iteration"; parent.postMessage({ pluginMessage: { type: "export-selection" } }, "*"); }
        if (target.id === "reviewBtn") el("reviewPanel").className = el("reviewPanel").className === "hidden" ? "" : "hidden";
        if (target.id === "saveEditsBtn") saveChangelogEdits();
        if (target.id === "writeCanvasBtn") writeCanvasChangelog(state.matchInfo);
        if (target.id === "approveBtn") approveChangelog();
        if (target.hasAttribute("data-section-id")) {
          state.selectedSectionId = target.getAttribute("data-section-id");
          safeSet("deltaframe.sectionId", state.selectedSectionId);
          el("sectionSelect").value = state.selectedSectionId;
          renderSections();
        }
        if (target.hasAttribute("data-compare-section")) {
          var sectionId = target.getAttribute("data-compare-section");
          var match = state.candidates.find(function (candidate) { return candidate.section.id === sectionId; }) || null;
          el("matchPanel").className = "hidden";
          saveIteration(state.snapshot, sectionId, match);
        }
        if (target.id === "candidateBaselineBtn") {
          el("matchPanel").className = "hidden";
          saveBaseline(state.snapshot);
        }
        if (target.hasAttribute("data-delete") && state.changelog) {
          state.changelog.changes.splice(Number(target.getAttribute("data-delete")), 1);
          renderChangelog();
        }
      });

      el("apiUrl").value = safeGet("deltaframe.apiUrl") || "http://localhost:8788";
      el("geminiKey").value = safeGet("deltaframe.geminiKey") || "";
      el("apiUrl").addEventListener("change", function () { safeSet("deltaframe.apiUrl", el("apiUrl").value); refreshSections(false); });
      el("geminiKey").addEventListener("change", function () { safeSet("deltaframe.geminiKey", el("geminiKey").value); });
      refreshSections(false).catch(function () {});
      updatePrimaryButton();
      setStatus("Ready.");
    </script>
  </body>
</html>
`
);
