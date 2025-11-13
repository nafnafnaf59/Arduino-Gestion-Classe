import type { FC, ChangeEvent } from "react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DeploymentJob,
  DeploymentProfile,
  HostRecord,
  QueueSnapshot,
  SketchAnalysisResult,
  SketchMetadata,
  SketchOption
} from "../../models/types";
import { DeploymentManager } from "../../services/DeploymentManager";
import { SketchSelector } from "./SketchSelector";
import { HostTable, HostStatusView } from "./HostTable";
import { LogViewer, LogEntry } from "./LogViewer";
import { CredentialsModal, CredentialFormValues } from "./CredentialsModal";

export interface DeploymentDashboardProps {
  readonly manager: DeploymentManager;
  readonly defaultSketches: ReadonlyArray<SketchOption>;
}

interface UiState {
  readonly selectedSketch?: string;
  readonly analysis?: SketchAnalysisResult;
  readonly metadata?: SketchMetadata;
  readonly selectedHostIds: ReadonlyArray<string>;
  readonly profileId?: string;
  readonly filterText: string;
}

const INITIAL_UI_STATE: UiState = {
  selectedSketch: undefined,
  analysis: undefined,
  metadata: undefined,
  selectedHostIds: [],
  profileId: undefined,
  filterText: ""
};

function buildStatusView(snapshot: QueueSnapshot): ReadonlyArray<HostStatusView> {
  const statusMap = new Map<string, HostStatusView>();

  snapshot.jobs.forEach((job) => {
    statusMap.set(job.hostId, {
      hostId: job.hostId,
      status: job.status,
      message: job.error,
      port: job.result?.port
    });
  });

  return Array.from(statusMap.values());
}

function makeLogEntry(message: string, level: LogEntry["level"] = "info", scope?: string): LogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    level,
    message,
    scope
  };
}

