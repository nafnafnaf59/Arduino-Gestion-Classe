import * as theia from "@theia/plugin";

export function start(context: theia.PluginContext): void {
  const outputChannel = theia.window.createOutputChannel("Arduino Classroom Deploy");
  outputChannel.appendLine("Arduino Classroom Deploy initialisé.");

  const disposable = theia.commands.registerCommand(
    {
      id: "arduino-classroom-deploy.openDashboard",
      label: "Arduino Classroom Deploy: Ouvrir le tableau de bord"
    },
    () => {
      theia.window.showInformationMessage("Tableau de bord Arduino Classroom Deploy à venir...");
      outputChannel.show(true);
    }
  );

  context.subscriptions.push(disposable, outputChannel);
}

export function stop(): void {
  // Nettoyage spécifique si nécessaire
}
