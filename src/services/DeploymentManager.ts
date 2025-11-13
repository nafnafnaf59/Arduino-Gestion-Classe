import { ClassroomConfig, DeploymentContext, DeploymentJob, DeploymentOptions, DeploymentProfile, DeploymentResult, DeploymentStrategy, DeploymentSummary, HostGroup, HostRecord, JobState, QueueSnapshot, SketchAnalysisResult, SketchMetadata } from "../models/types";
import { getLogger } from "../utils/logger";
import { HostRegistry } from "./HostRegistry";
import { JobQueue, JobQueueOptions } from "./JobQueue";
import { SketchAnalyzer, AnalyzeOptions } from "./SketchAnalyzer";
import {
  loadConfig,
  saveConfig,
  LoadConfigOptions,
  ConfigLoadResult,
  resolveWorkspacePath
} from "../utils/config";

interface DeploymentManagerOptions {
  readonly jobQueueOptions?: Partial<JobQueueOptions>;
  readonly configOptions?: LoadConfigOptions;
}

interface DeploySketchParams {
  readonly hosts: ReadonlyArray<HostRecord>;
  readonly metadata: SketchMetadata;
  readonly profileId: string;
  readonly mode?: DeploymentJob["mode"];
  readonly options?: DeploymentOptions;
}

interface EnqueueEraseParams {
  readonly hosts: ReadonlyArray<HostRecord>;
  readonly profileId: string;
  readonly sketchPath: string;
}

export class DeploymentManager {
  private readonly logger = getLogger("DeploymentManager");
  private readonly jobQueue: JobQueue;
  private readonly hostRegistry: HostRegistry;
  private readonly sketchAnalyzer: SketchAnalyzer;
  private readonly strategies = new Map<string, DeploymentStrategy>();
  private readonly sketchCache = new Map<string, SketchMetadata>();

  private config?: ClassroomConfig;
  private workspaceDir?: string;
  private currentProfileId?: string;
  private configOptions?: LoadConfigOptions;

  constructor(
    dependencies: {
      hostRegistry?: HostRegistry;
      sketchAnalyzer?: SketchAnalyzer;
  winrmClient?: DeploymentStrategy;
    } = {},
    options: DeploymentManagerOptions = {}
  ) {
    this.hostRegistry = dependencies.hostRegistry ?? new HostRegistry();
    this.sketchAnalyzer = dependencies.sketchAnalyzer ?? new SketchAnalyzer();
    this.jobQueue = new JobQueue(this.executeJob.bind(this), {
      maxParallel: 4,
      retryCount: 1,
      throttleMs: 0,
      ...options.jobQueueOptions
    });

    this.configOptions = options.configOptions;
    this.jobQueue.start();

    if (dependencies.winrmClient) {
      this.registerStrategy(dependencies.winrmClient);
    }
  }

  async initialize(): Promise<ConfigLoadResult> {
    const loadResult = await loadConfig({ ...this.configOptions, createIfMissing: true });
    this.config = loadResult.config;
    this.workspaceDir = loadResult.workspaceDir;
    this.currentProfileId = this.config.profiles[0]?.id;

    this.hostRegistry.setHosts(this.config.hosts);
    this.hostRegistry.setGroups([]);

    this.logger.info(
      {
        profiles: this.config.profiles.length,
        hosts: this.config.hosts.length
      },
      "Configuration chargée"
    );

    return loadResult;
  }

  getJobQueue(): JobQueue {
    return this.jobQueue;
  }

  getSnapshot(): QueueSnapshot {
    return this.jobQueue.getSnapshot();
  }

  observeJobs() {
    return this.jobQueue.observeJobs();
  }

  getProfiles(): ReadonlyArray<DeploymentProfile> {
    return this.config?.profiles ?? [];
  }

  getActiveProfile(): DeploymentProfile | undefined {
    if (!this.currentProfileId) {
      return undefined;
    }
    return this.getProfile(this.currentProfileId);
  }

  getProfile(profileId: string): DeploymentProfile | undefined {
    return this.config?.profiles.find((profile) => profile.id === profileId);
  }

  selectProfile(profileId: string): void {
    if (!this.getProfile(profileId)) {
      throw new Error(`Profil ${profileId} introuvable`);
    }
    this.currentProfileId = profileId;
  }

  async saveProfile(profile: DeploymentProfile): Promise<void> {
    if (!this.config) {
      throw new Error("Configuration non chargée");
    }

    const profiles = [...this.config.profiles];
    const existingIndex = profiles.findIndex((item) => item.id === profile.id);
    if (existingIndex >= 0) {
      profiles.splice(existingIndex, 1, profile);
    } else {
      profiles.push(profile);
    }

    this.config = {
      ...this.config,
      profiles
    };

    await saveConfig(this.config, this.configOptions);
  }

  getHosts(): ReadonlyArray<HostRecord> {
    return this.hostRegistry.listHosts();
  }

  getHostById(hostId: string): HostRecord | undefined {
    return this.hostRegistry.getHostById(hostId);
  }

  setHostEnabled(hostId: string, enabled: boolean): void {
    const host = this.hostRegistry.getHostById(hostId);
    if (!host) {
      return;
    }
    this.hostRegistry.upsertHost({
      ...host,
      enabled
    });
  }

