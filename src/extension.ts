import * as theia from "@theia/plugin";
import path from "path";
import { existsSync } from "fs";
import { DeploymentManager } from "./services/DeploymentManager";
import { HostRegistry } from "./services/HostRegistry";
import { SketchAnalyzer } from "./services/SketchAnalyzer";
import { WinRMClient } from "./services/WinRMClient";
import type { DeploymentJob, SketchMetadata, SketchOption } from "./models/types";
interface DashboardMessage {
  readonly type:
    | "ready"
    | "analyze"
    | "compile"
    | "deploy"
    | "erase"
    | "retry"
    | "cancel"
    | "toggle-host";
  readonly payload?: any;
}

import { configureLogger, getLogger } from "./utils/logger";

let manager: DeploymentManager | undefined;

const DEFAULT_SKETCHES: ReadonlyArray<SketchOption> = [
  {
    id: "blink",
    label: "Blink (LED intégrée)",
    path: "${workspace}/examples/01.Basics/Blink"
  },
  {
    id: "rencontre-led",
    label: "Rencontre LED Explose",
    path: "${workspace}/classroom/rencontre_led_explose"
  },
  {
    id: "capteurs-test",
    label: "Test capteurs",
    path: "${workspace}/classroom/test_capteurs"
  }
];

export function start(context: theia.PluginContext): void {
  const outputChannel = theia.window.createOutputChannel("Arduino Classroom Deploy");
  configureLogger({ logDirectory: path.join(context.extensionPath, ".logs") });
  const logger = getLogger("Extension");
  outputChannel.appendLine("Arduino Classroom Deploy initialisé.");

  void (async () => {
    try {
      const scriptUri = theia.Uri.joinPath(context.extensionUri, "scripts", "remoteAgent.ps1");
      const workspaceDir = theia.workspace.rootPath ?? context.extensionPath;
      const hostRegistry = new HostRegistry();
      const sketchAnalyzer = new SketchAnalyzer();
      const winrmClient = new WinRMClient({
        scriptPath: scriptUri.fsPath,
        dryRun: true
      });

      manager = new DeploymentManager(
        {
          hostRegistry,
          sketchAnalyzer,
          winrmClient
        },
        {
          configOptions: {
            workspaceDir
          }
        }
      );

      await manager.initialize();
      logger.info("Configuration chargée");
      outputChannel.appendLine("Configuration de la classe chargée.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Échec de l'initialisation");
      outputChannel.appendLine(`Erreur d'initialisation: ${message}`);
    }
  })();

  const openDashboardDisposable = theia.commands.registerCommand(
    {
      id: "arduino-classroom-deploy.openDashboard",
      label: "Arduino Classroom Deploy: Ouvrir le tableau de bord"
    },
    async () => {
      if (!manager) {
        theia.window.showErrorMessage("Le gestionnaire de déploiement n'est pas encore prêt.");
        return;
      }

      const panel = theia.window.createWebviewPanel(
        "arduinoClassroomDeploy",
        "Arduino Classroom Deploy",
        {
          viewColumn: theia.ViewColumn.One,
          preserveFocus: false
        },
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      const scriptPath = path.join(context.extensionPath, "dist", "webview", "index.js");
      if (!existsSync(scriptPath)) {
        panel.webview.html = getPlaceholderHtml(panel.webview.cspSource);
        return;
      }

      const scriptUri = panel.webview.asWebviewUri(theia.Uri.file(scriptPath));
      const styleUri = panel.webview.asWebviewUri(
        theia.Uri.file(path.join(context.extensionPath, "dist", "webview", "index.css"))
      );

      panel.webview.html = getWebviewHtml(scriptUri.toString(), styleUri.toString(), panel.webview.cspSource);

      const disposables: theia.Disposable[] = [];

      const jobSubscription = manager
        .observeJobs()
        .subscribe((jobs: ReadonlyArray<DeploymentJob>) => {
          void panel.webview.postMessage({
            type: "queue-update",
            payload: {
              jobs,
              snapshot: manager?.getSnapshot()
            }
          });
        });

      disposables.push({ dispose: () => jobSubscription.unsubscribe?.() });

  panel.webview.onDidReceiveMessage(async (message: DashboardMessage) => {
        if (!manager) {
          return;
        }
        switch (message?.type) {
          case "ready":
            void panel.webview.postMessage({
              type: "initial-state",
              payload: {
                hosts: manager.getHosts(),
                profiles: manager.getProfiles(),
                snapshot: manager.getSnapshot(),
                defaultSketches: DEFAULT_SKETCHES
              }
            });
            break;
          case "analyze":
            try {
              const analysis = await manager.analyzeSketch({
                sketchPath: message.payload.sketchPath,
                fqbn: message.payload.fqbn
              });
              void panel.webview.postMessage({ type: "analysis-result", payload: analysis });
            } catch (error) {
              void panel.webview.postMessage({
                type: "error",
                payload: error instanceof Error ? error.message : String(error)
              });
            }
            break;
          case "compile":
            try {
              const metadata = await manager.compileSketch(
                message.payload.sketchPath,
                message.payload.profileId
              );
              void panel.webview.postMessage({ type: "compile-result", payload: metadata });
            } catch (error) {
              void panel.webview.postMessage({
                type: "error",
                payload: error instanceof Error ? error.message : String(error)
              });
            }
            break;
          case "deploy": {
            try {
              await manager.deploy({
                hosts: manager
                  .getHosts()
                  .filter((host) => message.payload.hostIds.includes(host.id)),
                metadata: message.payload.metadata as SketchMetadata,
                profileId: message.payload.profileId,
                mode: message.payload.mode
              });
              void panel.webview.postMessage({ type: "deploy-started" });
            } catch (error) {
              void panel.webview.postMessage({
                type: "error",
                payload: error instanceof Error ? error.message : String(error)
              });
            }
            break;
          }
          case "erase": {
            try {
              await manager.enqueueErase({
                hosts: manager
                  .getHosts()
                  .filter((host) => message.payload.hostIds.includes(host.id)),
                profileId: message.payload.profileId,
                sketchPath: message.payload.sketchPath ?? ""
              });
              void panel.webview.postMessage({ type: "erase-started" });
            } catch (error) {
              void panel.webview.postMessage({
                type: "error",
                payload: error instanceof Error ? error.message : String(error)
              });
            }
            break;
          }
          case "retry":
            manager.retryFailedJobs();
            break;
          case "cancel":
            manager.cancelPendingJobs();
            break;
          case "toggle-host":
            manager.setHostEnabled(message.payload.hostId, Boolean(message.payload.enabled));
            void panel.webview.postMessage({
              type: "hosts",
              payload: manager.getHosts()
            });
            break;
          default:
            break;
        }
      }, undefined, disposables);

      panel.onDidDispose(
        () => {
          disposables.forEach((d) => d.dispose());
        },
        undefined,
        disposables
      );
    }
  );

  context.subscriptions.push(openDashboardDisposable, outputChannel);
}

export function stop(): void {
  manager = undefined;
}

function getPlaceholderHtml(cspSource: string): string {
  return `<!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline'; script-src 'none';" />
      <title>Arduino Classroom Deploy</title>
      <style>
        body { font-family: sans-serif; padding: 1.5rem; }
        h1 { margin-bottom: 1rem; }
        pre { background: #111; color: #fff; padding: 1rem; border-radius: 0.5rem; }
      </style>
    </head>
    <body>
      <h1>Arduino Classroom Deploy</h1>
      <p>Le tableau de bord n'est pas encore compilé. Exécutez <code>npm run build:webview</code> pour générer l'interface.</p>
    </body>
  </html>`;
}

function getWebviewHtml(scriptUri: string, styleUri: string, cspSource: string): string {
  return `<!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline' ${styleUri}; script-src ${cspSource} 'unsafe-eval'; connect-src ${cspSource};" />
      <title>Arduino Classroom Deploy</title>
      <link rel="stylesheet" href="${styleUri}" />
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="${scriptUri}"></script>
    </body>
  </html>`;
}
