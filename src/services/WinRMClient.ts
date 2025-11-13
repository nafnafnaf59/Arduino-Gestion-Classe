import { spawn } from "child_process";
import { once } from "events";
import process from "process";
import { DeploymentContext, DeploymentJob, DeploymentResult, DeploymentStrategy, HostRecord, RemoteAgentResponse } from "../models/types";
import { getLogger } from "../utils/logger";

export interface WinRMClientOptions {
  readonly scriptPath: string;
  readonly shellPath?: string;
  readonly dryRun?: boolean;
  readonly defaultTimeoutMs?: number;
  readonly extraArguments?: ReadonlyArray<string>;
}

function isWindowsHost(host: HostRecord): boolean {
  return host.os === "windows";
}

export class WinRMClient implements DeploymentStrategy {
  readonly id = "winrm";
  readonly label = "WinRM (PowerShell)";

  private readonly logger = getLogger("WinRMClient");
  private readonly options: WinRMClientOptions;

  constructor(options: WinRMClientOptions) {
    this.options = {
      shellPath: process.env.POWERSHELL_PATH ?? "powershell.exe",
      defaultTimeoutMs: 180_000,
      ...options
    };
  }

  supports(host: HostRecord): boolean {
    return isWindowsHost(host);
  }

  async execute(job: DeploymentJob, context: DeploymentContext): Promise<DeploymentResult> {
    if (!this.supports(context.host)) {
      throw new Error(`WinRMClient ne supporte pas le système ${context.host.os}`);
    }

    if (this.options.dryRun || job.mode === "dry-run") {
      return {
        status: "OK",
        logs: [
          "Dry-run actif, aucune commande distante exécutée",
          `Action: ${job.action}`,
          `Hôte: ${context.host.name} (${context.host.address})`
        ],
        elapsedMs: 0
      };
    }

    const start = Date.now();
    const response = await this.invokeRemoteAgent(job, context);
    const elapsedMs = Date.now() - start;

    return {
      status: response.status,
      port: response.port,
      elapsedMs,
      logs: response.logs ?? [],
      error: response.error
    };
  }

  private async invokeRemoteAgent(job: DeploymentJob, context: DeploymentContext): Promise<RemoteAgentResponse> {
    const shellPath = this.options.shellPath ?? "powershell.exe";
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      this.options.scriptPath,
      "-Action",
      job.action,
      "-FQBN",
      context.profile.fqbn,
      "-HexPath",
      job.hexPath ?? "",
      "-Host",
      context.host.address,
      "-JobId",
      job.id
    ];

    if (this.options.extraArguments) {
      args.push(...this.options.extraArguments);
    }

    const child = spawn(shellPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const stdoutChunks: Array<string> = [];
    const stderrChunks: Array<string> = [];

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => stdoutChunks.push(chunk));

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => stderrChunks.push(chunk));

    const timeoutMs = this.options.defaultTimeoutMs ?? 180_000;
    const timeout = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    try {
      const [code] = (await once(child, "close")) as [number | null];
      clearTimeout(timeout);
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");

      if (code !== 0) {
        this.logger.error({ code, stderr }, "remoteAgent.ps1 a renvoyé un code d'erreur");
        return {
          action: job.action,
          fqbn: context.profile.fqbn,
          status: "ERROR",
          error: stderr || `remoteAgent.ps1 a échoué avec le code ${code}`,
          logs: stdout.length > 0 ? stdout.split(/\r?\n/).filter(Boolean) : []
        };
      }

      try {
        const parsed = JSON.parse(stdout) as RemoteAgentResponse;
        return parsed;
      } catch (error) {
        this.logger.error({ stdout }, "Réponse JSON invalide reçue du remoteAgent.ps1");
        return {
          action: job.action,
          fqbn: context.profile.fqbn,
          status: "ERROR",
          error: `Réponse JSON invalide: ${stdout}`,
          logs: stderr.length > 0 ? stderr.split(/\r?\n/) : []
        };
      }
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: message }, "Échec de l'exécution WinRM/PowerShell");
      return {
        action: job.action,
        fqbn: context.profile.fqbn,
        status: "ERROR",
        error: message,
        logs: []
      };
    }
  }
}
