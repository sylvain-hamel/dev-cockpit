# dev-cockpit

Mod Claude Code (Windows) : un panneau qui montre, pour la séance en cours :

- **Worktree** : nom, branche, chemin, bouton « Open in VS Code ».
- **Launch app** : un bouton par app web du projet, qui ouvre le navigateur sur son URL. Masqué pour les projets sans Node et pour les apps de bureau Electron, sauf si des apps sont déclarées.
- **Node processes** : processus Node, Electron, Bun et Deno du worktree, avec rôle, PID, mémoire et ports. Mis à jour toutes les 10 s.
- **Issue** : lien vers l'issue GitHub de la séance, avec son titre si `gh` est installé.

Commandes : `/cockpit` rouvre le panneau ; `/issue <numéro | url | clear>` fixe l'issue. Sinon, l'issue est déduite du premier `#N` mentionné dans la conversation, puis du nom de la branche.

## Configuration par projet (facultative)

Fichier `.claude/dev-cockpit.json` à la racine du projet :

```json
{
  "apps": [
    { "name": "portal", "url": "http://localhost:3001", "label": "Ouvrir le portail" },
    { "name": "backoffice", "url": "http://localhost:3002", "label": "Lancer le backoffice" }
  ],
  "startCommand": "pnpm dev"
}
```

Sans ce fichier, les apps qui tournent sont détectées par leurs ports en écoute, et la commande de démarrage est déduite du `package.json`.

## Installation

Dans `~/.claude/settings.json` :

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\redho\\Local Documents\\dev-cockpit",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

Le mod se charge dans chaque nouvelle conversation. Avec `CLAUDE_CODE_PLUGIN_DIR_WATCH`, une modification du dossier le recharge aussi dans les séances de l'app desktop déjà ouvertes.

## Développement

```bash
claude plugin validate .
```

```bash
claude plugin test .
```
