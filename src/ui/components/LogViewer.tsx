import type { FC } from "react";
import React from "react";

export interface LogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly scope?: string;
}

export interface LogViewerProps {
  readonly logs: ReadonlyArray<LogEntry>;
  readonly autoScroll?: boolean;
}

const levelClassMap: Record<LogEntry["level"], string> = {
  debug: "acd-log-debug",
  info: "acd-log-info",
  warn: "acd-log-warn",
  error: "acd-log-error"
};

export const LogViewer: FC<LogViewerProps> = ({ logs, autoScroll = true }) => {
  return (
    <div className="acd-log-viewer">
      <h2>Console</h2>
      <div className="acd-log-container" data-auto-scroll={autoScroll}>
        {logs.length === 0 && <div className="acd-empty">Aucun évènement pour le moment.</div>}
        {logs.map((log) => (
          <div key={log.id} className={`acd-log-entry ${levelClassMap[log.level]}`}>
            <div className="acd-log-meta">
              <span className="acd-log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              {log.scope && <span className="acd-log-scope">[{log.scope}]</span>}
            </div>
            <div className="acd-log-message">{log.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
