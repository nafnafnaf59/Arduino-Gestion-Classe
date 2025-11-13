import * as fs from "fs/promises";
import path from "path";
import process from "process";
import type { AnySchema } from "ajv";
import { ClassroomConfig, ClassroomOptions, DeploymentProfile, LogFormat } from "../models/types";
import configSchema from "../../classroom-config.schema.json";
import { assertValid, compileSchema, SchemaValidationError } from "./validator";
import { configureLogger, getLogDirectory, getLogger } from "./logger";

const logger = getLogger("Config");

const DEFAULT_CONFIG_FILENAME = "classroom-config.json";
const DEFAULT_PROFILE: DeploymentProfile = {
  id: "default",
  label: "Profil par défaut",
  description: "Créé automatiquement lors de la première initialisation.",
  fqbn: "arduino:avr:uno",
  baudRate: 115200,
  maxParallel: 8,
  timeoutMs: 180000,
  logFormat: "text",
  retryCount: 1
};

const validateConfig = compileSchema<ClassroomConfig>(configSchema as AnySchema);

interface FileSystemError extends Error {
  code?: string;
}

function isFileSystemError(input: unknown): input is FileSystemError {
  return Boolean(input) && typeof (input as FileSystemError).code === "string";
}

export interface LoadConfigOptions {
  readonly workspaceDir?: string;
  readonly configPath?: string;
  readonly defaults?: Partial<ClassroomConfig>;
  readonly createIfMissing?: boolean;
  readonly logFormatOverride?: LogFormat;
}

export interface ConfigLoadResult {
  readonly config: ClassroomConfig;
  readonly path: string;
  readonly workspaceDir: string;
}

export function getWorkspaceDirectory(options?: LoadConfigOptions): string {
  const provided = options?.workspaceDir ?? process.env.ARDUINO_CLASSROOM_WORKSPACE;
  const base = provided && provided.trim().length > 0 ? provided : process.cwd();
  return path.resolve(base);
}

export function getConfigPath(options?: LoadConfigOptions): string {
  if (options?.configPath) {
    return path.resolve(options.configPath);
  }

  const workspaceDir = getWorkspaceDirectory(options);
  return path.join(workspaceDir, DEFAULT_CONFIG_FILENAME);
}

export async function ensureWorkspaceStructure(workspaceDir: string): Promise<void> {
  const directories = [workspaceDir, path.join(workspaceDir, "logs"), path.join(workspaceDir, "tmp")];
  await Promise.all(directories.map(async (dir) => fs.mkdir(dir, { recursive: true })));
}

export function createDefaultConfig(workspaceDir: string, overrides: Partial<ClassroomConfig> = {}): ClassroomConfig {
  const options: ClassroomOptions = {
    logDirectory: path.join(workspaceDir, "logs"),
    auditEnabled: true,
    autoUpdate: false,
    ...overrides.options
  };

  const profiles = overrides.profiles && overrides.profiles.length > 0
    ? [...overrides.profiles]
    : [
        {
          ...DEFAULT_PROFILE,
          logFormat: overrides.profiles?.[0]?.logFormat ?? DEFAULT_PROFILE.logFormat
        }
      ];

  const hosts = overrides.hosts ? [...overrides.hosts] : [];

  return {
    profiles,
    hosts,
    options
  };
}

export async function loadConfig(options?: LoadConfigOptions): Promise<ConfigLoadResult> {
  const workspaceDir = getWorkspaceDirectory(options);
  await ensureWorkspaceStructure(workspaceDir);

  const configPath = getConfigPath({ ...options, workspaceDir });

  let rawContent: string | undefined;

  try {
    rawContent = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    const isNotFound = isFileSystemError(error) && error.code === "ENOENT";
    if (!isNotFound || options?.createIfMissing === false) {
      throw error;
    }

    const defaultConfig = createDefaultConfig(workspaceDir, options?.defaults ?? {});
    await saveConfigInternal(configPath, defaultConfig);
    rawContent = JSON.stringify(defaultConfig, null, 2);
    logger.info({ configPath }, "Configuration générée par défaut");
  }

  if (!rawContent) {
    throw new Error(`Configuration vide détectée à l'emplacement ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    throw new Error(`Le fichier de configuration ${configPath} n'est pas un JSON valide: ${(error as Error).message}`);
  }

  let config: ClassroomConfig;
  try {
    config = assertValid<ClassroomConfig>(validateConfig, parsed);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      logger.error({ errors: error.details }, "Validation du fichier de configuration échouée");
    }
    throw error;
  }

  const logDirectory = config.options?.logDirectory ?? path.join(workspaceDir, "logs");
  configureLogger({
    logDirectory,
    logFormat: options?.logFormatOverride ?? config.profiles[0]?.logFormat ?? "text"
  });

  return {
    config,
    path: configPath,
    workspaceDir
  };
}

export async function saveConfig(config: ClassroomConfig, options?: LoadConfigOptions): Promise<void> {
  const workspaceDir = getWorkspaceDirectory(options);
  await ensureWorkspaceStructure(workspaceDir);

  const configPath = getConfigPath({ ...options, workspaceDir });
  await saveConfigInternal(configPath, config);
}

async function saveConfigInternal(configPath: string, config: ClassroomConfig): Promise<void> {
  assertValid<ClassroomConfig>(validateConfig, config);
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  await fs.writeFile(configPath, serialized, "utf-8");
}

export async function reloadConfig(options?: LoadConfigOptions): Promise<ClassroomConfig> {
  const { config } = await loadConfig(options);
  return config;
}

export async function touchConfig(options?: LoadConfigOptions): Promise<void> {
  const configPath = getConfigPath(options);
  try {
    await fs.utimes(configPath, new Date(), new Date());
  } catch (error) {
    if (!isFileSystemError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

export function resolveWorkspacePath(relativePath: string, workspaceDir?: string): string {
  const base = workspaceDir ?? path.dirname(getLogDirectory());
  return path.resolve(base, relativePath);
}
