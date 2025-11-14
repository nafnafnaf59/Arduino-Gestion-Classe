(function () {
  "use strict";

  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : {
    postMessage: (message) => console.log("[Webview mock message]", message)
  };

  const state = {
    hosts: [],
    profiles: [],
    snapshot: {
      jobs: [],
      activeCount: 0,
      waitingCount: 0,
      completedCount: 0,
      failedCount: 0
    },
    defaultSketches: [],
    logs: [],
    selectedSketch: "",
    selectedHostIds: new Set(),
    selectedProfileId: "",
    customSketchPath: "",
    analysis: undefined,
    metadata: undefined
  };

  const MAX_LOG_ENTRIES = 400;

  let sketchSelect;
  let customSketchInput;
  let hostTableBody;
  let statsBadge;
  let logList;
  let profileSelect;
  let filterInput;
  let analysisContainer;
  let metadataContainer;
  let deployButton;
  let eraseButton;
  let analyzeButton;
  let compileButton;
  let retryButton;
  let cancelButton;

  function initializeLayout() {
    document.body.innerHTML = `
      <div class="acd-dashboard">
        <div class="acd-panel acd-panel-left">
          <section class="acd-card">
            <h2>Sketch</h2>
            <label for="acd-sketch-select">Sélection</label>
            <select id="acd-sketch-select" class="acd-select"></select>
            <div id="acd-custom-sketch" style="display:none;">
              <label for="acd-custom-sketch-input">Chemin personnalisé</label>
              <input id="acd-custom-sketch-input" class="acd-input" placeholder="C:\\Users\\Prof\\Arduino\\MonSketch" />
            </div>
            <div class="acd-actions-row">
              <button id="acd-analyze" class="acd-button">Analyser</button>
              <button id="acd-compile" class="acd-button acd-button-primary">Compiler</button>
            </div>
            <div class="acd-analysis" id="acd-analysis" style="display:none;"></div>
            <div class="acd-metadata" id="acd-metadata" style="display:none;"></div>
          </section>

          <section class="acd-card">
            <h2>Profil</h2>
            <label for="acd-profile-select">Profil de déploiement</label>
            <select id="acd-profile-select" class="acd-select"></select>
          </section>

          <section class="acd-card">
            <h2>Actions</h2>
            <div class="acd-actions-column">
              <button id="acd-deploy" class="acd-button acd-button-primary">Déployer</button>
              <button id="acd-erase" class="acd-button">Effacer (gomme)</button>
              <button id="acd-retry" class="acd-button">Réessayer les échecs</button>
              <button id="acd-cancel" class="acd-button acd-button-danger">Arrêter</button>
            </div>
          </section>
        </div>

        <div class="acd-panel acd-panel-middle">
          <section class="acd-card">
            <div class="acd-panel-header">
              <h2>Postes élèves</h2>
              <input id="acd-filter" class="acd-input" placeholder="Filtrer par nom, IP ou tag" />
            </div>
            <div class="acd-badge" id="acd-stats">0 actif • 0 en attente • 0 succès • 0 échecs</div>
            <div class="acd-table-wrapper">
              <table class="acd-host-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" id="acd-select-all" /></th>
                    <th>Nom</th>
                    <th>Adresse</th>
                    <th>Actif</th>
                    <th>Tags</th>
                    <th>État</th>
                    <th>Port</th>
                  </tr>
                </thead>
                <tbody id="acd-host-tbody"></tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="acd-panel acd-panel-right">
          <section class="acd-card" style="flex:1;">
            <h2>Console</h2>
            <div class="acd-log-list" id="acd-logs"></div>
          </section>
        </div>
      </div>
    `;

    sketchSelect = document.getElementById("acd-sketch-select");
    customSketchInput = document.getElementById("acd-custom-sketch-input");
    hostTableBody = document.getElementById("acd-host-tbody");
    statsBadge = document.getElementById("acd-stats");
    logList = document.getElementById("acd-logs");
    profileSelect = document.getElementById("acd-profile-select");
    filterInput = document.getElementById("acd-filter");
    analysisContainer = document.getElementById("acd-analysis");
    metadataContainer = document.getElementById("acd-metadata");
    deployButton = document.getElementById("acd-deploy");
    eraseButton = document.getElementById("acd-erase");
    analyzeButton = document.getElementById("acd-analyze");
    compileButton = document.getElementById("acd-compile");
    retryButton = document.getElementById("acd-retry");
    cancelButton = document.getElementById("acd-cancel");

    document.getElementById("acd-select-all").addEventListener("change", handleToggleAll);
    sketchSelect.addEventListener("change", handleSketchSelectionChange);
    customSketchInput.addEventListener("input", handleCustomSketchChange);
    filterInput.addEventListener("input", handleFilterChange);
    analyzeButton.addEventListener("click", () => triggerAnalyze());
    compileButton.addEventListener("click", () => triggerCompile());
    deployButton.addEventListener("click", () => triggerDeploy());
    eraseButton.addEventListener("click", () => triggerErase());
    retryButton.addEventListener("click", () => sendMessage({ type: "retry" }));
    cancelButton.addEventListener("click", () => sendMessage({ type: "cancel" }));
    profileSelect.addEventListener("change", handleProfileChange);
  }

  function sendMessage(message) {
    vscode.postMessage(message);
  }

  function addLog(message, level = "info", scope = "ui") {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      scope
    };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_ENTRIES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
    }
    renderLogs();
  }

  function renderLogs() {
    if (!logList) {
      return;
    }
    if (state.logs.length === 0) {
      logList.innerHTML = '<div class="acd-empty">En attente d\'activité…</div>';
      return;
    }
    logList.innerHTML = state.logs
      .map((log) => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        return `
          <div class="acd-log-entry acd-log-${log.level}">
            <time>${time}${log.scope ? ` · ${log.scope}` : ""}</time>
            <div>${escapeHtml(log.message)}</div>
          </div>
        `;
      })
      .join("\n");
    logList.scrollTop = logList.scrollHeight;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderSketches() {
    const options = state.defaultSketches
      .map((sketch) => `<option value="${escapeHtml(sketch.path)}">${escapeHtml(sketch.label)}</option>`)
      .join("\n");
    const value = state.selectedSketch || "";
    sketchSelect.innerHTML = `
      <option value="">— Choisir —</option>
      ${options}
      <option value="__custom__">Chemin personnalisé…</option>
    `;
    if (value && !state.defaultSketches.some((s) => s.path === value)) {
      sketchSelect.value = "__custom__";
      document.getElementById("acd-custom-sketch").style.display = "block";
      customSketchInput.value = state.customSketchPath || value;
      state.selectedSketch = state.customSketchPath || value;
    } else {
      sketchSelect.value = value || "";
      document.getElementById("acd-custom-sketch").style.display = sketchSelect.value === "__custom__" ? "block" : "none";
    }
  }

  function renderProfiles() {
    profileSelect.innerHTML = state.profiles
      .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.label)}</option>`)
      .join("\n");
    const defaultProfile = state.selectedProfileId || (state.profiles[0] && state.profiles[0].id) || "";
    profileSelect.value = defaultProfile;
    state.selectedProfileId = defaultProfile;
  }

  function renderSnapshot() {
    statsBadge.textContent = `${state.snapshot.activeCount} actifs • ${state.snapshot.waitingCount} en attente • ${state.snapshot.completedCount} succès • ${state.snapshot.failedCount} échecs`;
  }

  function getStatusForHost(hostId) {
    const job = [...state.snapshot.jobs]
      .filter((item) => item.hostId === hostId)
      .sort((a, b) => {
        const aTime = a.metrics.completedAt || a.metrics.startedAt || a.metrics.queuedAt;
        const bTime = b.metrics.completedAt || b.metrics.startedAt || b.metrics.queuedAt;
        return (bTime || "").localeCompare(aTime || "");
      })[0];

    if (!job) {
      return { status: "idle", message: "En attente", port: "" };
    }

    const status = job.status === "succeeded" && job.result?.status === "TIMEOUT" ? "timeout" : job.status;
    return {
      status,
      message: job.error || "",
      port: job.result?.port || ""
    };
  }

  function renderHosts() {
    const filter = filterInput.value.trim().toLowerCase();
    const rows = state.hosts
      .filter((host) => {
        if (filter.length === 0) {
          return true;
        }
        const haystack = `${host.name} ${host.address} ${host.tags.join(" ")}`.toLowerCase();
        return haystack.includes(filter);
      })
      .map((host) => {
        const status = getStatusForHost(host.id);
        const statusClass = `acd-status-badge acd-status-${status.status}`;
        const isSelected = state.selectedHostIds.has(host.id);
        const tags = host.tags
          .map((tag) => `<li>${escapeHtml(tag)}</li>`)
          .join("") || "<span class=\"acd-tag-empty\">—</span>";
        return `
          <tr data-host-id="${escapeHtml(host.id)}" class="${host.enabled ? "" : "acd-host-disabled"}">
            <td><input type="checkbox" class="acd-host-checkbox" ${isSelected ? "checked" : ""} ${
              host.enabled ? "" : "disabled"
            }></td>
            <td>${escapeHtml(host.name)}</td>
            <td>${escapeHtml(host.address)}</td>
            <td>
              <button type="button" class="acd-toggle-host" data-enabled="${host.enabled ? "1" : "0"}">
                ${host.enabled ? "Activé" : "Coupé"}
              </button>
            </td>
            <td><ul class="acd-tag-list">${tags}</ul></td>
            <td><span class="${statusClass}" title="${escapeHtml(status.message || "")}">${formatStatusLabel(status.status)}</span></td>
            <td>${status.port ? escapeHtml(status.port) : "—"}</td>
          </tr>
        `;
      })
      .join("\n");

    hostTableBody.innerHTML = rows || '<tr><td colspan="7" class="acd-empty">Aucun poste.</td></tr>';

    hostTableBody.querySelectorAll(".acd-host-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", (event) => {
        const row = event.target.closest("tr");
        const hostId = row.getAttribute("data-host-id");
        if (!hostId) {
          return;
        }
        if (event.target.checked) {
          state.selectedHostIds.add(hostId);
        } else {
          state.selectedHostIds.delete(hostId);
        }
      });
    });

    hostTableBody.querySelectorAll(".acd-toggle-host").forEach((button) => {
      button.addEventListener("click", (event) => {
        const element = event.currentTarget;
        if (!(element instanceof HTMLElement)) {
          return;
        }
        const row = element.closest("tr");
        if (!row) {
          return;
        }
        const hostId = row.getAttribute("data-host-id");
        if (!hostId) {
          return;
        }
        const enabled = element.getAttribute("data-enabled") === "1";
        const nextEnabled = !enabled;
        sendMessage({
          type: "toggle-host",
          payload: {
            hostId,
            enabled: nextEnabled
          }
        });
        updateHosts(
          state.hosts.map((host) =>
            host.id === hostId
              ? {
                  ...host,
                  enabled: nextEnabled
                }
              : host
          )
        );
        addLog(
          `Poste ${hostId} ${nextEnabled ? "réactivé" : "mis en pause"}`,
          nextEnabled ? "info" : "warn",
          "hosts"
        );
      });
    });
  }

  function formatStatusLabel(status) {
    switch (status) {
      case "queued":
        return "File";
      case "running":
        return "En cours";
      case "succeeded":
        return "Succès";
      case "failed":
        return "Erreur";
      case "cancelled":
        return "Annulé";
      case "skipped":
        return "Ignoré";
      case "timeout":
        return "Timeout";
      default:
        return "Inactif";
    }
  }

  function handleToggleAll(event) {
    const checked = event.target.checked;
    state.selectedHostIds.clear();
    if (checked) {
      state.hosts
        .filter((host) => host.enabled)
        .forEach((host) => state.selectedHostIds.add(host.id));
    }
    renderHosts();
  }

  function handleSketchSelectionChange(event) {
    const value = event.target.value;
    if (value === "__custom__") {
      document.getElementById("acd-custom-sketch").style.display = "block";
      state.selectedSketch = state.customSketchPath || "";
      customSketchInput.focus();
    } else {
      document.getElementById("acd-custom-sketch").style.display = "none";
      state.selectedSketch = value;
      state.customSketchPath = "";
    }
    state.analysis = undefined;
    state.metadata = undefined;
    renderAnalysis();
    renderMetadata();
  }

  function handleCustomSketchChange(event) {
    state.customSketchPath = event.target.value.trim();
    state.selectedSketch = state.customSketchPath;
    state.analysis = undefined;
    state.metadata = undefined;
    renderAnalysis();
    renderMetadata();
  }

  function handleFilterChange(event) {
    const value = event.target.value;
    if (value.length > 0) {
      addLog(`Filtre appliqué: ${value}`, "debug", "filter");
    }
    renderHosts();
  }

  function handleProfileChange(event) {
    const profileId = event.target.value;
    state.selectedProfileId = profileId;
    sendMessage({ type: "profile-change", payload: { profileId } });
    addLog(`Profil ${profileId || "(par défaut)"} sélectionné`, "debug", "profile");
  }

  function triggerAnalyze() {
    if (!state.selectedSketch) {
      addLog("Sélectionnez un sketch avant l'analyse", "warn", "analyze");
      return;
    }
    const profile = state.profiles.find((p) => p.id === state.selectedProfileId) || state.profiles[0];
    if (!profile) {
      addLog("Aucun profil disponible", "error", "analyze");
      return;
    }
    addLog(`Analyse demandée pour ${state.selectedSketch}`, "info", "analyze");
    sendMessage({
      type: "analyze",
      payload: {
        sketchPath: state.selectedSketch,
        fqbn: profile.fqbn
      }
    });
  }

  function triggerCompile() {
    if (!state.selectedSketch) {
      addLog("Sélectionnez un sketch avant la compilation", "warn", "compile");
      return;
    }
    addLog(`Compilation demandée pour ${state.selectedSketch}`, "info", "compile");
    sendMessage({
      type: "compile",
      payload: {
        sketchPath: state.selectedSketch,
        profileId: state.selectedProfileId
      }
    });
  }

  function ensureDeploymentPreconditions() {
    if (!state.selectedSketch) {
      addLog("Sélectionnez un sketch avant de déployer", "warn", "deploy");
      return false;
    }
    if (state.selectedHostIds.size === 0) {
      addLog("Sélectionnez au moins un poste", "warn", "deploy");
      return false;
    }
    if (!state.metadata) {
      addLog("Compilez le sketch avant de déployer", "warn", "deploy");
      return false;
    }
    return true;
  }

  function triggerDeploy() {
    if (!ensureDeploymentPreconditions()) {
      return;
    }
    const hostIds = [...state.selectedHostIds];
    addLog(`Déploiement lancé sur ${hostIds.length} poste(s)`, "info", "deploy");
    sendMessage({
      type: "deploy",
      payload: {
        hostIds,
        profileId: state.selectedProfileId,
        sketchPath: state.selectedSketch,
        metadata: state.metadata
      }
    });
  }

  function triggerErase() {
    if (state.selectedHostIds.size === 0) {
      addLog("Sélectionnez au moins un poste", "warn", "erase");
      return;
    }
    const hostIds = [...state.selectedHostIds];
    addLog(`Mode effacement déclenché (${hostIds.length} poste(s))`, "warn", "erase");
    sendMessage({
      type: "erase",
      payload: {
        hostIds,
        profileId: state.selectedProfileId,
        sketchPath: state.selectedSketch || ""
      }
    });
  }

  function renderAnalysis() {
    if (!analysisContainer) {
      return;
    }
    if (!state.analysis) {
      analysisContainer.style.display = "none";
      analysisContainer.innerHTML = "";
      return;
    }
    const analysis = state.analysis;
    analysisContainer.style.display = "block";
    analysisContainer.innerHTML = `
      <div><strong>FQBN:</strong> ${escapeHtml(analysis.metadata.fqbn)}</div>
      ${analysis.missingLibraries.length > 0 ? `<div class="acd-badge acd-badge-warn">Bibliothèques manquantes</div>` : ""}
      ${analysis.missingLibraries.length > 0 ? `<ul>${analysis.missingLibraries.map((lib) => `<li>${escapeHtml(lib)}</li>`).join("\n")}</ul>` : ""}
      ${analysis.dependencies.length > 0 ? `<div><strong>Dépendances:</strong><ul>${analysis.dependencies.map((dep) => `<li>${escapeHtml(dep)}</li>`).join("\n")}</ul></div>` : ""}
    `;
  }

  function renderMetadata() {
    if (!metadataContainer) {
      return;
    }
    if (!state.metadata) {
      metadataContainer.style.display = "none";
      metadataContainer.innerHTML = "";
      return;
    }
    metadataContainer.style.display = "block";
    metadataContainer.innerHTML = `
      <div><strong>Image :</strong> ${escapeHtml(state.metadata.binaryPath || "(inconnue)")}</div>
      <div><strong>Hash :</strong> ${escapeHtml(state.metadata.hash || "—")}</div>
      <div><strong>Taille :</strong> ${state.metadata.sizeEstimate || "?"} octets</div>
      <div><strong>Compilé le :</strong> ${state.metadata.compiledAt ? new Date(state.metadata.compiledAt).toLocaleString() : "—"}</div>
    `;
  }

  function updateHosts(hosts) {
    state.hosts = hosts || [];
    state.selectedHostIds = new Set(
      [...state.selectedHostIds].filter((id) => state.hosts.some((host) => host.id === id && host.enabled))
    );
    renderHosts();
  }

  function updateSnapshot(snapshot) {
    state.snapshot = snapshot || state.snapshot;
    renderSnapshot();
    renderHosts();
  }

  function handleInitialState(payload) {
    state.hosts = payload.hosts || [];
    state.profiles = payload.profiles || [];
    state.snapshot = payload.snapshot || state.snapshot;
    state.defaultSketches = payload.defaultSketches || [];
    state.selectedSketch = payload.defaultSketches?.[0]?.path || "";
    state.selectedHostIds = new Set(payload.hosts.filter((host) => host.enabled).map((host) => host.id));
    state.selectedProfileId = payload.profiles?.[0]?.id || "";
    renderSketches();
    renderProfiles();
    renderSnapshot();
    renderHosts();
    renderLogs();
  }

  const messageHandlers = {
    "initial-state": (payload) => {
      handleInitialState(payload || {});
      addLog("Tableau de bord prêt", "info", "init");
    },
    "queue-update": (payload) => {
      updateSnapshot(payload?.snapshot);
    },
    hosts: (payload) => {
      updateHosts(payload || []);
    },
    "analysis-result": (payload) => {
      state.analysis = payload;
      renderAnalysis();
      addLog("Analyse terminée", "info", "analyze");
    },
    "compile-result": (payload) => {
      state.metadata = payload;
      renderMetadata();
      addLog("Compilation terminée", "info", "compile");
    },
    "deploy-started": () => {
      addLog("Déploiement en cours", "info", "deploy");
    },
    "erase-started": () => {
      addLog("Effacement en cours", "warn", "erase");
    },
    error: (payload) => {
      addLog(payload || "Une erreur est survenue", "error", "remote");
    }
  };

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.type) {
      return;
    }
    const handler = messageHandlers[message.type];
    if (handler) {
      handler(message.payload);
    } else {
      console.warn("Message non géré", message);
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    initializeLayout();
    renderLogs();
    sendMessage({ type: "ready" });
  });
})();
