import type { FC, ChangeEvent } from "react";
import React, { useMemo } from "react";
import type { DeploymentJob, HostRecord, JobState } from "../../models/types";

export interface HostStatusView {
  readonly hostId: string;
  readonly status: JobState | "idle";
  readonly message?: string;
  readonly port?: string;
}

export interface HostTableProps {
  readonly hosts: ReadonlyArray<HostRecord>;
  readonly statusByHost: ReadonlyArray<HostStatusView>;
  readonly selectedHostIds: ReadonlyArray<string>;
  readonly onToggleSelection: (hostId: string, selected: boolean) => void;
  readonly onToggleAll: (selected: boolean) => void;
  readonly filterText: string;
  readonly onFilterTextChange: (value: string) => void;
  readonly onToggleHostEnabled: (hostId: string, enabled: boolean) => void;
  readonly runningJobs: ReadonlyArray<DeploymentJob>;
}

const statusClassMap: Record<JobState | "idle", string> = {
  idle: "acd-status-idle",
  queued: "acd-status-queued",
  running: "acd-status-running",
  succeeded: "acd-status-success",
  failed: "acd-status-error",
  cancelled: "acd-status-cancelled",
  skipped: "acd-status-skipped"
};

function getStatusLabel(status: JobState | "idle"): string {
  switch (status) {
    case "queued":
      return "En file d'attente";
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
    default:
      return "Inactif";
  }
}

export const HostTable: FC<HostTableProps> = ({
  hosts,
  statusByHost,
  selectedHostIds,
  onToggleSelection,
  onToggleAll,
  filterText,
  onFilterTextChange,
  onToggleHostEnabled,
  runningJobs
}) => {
  const statusMap = useMemo(() => {
    const map = new Map<string, HostStatusView>();
    statusByHost.forEach((status) => map.set(status.hostId, status));
    return map;
  }, [statusByHost]);

  const filteredHosts = useMemo(() => {
    const normalized = filterText.trim().toLowerCase();
    if (normalized.length === 0) {
      return hosts;
    }

    return hosts.filter((host) => {
      const haystack = `${host.name} ${host.address} ${host.tags.join(" ")}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [hosts, filterText]);

  const allSelected = filteredHosts.length > 0 && filteredHosts.every((host) => selectedHostIds.includes(host.id));
  const indeterminate = selectedHostIds.length > 0 && !allSelected;

  const handleSelectAll = (event: ChangeEvent<HTMLInputElement>) => {
    onToggleAll(event.target.checked);
  };

  const handleFilterChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFilterTextChange(event.target.value);
  };

  return (
    <div className="acd-host-table">
      <div className="acd-host-table-header">
        <h2>Postes élèves</h2>
        <input
          type="text"
          className="acd-input"
          placeholder="Filtrer par nom, IP ou tag"
          value={filterText}
          onChange={handleFilterChange}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(input: HTMLInputElement | null) => {
                  if (input) {
                    input.indeterminate = indeterminate;
                  }
                }}
                onChange={handleSelectAll}
              />
            </th>
            <th>Nom</th>
            <th>Adresse</th>
            <th>Tags</th>
            <th>État</th>
            <th>Port</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredHosts.map((host) => {
            const status = statusMap.get(host.id) ?? { hostId: host.id, status: "idle" };
            const isSelected = selectedHostIds.includes(host.id);
            const runningJob = runningJobs.find((job) => job.hostId === host.id && job.status === "running");

            return (
              <tr key={host.id} className={!host.enabled ? "acd-host-disabled" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onToggleSelection(host.id, event.target.checked)
                    }
                  />
                </td>
                <td>{host.name}</td>
                <td>{host.address}</td>
                <td>
                  {host.tags.length > 0 ? (
                    <ul className="acd-tag-list">
                      {host.tags.map((tag) => (
                        <li key={`${host.id}-${tag}`}>{tag}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="acd-tag-empty">—</span>
                  )}
                </td>
                <td>
                  <span className={`acd-status ${statusClassMap[status.status]}`} title={status.message}>
                    {getStatusLabel(status.status)}
                  </span>
                </td>
                <td>{status.port ?? "—"}</td>
                <td>
                  <button
                    type="button"
                    className="acd-button-link"
                    onClick={() => onToggleHostEnabled(host.id, !host.enabled)}
                  >
                    {host.enabled ? "Désactiver" : "Activer"}
                  </button>
                  {runningJob && (
                    <span className="acd-job-progress">
                      {runningJob.metrics.elapsedMs ? `${runningJob.metrics.elapsedMs} ms` : "En cours"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {filteredHosts.length === 0 && <div className="acd-empty">Aucun poste ne correspond au filtre.</div>}
    </div>
  );
};
