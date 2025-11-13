import { EventEmitter } from "events";
import { setTimeout as delay } from "timers/promises";
import { BehaviorSubject, Observable } from "rxjs";
import { v4 as uuidv4 } from "uuid";
import {
  DeploymentJob,
  DeploymentResult,
  DeploymentContext,
  JobState,
  QueueSnapshot,
  QueueTelemetry
} from "../models/types";
import { getLogger } from "../utils/logger";

export type JobExecutor = (
  job: DeploymentJob,
  context: DeploymentContext
) => Promise<DeploymentResult>;

export interface JobQueueOptions {
  readonly maxParallel: number;
  readonly retryCount: number;
  readonly throttleMs: number;
  readonly metricsWindowSize?: number;
}

export interface EnqueueJobInput {
  readonly hostId: string;
  readonly action: DeploymentJob["action"];
  readonly profileId: string;
  readonly sketchPath?: string;
  readonly hexPath?: string;
  readonly mode?: DeploymentJob["mode"];
  readonly context: DeploymentContext;
}

export interface JobQueueEvents {
  jobEnqueued: [DeploymentJob];
  jobStarted: [DeploymentJob];
  jobCompleted: [DeploymentJob];
  jobFailed: [DeploymentJob, unknown];
  jobRetried: [DeploymentJob, number];
  snapshot: [QueueSnapshot];
}

const DEFAULT_OPTIONS: JobQueueOptions = {
  maxParallel: 4,
  retryCount: 1,
  throttleMs: 0,
  metricsWindowSize: 50
};

function nowIso(): string {
  return new Date().toISOString();
}

function createInitialJob(input: EnqueueJobInput): DeploymentJob {
  return {
    id: uuidv4(),
    hostId: input.hostId,
    action: input.action,
    profileId: input.profileId,
    sketchPath: input.sketchPath,
    hexPath: input.hexPath,
    mode: input.mode ?? "normal",
    status: "queued",
    metrics: {
      queuedAt: nowIso(),
      attempt: 0
    }
  };
}

interface RunningJobContext {
  readonly job: DeploymentJob;
  readonly context: DeploymentContext;
}

export class JobQueue {
  private readonly logger = getLogger("JobQueue");
  private readonly emitter = new EventEmitter();
  private readonly jobSubject = new BehaviorSubject<ReadonlyArray<DeploymentJob>>([]);
  private readonly contextByJob = new Map<string, DeploymentContext>();
  private readonly options: JobQueueOptions;
  private readonly jobs = new Map<string, DeploymentJob>();
  private readonly waitingQueue: string[] = [];
  private readonly activeJobs = new Map<string, RunningJobContext>();
  private readonly completedDurations: number[] = [];
  private readonly completionHistory: number[] = [];
  private readonly executor: JobExecutor;
  private running = false;
  private processing = false;
  private lastStartTimestamp = 0;

  constructor(executor: JobExecutor, options: Partial<JobQueueOptions> = {}) {
    this.executor = executor;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.emitter.setMaxListeners(50);
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.processQueue();
  }

  stop(): void {
    this.running = false;
  }

  on<E extends keyof JobQueueEvents>(event: E, listener: (...args: JobQueueEvents[E]) => void): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<E extends keyof JobQueueEvents>(event: E, listener: (...args: JobQueueEvents[E]) => void): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  observeJobs(): Observable<ReadonlyArray<DeploymentJob>> {
    return this.jobSubject.asObservable();
  }

  getSnapshot(): QueueSnapshot {
    const jobs = Array.from(this.jobs.values());
    const waitingCount = this.waitingQueue.length;
    const activeCount = this.activeJobs.size;
    const completedCount = jobs.filter((job) => job.status === "succeeded").length;
    const failedCount = jobs.filter((job) => job.status === "failed").length;

    return {
      jobs,
      activeCount,
      waitingCount,
      completedCount,
      failedCount
    };
  }

  getTelemetry(): QueueTelemetry {
    const durations = this.completedDurations.slice(-1 * (this.options.metricsWindowSize ?? 50));
    const averageDurationMs = durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0;

    const completions = this.completionHistory.slice(-1 * (this.options.metricsWindowSize ?? 50));
    const now = Date.now();
    const perMinuteWindow = completions.filter((timestamp) => now - timestamp <= 60_000);
    const throughputPerMinute = perMinuteWindow.length;

    const jobs = Array.from(this.jobs.values());
    const total = jobs.filter((job) => ["succeeded", "failed"].includes(job.status)).length || 1;
    const successRate = jobs.filter((job) => job.status === "succeeded").length / total;
    const failureRate = jobs.filter((job) => job.status === "failed").length / total;

    return {
      averageDurationMs,
      throughputPerMinute,
      successRate,
      failureRate
    };
  }

  enqueue(input: EnqueueJobInput): DeploymentJob {
    const job = createInitialJob(input);
    this.jobs.set(job.id, job);
    this.waitingQueue.push(job.id);
    this.contextByJob.set(job.id, input.context);
    this.publishJobs();
    this.emitter.emit("jobEnqueued", job);
    this.logger.debug({ jobId: job.id, hostId: job.hostId }, "Job enqueued");
    void this.processQueue();
    return job;
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    if (this.activeJobs.has(jobId)) {
      this.logger.warn({ jobId }, "Tentative d'annuler un job en cours – action non supportée");
      return;
    }

    const index = this.waitingQueue.indexOf(jobId);
    if (index >= 0) {
      this.waitingQueue.splice(index, 1);
    }
    const cancelledJob: DeploymentJob = {
      ...job,
      status: "cancelled",
      metrics: {
        ...job.metrics,
        completedAt: nowIso(),
        elapsedMs: 0
      }
    };
    this.jobs.set(jobId, cancelledJob);
    this.publishJobs();
    this.emitter.emit("jobCompleted", cancelledJob);
  }

