import { existsSync, mkdirSync } from "fs";
import path from "path";
import process from "process";
import pino, { DestinationStream, Logger } from "pino";
import { LogFormat } from "../models/types";

export interface LoggerConfiguration {
  level?: string;
  logDirectory?: string;
  logFormat?: LogFormat;
}

const DEFAULT_DATA_DIR_ENV = "ARDUINO_CLASSROOM_DATA_DIR";
const DEFAULT_LOG_LEVEL_ENV = "ARDUINO_CLASSROOM_LOG_LEVEL";

let currentLogDirectory = resolveDefaultLogDirectory();
let currentLogFormat: LogFormat = "text";
let currentLevel = process.env[DEFAULT_LOG_LEVEL_ENV] ?? "info";
let destination: DestinationStream = createDestination(currentLogDirectory, currentLogFormat);
let rootLogger: Logger = createRootLogger(destination, currentLevel);

function resolveDefaultLogDirectory(): string {
  const baseDir = process.env[DEFAULT_DATA_DIR_ENV] ?? path.join(process.cwd(), ".arduinoClassroom");
  const logsDir = path.join(baseDir, "logs");
  ensureDirectory(logsDir);
  return logsDir;
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createDestination(dir: string, format: LogFormat): DestinationStream {
  ensureDirectory(dir);
  const suffix = format === "json" ? "jsonl" : "log";
  const logFile = path.join(dir, `arduino-classroom-session.${suffix}`);
  return pino.destination({ dest: logFile, append: true, sync: false, mkdir: true });
}

function createRootLogger(dest: DestinationStream, level: string): Logger {
  return pino(
    {
      level,
      base: {
        app: "arduino-classroom-deploy"
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "message"
    },
    dest
  );
}

function reconfigureLogger(): void {
  destination.end?.();
  destination = createDestination(currentLogDirectory, currentLogFormat);
  rootLogger = createRootLogger(destination, currentLevel);
}

export function configureLogger(config: LoggerConfiguration = {}): void {
  let updated = false;

  if (config.logDirectory && config.logDirectory !== currentLogDirectory) {
    currentLogDirectory = config.logDirectory;
    updated = true;
  }

  if (config.logFormat && config.logFormat !== currentLogFormat) {
    currentLogFormat = config.logFormat;
    updated = true;
  }

  if (config.level && config.level !== currentLevel) {
    currentLevel = config.level;
    updated = true;
  }

  if (updated) {
    reconfigureLogger();
  }
}

export function getLogger(scope?: string): Logger {
  if (!rootLogger) {
    rootLogger = createRootLogger(destination, currentLevel);
  }

  if (scope) {
    return rootLogger.child({ scope });
  }

  return rootLogger;
}

export function getLogDirectory(): string {
  return currentLogDirectory;
}