  getGroups(): ReadonlyArray<HostGroup> {
    return this.hostRegistry.listGroups();
  }

  async analyzeSketch(options: AnalyzeOptions): Promise<SketchAnalysisResult> {
    return this.sketchAnalyzer.analyze(options);
  }

  async compileSketch(sketchPath: string, profileId?: string): Promise<SketchMetadata> {
    const profile = this.resolveProfile(profileId);
    const cacheKey = this.buildCacheKey(sketchPath, profile.fqbn);
    const cached = this.sketchCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const metadata = await this.sketchAnalyzer.compile({ sketchPath, fqbn: profile.fqbn });
    this.sketchCache.set(cacheKey, metadata);
    return metadata;
  }

  async deploy(params: DeploySketchParams): Promise<ReadonlyArray<DeploymentJob>> {
    if (!this.config) {
      throw new Error("Configuration non chargée");
    }

    const profile = this.resolveProfile(params.profileId);
    const jobs: DeploymentJob[] = [];

    params.hosts.forEach((host) => {
      const context = this.createContext(host, profile, params.options);
      const job = this.jobQueue.enqueue({
        hostId: host.id,
        action: "upload",
        profileId: profile.id,
        sketchPath: params.metadata.sketchPath,
        hexPath: params.metadata.binaryPath,
        mode: params.mode ?? "normal",
        context
      });
      jobs.push(job);
    });

    return jobs;
  }

  async enqueueErase(params: EnqueueEraseParams): Promise<ReadonlyArray<DeploymentJob>> {
    const profile = this.resolveProfile(params.profileId);
    const eraseSketch = this.sketchAnalyzer.buildEraseSketchTemplate(params.hosts[0], profile.fqbn);
    const hexPath = resolveWorkspacePath("erase.hex", this.workspaceDir);

    const jobs: DeploymentJob[] = [];

    params.hosts.forEach((host) => {
      const context = this.createContext(host, profile, { dryRun: false });
      const job = this.jobQueue.enqueue({
        hostId: host.id,
        action: "erase",
        profileId: profile.id,
        hexPath,
        sketchPath: params.sketchPath,
        mode: "normal",
        context
      });
      jobs.push(job);
    });

    return jobs;
  }

  retryFailedJobs(): ReadonlyArray<DeploymentJob> {
    const snapshot = this.jobQueue.getSnapshot();
    const failedJobs = snapshot.jobs.filter((job) => job.status === "failed");
    const retried: DeploymentJob[] = [];

    failedJobs.forEach((job) => {
      const host = this.requireHost(job.hostId);
      const profile = this.resolveProfile(job.profileId);
      const context = this.createContext(host, profile, {
        dryRun: job.mode === "dry-run"
      });
      const newJob = this.jobQueue.enqueue({
        hostId: job.hostId,
        action: job.action,
        profileId: job.profileId,
        sketchPath: job.sketchPath,
        hexPath: job.hexPath,
        mode: job.mode,
        context
      });
      retried.push(newJob);
    });

    return retried;
  }

  cancelPendingJobs(): void {
    this.jobQueue.cancelAll();
  }

  summarizeDeployment(): DeploymentSummary[] {
    const snapshot = this.jobQueue.getSnapshot();
    return snapshot.jobs
      .filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status))
      .map((job) => ({
        jobId: job.id,
        hostId: job.hostId,
        status: job.status as JobState,
        elapsedMs: job.metrics.elapsedMs,
        error: job.error
      }));
  }

  registerStrategy(strategy: DeploymentStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  private async executeJob(job: DeploymentJob, context: DeploymentContext): Promise<DeploymentResult> {
    const strategy = this.getStrategyForHost(context.host);
    if (!strategy) {
      throw new Error(`Aucune stratégie de déploiement disponible pour ${context.host.os}`);
    }
    return strategy.execute(job, context);
  }

  private getStrategyForHost(host: HostRecord): DeploymentStrategy | undefined {
    for (const strategy of this.strategies.values()) {
      if (strategy.supports(host)) {
        return strategy;
      }
    }
    return undefined;
  }

  private resolveProfile(profileId?: string): DeploymentProfile {
    const effectiveId = profileId ?? this.currentProfileId;
    if (!effectiveId) {
      throw new Error("Aucun profil actif");
    }
    const profile = this.getProfile(effectiveId);
    if (!profile) {
      throw new Error(`Profil ${effectiveId} introuvable`);
    }
    return profile;
  }

  private requireHost(hostId: string): HostRecord {
    const host = this.hostRegistry.getHostById(hostId);
    if (!host) {
      throw new Error(`Hôte ${hostId} introuvable dans le registre`);
    }
    return host;
  }

  private createContext(host: HostRecord, profile: DeploymentProfile, options?: DeploymentOptions): DeploymentContext {
    if (!this.config) {
      throw new Error("Configuration non chargée");
    }

    return {
      config: this.config,
      profile,
      host,
      options: options ?? {}
    };
  }

  private buildCacheKey(sketchPath: string, fqbn: string): string {
    return `${sketchPath}|${fqbn}`;
  }
}