  cancelAll(): void {
    const waitingIds = [...this.waitingQueue];
    waitingIds.forEach((jobId) => this.cancel(jobId));
  }

  getJob(jobId: string): DeploymentJob | undefined {
    return this.jobs.get(jobId);
  }

  private publishJobs(): void {
    this.jobSubject.next(Array.from(this.jobs.values()));
    this.emitter.emit("snapshot", this.getSnapshot());
  }

  private async processQueue(): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }
    this.processing = true;

    try {
      while (this.running && this.activeJobs.size < this.options.maxParallel && this.waitingQueue.length > 0) {
        const jobId = this.waitingQueue.shift();
        if (!jobId) {
          break;
        }

        const job = this.jobs.get(jobId);
        const context = this.contextByJob.get(jobId);
        if (!job || !context) {
          continue;
        }

        const now = Date.now();
        const deltaSinceLastStart = now - this.lastStartTimestamp;
        if (this.options.throttleMs > 0 && deltaSinceLastStart < this.options.throttleMs) {
          const waitDuration = this.options.throttleMs - deltaSinceLastStart;
          await delay(waitDuration);
        }

        this.lastStartTimestamp = Date.now();
        this.startJob(job, context);
      }
    } finally {
      this.processing = false;
    }
  }

  private startJob(job: DeploymentJob, context: DeploymentContext): void {
    const attempt = job.metrics.attempt + 1;
    const startedAt = nowIso();
    const runningJob: DeploymentJob = {
      ...job,
      status: "running",
      metrics: {
        ...job.metrics,
        attempt,
        startedAt
      }
    };

    this.jobs.set(job.id, runningJob);
    this.activeJobs.set(job.id, { job: runningJob, context });
    this.publishJobs();
    this.emitter.emit("jobStarted", runningJob);

    void this.executeJob(runningJob, context);
  }

  private async executeJob(job: DeploymentJob, context: DeploymentContext): Promise<void> {
    try {
      const result = await this.executor(job, context);
      const completedAt = nowIso();
      const elapsedMs = result.elapsedMs ?? this.computeDuration(job.metrics.startedAt ?? job.metrics.queuedAt, completedAt);
      const completedJob: DeploymentJob = {
        ...job,
        status: result.status === "OK" ? "succeeded" : result.status === "TIMEOUT" ? "failed" : "failed",
        metrics: {
          ...job.metrics,
          completedAt,
          elapsedMs
        },
        result,
        error: result.error
      };

      this.jobs.set(job.id, completedJob);
      this.trackMetrics(completedJob);
      this.emitter.emit("jobCompleted", completedJob);
      this.logger.info({ jobId: job.id, hostId: job.hostId, status: completedJob.status }, "Job completed");
    } catch (error) {
      await this.handleJobFailure(job, context, error);
    } finally {
      this.activeJobs.delete(job.id);
      this.publishJobs();
      void this.processQueue();
    }
  }

  private computeDuration(startIso: string | undefined, endIso: string): number {
    if (!startIso) {
      return 0;
    }
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    return Math.max(0, end - start);
  }

  private trackMetrics(job: DeploymentJob): void {
    if (job.metrics.elapsedMs) {
      this.completedDurations.push(job.metrics.elapsedMs);
      if (this.completedDurations.length > (this.options.metricsWindowSize ?? 50)) {
        this.completedDurations.shift();
      }
    }
    this.completionHistory.push(Date.now());
    if (this.completionHistory.length > 200) {
      this.completionHistory.shift();
    }
  }

  private async handleJobFailure(job: DeploymentJob, context: DeploymentContext, error: unknown): Promise<void> {
    const attemptsRemaining = this.options.retryCount - job.metrics.attempt;
    this.logger.error({ jobId: job.id, hostId: job.hostId, error }, "Job failed");

    if (attemptsRemaining > 0) {
      const retriedJob: DeploymentJob = {
        ...job,
        status: "queued",
        metrics: {
          ...job.metrics,
          startedAt: undefined,
          completedAt: undefined,
          elapsedMs: undefined
        },
        error: String(error)
      };

      this.jobs.set(job.id, retriedJob);
      this.waitingQueue.push(job.id);
      this.emitter.emit("jobRetried", retriedJob, retriedJob.metrics.attempt + 1);
      this.publishJobs();
      await delay(100);
      void this.processQueue();
      return;
    }

    const completedAt = nowIso();
    const failedJob: DeploymentJob = {
      ...job,
      status: "failed",
      metrics: {
        ...job.metrics,
        completedAt,
        elapsedMs: this.computeDuration(job.metrics.startedAt ?? job.metrics.queuedAt, completedAt)
      },
      error: error instanceof Error ? error.message : String(error)
    };

    this.jobs.set(job.id, failedJob);
    this.emitter.emit("jobFailed", failedJob, error);
  }
}
