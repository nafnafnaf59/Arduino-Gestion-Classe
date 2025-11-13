# Arduino Classroom Deploy

Extension Theia pour Arduino IDE 2.x permettant aux enseignants de compiler et déployer des sketches Arduino en parallèle sur un parc de postes élèves.

> ⚠️ Cette version est un MVP en cours de construction. Toutes les fonctionnalités décrites dans la spécification ne sont pas encore finalisées.

## Installation rapide

1. Installer [Node.js](https://nodejs.org/) >= 18.
2. Cloner ce dépôt puis installer les dépendances :
   ```powershell
   npm install
   ```
3. Compiler l’extension :
   ```powershell
   npm run build
   ```
4. Copier le dossier dans le répertoire des extensions Theia / Arduino IDE 2.x puis redémarrer l’IDE.

## Scripts npm

| Commande          | Description                                      |
| ----------------- | ------------------------------------------------ |
| `npm run build`   | Compile TypeScript et vérifie le lint            |
| `npm run watch`   | Mode développement (compilation incrémentale)    |
| `npm run lint`    | Lancer ESLint avec les règles strictes           |
| `npm run test`    | Exécuter la suite de tests Vitest                |
| `npm run package` | Générer le bundle Theia pour distribution        |

## Structure actuelle

```
├── src/
│   ├── services/
│   ├── models/
│   ├── ui/components/
│   └── utils/
├── assets/
│   └── icons/
├── scripts/
├── test/
├── classroom-config.schema.json (à venir)
├── package.json
├── tsconfig.json
└── README.md
```

Les prochaines sections de ce document détailleront la configuration de WinRM, la modélisation des collections de postes, la personnalisation des profils, ainsi qu’un guide de déploiement complet.
