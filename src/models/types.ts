/**
 * Types et contrats partagés entre les services et l'UI.
 */

export type HostOperatingSystem = "windows" | "linux" | "macos";

export type LogFormat = "text" | "json";

export interface HostRecord {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly os: HostOperatingSystem;
  readonly tags: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly groups?: ReadonlyArray<string>;
  readonly notes?: string;
  readonly lastSeenAt?: string;
}

export interface HostGroup {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly hostIds: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
}

export interface CredentialDescriptor {
  readonly id: string;
  readonly label: string;
  readonly type: "winrm" | "ssh";
  readonly username?: string;
  readonly keyId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scopes: ReadonlyArray<string>;
}

export type DeploymentAction = "detect" | "upload" | "erase";

export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface JobMetrics {
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly elapsedMs?: number;
  readonly attempt: number;
}

export interface DeploymentJob {
  readonly id: string;
  readonly hostId: string;
  readonly action: DeploymentAction;
  readonly profileId: string;
  readonly sketchPath?: string;
  readonly hexPath?: string;
  readonly mode: "normal" | "dry-run";
  readonly status: JobState;
  readonly metrics: JobMetrics;
  readonly result?: DeploymentResult;
  readonly error?: string;
}

export interface DeploymentResult {
  readonly status: "OK" | "ERROR" | "TIMEOUT";
  readonly port?: string;
  readonly elapsedMs?: number;
  readonly logs: ReadonlyArray<string>;
  readonly error?: string;
  readonly checksum?: string;
}

export interface RemoteAgentResponse {
  readonly action: DeploymentAction;
  readonly fqbn: string;
  readonly port?: string;
  readonly cliPath?: string;
  readonly status: "OK" | "ERROR";
  readonly error?: string;
  readonly logs: ReadonlyArray<string>;
}

export interface SketchMetadata {
  readonly sketchPath: string;
  readonly compiledAt?: string;
  readonly binaryPath?: string;
  readonly fqbn: string;
  readonly boardName?: string;
  readonly flashUsageBytes?: number;
  readonly ramUsageBytes?: number;
  readonly sizeEstimate?: number;
  readonly hash?: string;
}

export interface SketchAnalysisResult {
  readonly metadata: SketchMetadata;
  readonly dependencies: ReadonlyArray<string>;
  readonly missingLibraries: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export interface DeploymentProfile {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly fqbn: string;
  readonly baudRate?: number;
  readonly maxParallel: number;
  readonly timeoutMs: number;
  readonly logFormat?: LogFormat;
  readonly defaultSketch?: string;
  readonly retryCount?: number;
}

export interface DeploymentOptions {
  readonly dryRun?: boolean;
  readonly verbose?: boolean;
  readonly throttle?: number;
  readonly timeoutMs?: number;
  readonly logFormat?: LogFormat;
}

export interface SketchOption {
  readonly id: string;
  readonly label: string;
  readonly path: string;
}

export interface ClassroomOptions {
  readonly logDirectory?: string;
  readonly auditEnabled?: boolean;
  readonly autoUpdate?: boolean;
}

export interface ClassroomConfig {
  readonly profiles: ReadonlyArray<DeploymentProfile>;
  readonly hosts: ReadonlyArray<HostRecord>;
  readonly options?: ClassroomOptions;
}

export interface QueueSnapshot {
  readonly jobs: ReadonlyArray<DeploymentJob>;
  readonly activeCount: number;
  readonly waitingCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
}

export interface QueueTelemetry {
  readonly averageDurationMs: number;
  readonly successRate: number;
  readonly failureRate: number;
  readonly throughputPerMinute: number;
}

export interface AuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly targets: ReadonlyArray<string>;
  readonly payload?: Record<string, unknown>;
  readonly result: "success" | "failure";
  readonly error?: string;
}

export interface DeploymentSummary {
  readonly jobId: string;
  readonly hostId: string;
  readonly status: JobState;
  readonly elapsedMs?: number;
  readonly error?: string;
}

export interface DeploymentReport {
  readonly sketch: SketchMetadata;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly results: ReadonlyArray<DeploymentSummary>;
  readonly totals: {
    readonly success: number;
    readonly failure: number;
    readonly cancelled: number;
  };
}

export interface DeploymentContext {
  readonly config: ClassroomConfig;
  readonly profile: DeploymentProfile;
  readonly host: HostRecord;
  readonly options: DeploymentOptions;
}

export interface DeploymentStrategy {
  readonly id: string;
  readonly label: string;
  supports(host: HostRecord): boolean;
  execute(job: DeploymentJob, context: DeploymentContext): Promise<DeploymentResult>;
}

export interface CredentialStorage {
  save(credential: CredentialDescriptor, secret: string): Promise<void>;
  load(id: string): Promise<string | undefined>;
  delete(id: string): Promise<void>;
  list(): Promise<ReadonlyArray<CredentialDescriptor>>;
}

export interface ConfigWatchEvent {
  readonly type: "changed" | "deleted" | "created";
  readonly path: string;
  readonly timestamp: string;
}
