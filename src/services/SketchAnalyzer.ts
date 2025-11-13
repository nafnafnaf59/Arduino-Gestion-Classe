import { readFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import process from "process";
import { execFile } from "child_process";
import { promisify } from "util";
import { HostRecord, SketchAnalysisResult, SketchMetadata } from "../models/types";
import { getLogger } from "../utils/logger";

const execFileAsync = promisify(execFile);

export interface CompileOptions {
  readonly fqbn: string;
  readonly sketchPath: string;
  readonly outputDir?: string;
  readonly clean?: boolean;
  readonly verbose?: boolean;
}

export interface AnalyzeOptions extends CompileOptions {
  readonly installedLibraries?: ReadonlyArray<string>;
}

export interface ArduinoCliInfo {
  readonly path: string;
  readonly version?: string;
}

export class SketchAnalyzer {
  private readonly logger = getLogger("SketchAnalyzer");
  private cachedCliPath?: ArduinoCliInfo;

  constructor(private readonly arduinoCliPath?: string) {}

  async detectArduinoCli(): Promise<ArduinoCliInfo> {
    if (this.cachedCliPath) {
      return this.cachedCliPath;
    }

    const candidatePaths = [
      this.arduinoCliPath,
      process.env.ARDUINO_CLI_PATH,
      "arduino-cli.exe",
      "arduino-cli"
    ].filter((value): value is string => Boolean(value));

    for (const cliPath of candidatePaths) {
      try {
        const { stdout } = await execFileAsync(cliPath, ["version", "--format", "json"]);
        const version = JSON.parse(stdout).VersionString as string | undefined;
        this.cachedCliPath = { path: cliPath, version };
        return this.cachedCliPath;
      } catch (error) {
        this.logger.debug({ cliPath, error }, "Impossible d'interroger arduino-cli");
      }
    }

    throw new Error(
      "arduino-cli introuvable. Installez-le ou renseignez la variable d'environnement ARDUINO_CLI_PATH."
    );
  }

  async compile(options: CompileOptions): Promise<SketchMetadata> {
    const cli = await this.detectArduinoCli();
    const sketchDir = path.resolve(options.sketchPath);
    const sketchName = path.basename(sketchDir);
    const outputDir = options.outputDir ?? path.join(sketchDir, "build");

    const args = ["compile", "--fqbn", options.fqbn, sketchDir, "--export-binaries", "--output", outputDir];
    if (options.verbose) {
      args.push("-v");
    }
    if (options.clean) {
      args.push("--clean-cache");
    }

    this.logger.info({ fqbn: options.fqbn, sketch: sketchDir }, "Compilation du sketch");
    const start = Date.now();
    try {
      const { stdout } = await execFileAsync(cli.path, args, {
        cwd: sketchDir
      });
      this.logger.debug({ stdout }, "Sortie arduino-cli");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Échec de la compilation du sketch ${sketchDir}: ${message}`);
    }

    const binaryPath = await this.findCompiledBinary(outputDir, sketchName);
    const hash = await this.computeFileHash(binaryPath);
    const stats = await this.collectBinaryStats(binaryPath);

    return {
      sketchPath: sketchDir,
      compiledAt: new Date(start).toISOString(),
      binaryPath,
      fqbn: options.fqbn,
      ...stats,
      hash
    };
  }

  async analyze(options: AnalyzeOptions): Promise<SketchAnalysisResult> {
    const [metadata, includes, installedLibraries] = await Promise.all([
      this.compile(options),
      this.detectIncludes(options.sketchPath),
      this.listInstalledLibraries(options.installedLibraries)
    ]);

    const missingLibraries = includes.filter((dep) => !installedLibraries.includes(dep));

    return {
      metadata,
      dependencies: includes,
      missingLibraries,
      warnings: missingLibraries.length > 0 ? [
        `Bibliothèques manquantes: ${missingLibraries.join(", ")}`
      ] : []
    };
  }

  private async listInstalledLibraries(precomputed?: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
    if (precomputed) {
      return precomputed;
    }

    try {
      const cli = await this.detectArduinoCli();
      const { stdout } = await execFileAsync(cli.path, ["lib", "list", "--format", "json"]);
      const parsed = JSON.parse(stdout) as Array<{ Name: string }>;
      return parsed.map((entry) => entry.Name.toLowerCase());
    } catch (error) {
      this.logger.warn({ error }, "Impossible de lister les bibliothèques installées");
      return [];
    }
  }

  private async detectIncludes(sketchPath: string): Promise<ReadonlyArray<string>> {
    const files = [".ino", ".cpp", ".h", ".hpp", ".c"].map((ext) =>
      path.join(sketchPath, `${path.basename(sketchPath)}${ext}`)
    );

    const dependencies = new Set<string>();

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, "utf-8");
        const matches = content.match(/#include\s+[<"]([^>"]+)[>"]/g) ?? [];
        matches.forEach((includeMatch: string) => {
          const library = includeMatch
            .replace(/#include\s+[<"]/, "")
            .replace(/[>"]/, "")
            .split("/")[0];
          dependencies.add(library.toLowerCase());
        });
      } catch (error) {
        // Fichier optionnel, on ignore
      }
    }

    return Array.from(dependencies);
  }

  private async findCompiledBinary(outputDir: string, sketchName: string): Promise<string> {
    const expected = path.join(outputDir, `${sketchName}.ino.hex`);
    return expected;
  }

  private async computeFileHash(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    const hash = createHash("sha256");
    hash.update(content);
    return hash.digest("hex");
  }

  private async collectBinaryStats(binaryPath: string): Promise<Pick<SketchMetadata, "sizeEstimate">> {
    try {
      const content = await readFile(binaryPath);
      return {
        sizeEstimate: content.byteLength
      };
    } catch (error) {
      this.logger.warn({ error, binaryPath }, "Impossible de lire le binaire compilé");
      return {};
    }
  }

  buildEraseSketchTemplate(host: HostRecord, fqbn: string): string {
    const board = fqbn.split(":")[2] ?? "board";
    return `// Sketch minimal généré pour ${host.name} (${board})\nvoid setup() {}\nvoid loop() {}`;
  }
}