export const DeploymentDashboard: FC<DeploymentDashboardProps> = ({ manager, defaultSketches }) => {
  const [uiState, setUiState] = useState<UiState>(INITIAL_UI_STATE);
  const [hosts, setHosts] = useState<ReadonlyArray<HostRecord>>([]);
  const [profiles, setProfiles] = useState<ReadonlyArray<DeploymentProfile>>(manager.getProfiles());
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(manager.getSnapshot());
  const [logs, setLogs] = useState<ReadonlyArray<LogEntry>>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);

  useEffect(() => {
    setHosts(manager.getHosts());
    setProfiles(manager.getProfiles());
  }, [manager]);

  useEffect(() => {
    const subscription = manager.observeJobs().subscribe((jobs: ReadonlyArray<DeploymentJob>) => {
      setSnapshot(manager.getSnapshot());
      setLogs((prev) => [
        ...prev,
        ...jobs
          .filter((job: DeploymentJob) => job.metrics.completedAt)
          .map((job: DeploymentJob) =>
            makeLogEntry(
              `${job.hostId} → ${job.action} : ${job.status}`,
              job.status === "failed" ? "error" : "info",
              "queue"
            )
          )
      ]);
    });

    return () => {
      subscription.unsubscribe?.();
    };
  }, [manager]);

  const statusByHost = useMemo(() => buildStatusView(snapshot), [snapshot]);

  const runningJobs = useMemo(() => snapshot.jobs.filter((job) => job.status === "running"), [snapshot]);

  const activeProfile = useMemo(() => {
    const profileFromState = profiles.find((profile) => profile.id === uiState.profileId);
    if (profileFromState) {
      return profileFromState;
    }
    return manager.getActiveProfile() ?? profiles[0];
  }, [manager, profiles, uiState.profileId]);

  const handleSketchSelected = useCallback((sketchPath: string) => {
    setUiState((prev) => ({
      ...prev,
      selectedSketch: sketchPath,
      metadata: undefined
    }));
  }, []);

  const handleAnalyze = useCallback(
    async (sketchPath: string) => {
      if (!activeProfile) {
        throw new Error("Aucun profil actif");
      }
      const result = await manager.analyzeSketch({
        sketchPath,
        fqbn: activeProfile.fqbn
      });
      setUiState((prev) => ({
        ...prev,
        analysis: result
      }));
      setLogs((prev) => [...prev, makeLogEntry(`Analyse terminée pour ${sketchPath}`, "info", "analyze")]);
      return result;
    },
    [manager, activeProfile]
  );

  const handleCompile = useCallback(
    async (sketchPath: string) => {
      const metadata = await manager.compileSketch(sketchPath, activeProfile?.id);
      setUiState((prev) => ({
        ...prev,
        metadata
      }));
      setLogs((prev) => [...prev, makeLogEntry(`Compilation réussie: ${metadata.binaryPath}`, "info", "compile")]);
    },
    [manager, activeProfile]
  );

  const handleToggleSelection = useCallback((hostId: string, selected: boolean) => {
    setUiState((prev) => ({
      ...prev,
      selectedHostIds: selected
        ? Array.from(new Set([...prev.selectedHostIds, hostId]))
        : prev.selectedHostIds.filter((id) => id !== hostId)
    }));
  }, []);

  const handleToggleAll = useCallback((selected: boolean) => {
    setUiState((prev) => ({
      ...prev,
      selectedHostIds: selected ? hosts.filter((host) => host.enabled).map((host) => host.id) : []
    }));
  }, [hosts]);

  const handleFilterChange = useCallback((value: string) => {
    setUiState((prev) => ({
      ...prev,
      filterText: value
    }));
  }, []);

  const handleToggleHostEnabled = useCallback((hostId: string, enabled: boolean) => {
    setHosts((prev) => prev.map((host) => (host.id === hostId ? { ...host, enabled } : host)));
    setLogs((prev) => [
      ...prev,
      makeLogEntry(`Poste ${hostId} ${enabled ? "activé" : "désactivé"}`, "info", "hosts")
    ]);
  }, []);

  const handleDeploy = useCallback(async () => {
    if (!uiState.selectedSketch) {
      setLogs((prev) => [...prev, makeLogEntry("Aucun sketch sélectionné", "warn", "deploy")]);
      return;
    }
    if (uiState.selectedHostIds.length === 0) {
      setLogs((prev) => [...prev, makeLogEntry("Sélectionnez au moins un poste", "warn", "deploy")]);
      return;
    }

    setIsDeploying(true);

    try {
      const metadata =
        uiState.metadata ?? (await manager.compileSketch(uiState.selectedSketch, activeProfile?.id));
      const targetHosts = hosts.filter((host) => uiState.selectedHostIds.includes(host.id) && host.enabled);
      await manager.deploy({
        hosts: targetHosts,
        metadata,
        profileId: activeProfile?.id ?? "default"
      });
      setUiState((prev) => ({
        ...prev,
        metadata
      }));
      setLogs((prev) => [
        ...prev,
        makeLogEntry(
          `Déploiement lancé sur ${targetHosts.length} poste(s)`,
          "info",
          "deploy"
        )
      ]);
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        makeLogEntry(
          error instanceof Error ? error.message : String(error),
          "error",
          "deploy"
        )
      ]);
    } finally {
      setIsDeploying(false);
    }
  }, [uiState, manager, hosts, activeProfile]);

  const handleErase = useCallback(async () => {
    if (uiState.selectedHostIds.length === 0) {
      setLogs((prev) => [...prev, makeLogEntry("Sélectionnez au moins un poste", "warn", "erase")]);
      return;
    }

    const targetHosts = hosts.filter((host) => uiState.selectedHostIds.includes(host.id));
    await manager.enqueueErase({
      hosts: targetHosts,
      profileId: activeProfile?.id ?? "default",
      sketchPath: uiState.selectedSketch ?? ""
    });
    setLogs((prev) => [...prev, makeLogEntry(`Mode effacement lancé`, "warn", "erase")]);
  }, [uiState.selectedHostIds, hosts, manager, activeProfile, uiState.selectedSketch]);

  const handleRetryFailures = useCallback(() => {
    const retried = manager.retryFailedJobs();
    setLogs((prev) => [...prev, makeLogEntry(`${retried.length} poste(s) relancés`, "info", "retry")]);
  }, [manager]);

  const handleCancel = useCallback(() => {
    manager.cancelPendingJobs();
    setLogs((prev) => [...prev, makeLogEntry("File d'attente interrompue", "warn", "queue")]);
  }, [manager]);

  const handleProfileChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const profileId = event.target.value;
    manager.selectProfile(profileId);
    setUiState((prev) => ({
      ...prev,
      profileId
    }));
    setLogs((prev) => [...prev, makeLogEntry(`Profil ${profileId} sélectionné`, "info", "profile")]);
  }, [manager]);

  const handleCredentialSubmit = useCallback(async (values: CredentialFormValues) => {
    setLogs((prev) => [...prev, makeLogEntry(`Identifiants ${values.label} enregistrés`, "info", "credentials")]);
  }, []);

  return (
    <div className="acd-dashboard">
      <div className="acd-panel acd-panel-left">
        <SketchSelector
          defaultSketches={defaultSketches}
          onAnalyze={handleAnalyze}
          onCompile={handleCompile}
          onSketchSelected={handleSketchSelected}
        />

        <div className="acd-profile-selector">
          <label htmlFor="profile-select">Profil de déploiement</label>
          <select
            id="profile-select"
            className="acd-select"
            value={activeProfile?.id ?? ""}
            onChange={handleProfileChange}
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>

        <div className="acd-actions-column">
          <button
            type="button"
            className="acd-button acd-button-primary"
            onClick={handleDeploy}
            disabled={isDeploying}
          >
            {isDeploying ? "Déploiement…" : "Déployer"}
          </button>
          <button type="button" className="acd-button" onClick={handleErase}>
            Effacer (Mode gomme)
          </button>
          <button type="button" className="acd-button" onClick={handleRetryFailures}>
            Réessayer les échecs
          </button>
          <button type="button" className="acd-button" onClick={handleCancel}>
            Arrêter
          </button>
          <button type="button" className="acd-button" onClick={() => setShowCredentials(true)}>
            Gérer les identifiants
          </button>
        </div>
      </div>

      <div className="acd-panel acd-panel-middle">
        <HostTable
          hosts={hosts}
          statusByHost={statusByHost}
          selectedHostIds={uiState.selectedHostIds}
          onToggleSelection={handleToggleSelection}
          onToggleAll={handleToggleAll}
          filterText={uiState.filterText}
          onFilterTextChange={handleFilterChange}
          onToggleHostEnabled={handleToggleHostEnabled}
          runningJobs={runningJobs}
        />
      </div>

      <div className="acd-panel acd-panel-right">
        <LogViewer logs={logs} />
      </div>

      <CredentialsModal
        visible={showCredentials}
        onClose={() => setShowCredentials(false)}
        onSubmit={handleCredentialSubmit}
      />
    </div>
  );
};
