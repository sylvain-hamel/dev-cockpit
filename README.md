# dev-cockpit

Mod Claude Code (Windows) : une barre discrète au-dessus de la zone de saisie, sur une ligne :

```
fish1 ⧉ │ App (5120) Portail (5121) api (4000) │ test portal:dev │ #1233                …
```

- **Worktree** : son nom, ou `main` sur le checkout principal ; ⧉ l'ouvre dans VS Code.
- **Apps** : un bouton par serveur web qui tourne dans le worktree ; un clic ouvre le navigateur, le survol affiche le processus (rôle, dossier de lancement, PID, mémoire, URL). Par défaut le bouton porte le nom du dossier d'où le serveur a été lancé et son port, par exemple `portal (5120)` ; un libellé choisi dans les paramètres remplace le nom du dossier, le port reste affiché (`Portail (5120)`). Rien pour un projet sans serveur web, ni pour une app de bureau Electron.
- **Tâches** : un bouton par tâche favorite ; un clic la lance dans un onglet Windows Terminal (ou une fenêtre `cmd` à défaut) qui reste ouvert à la fin, à fermer soi-même.
- **Issue** : le bouton `#N` ouvre la carte principale de la séance dans le navigateur.

Un séparateur `│` distingue les sections. Sans serveur lancé, la section des apps affiche « no app running » ; les sections tâches et issue disparaissent quand elles sont vides.

Les éléments cliquables sont les boutons natifs de l'app, dans sa police. L'emplacement au-dessus de la saisie, son fond et sa hauteur sont imposés par l'app.
- **…** (tout à droite) : ouvre les paramètres.

## Paramètres

« … » ou `/cockpit` ouvre la fenêtre Settings. Échap ou « Close » la referme.

- **Apps** : chaque dossier d'où tourne un serveur du worktree, avec ses ports, et un champ pour lui donner un libellé (vide : retour au nom par défaut). Le libellé est attaché au dossier, pas au port : il revient quel que soit le port attribué au prochain lancement, et vaut pour tous les worktrees du dépôt. Les dossiers déjà nommés restent listés même quand leur serveur est arrêté.
- **Tasks** : les scripts de tous les `package.json` du worktree (racine et sous-dossiers jusqu'à 3 niveaux, hors `node_modules`, dossiers cachés et générés), groupés par package. ☆/★ ajoute ou retire un favori ; ▶ lance une tâche une fois.

Libellés et favoris sont mémorisés localement, par dépôt.

## Portée : le worktree de la séance

Les apps ne viennent que du worktree de la séance : un processus en fait partie si sa ligne de commande désigne ce dossier entier (pas un dossier voisin au nom proche), ou s'il descend d'un tel processus. Les autres worktrees imbriqués (par exemple `.claude/worktrees/…`) sont exclus. Deux séances sur deux worktrees d'un même projet voient donc chacune leurs propres ports.

Le dossier de lancement d'un serveur est son dossier de travail réel, lu dans le processus (Windows), et non le chemin de ses fichiers.

## Issue

L'issue affichée est la carte principale de la séance. Elle vient, dans l'ordre : de `/issue <numéro | url>`, sinon du premier `#N` (ou lien d'issue) écrit dans la conversation, sinon d'un numéro dans le nom de la branche. Une fois fixée, elle ne change plus quand d'autres cartes sont citées ou créées ; seul `/issue` la remplace, et `/issue clear` l'efface. Elle est mémorisée par séance et survit aux redémarrages.

## Configuration par projet (facultative)

Pour une app hors Node ou à l'adresse fixe, un fichier `.claude/dev-cockpit.json` à la racine du projet :

```json
{
  "apps": [{ "name": "docs", "url": "http://localhost:8080", "label": "Docs" }]
}
```

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
