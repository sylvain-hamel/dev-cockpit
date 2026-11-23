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

## Nom de la conversation

Une conversation ouverte avec seulement un numéro d'issue (`#1233`, `1233` ou le lien de l'issue) prend le nom de la carte : son numéro et au plus 4 mots-clés tirés de son titre (choisis par Haiku), par exemple `#1233 Role Admin`. `/issue <numéro>` fait de même.

Au fil du travail, un préfixe indique où en est la carte. Les phases sont génériques : quand les consignes du projet (`AGENTS.md`, `CLAUDE.md`) décrivent un workflow, Claude range chacune de ses étapes dans la phase qui en a l'intention ; sans workflow, il prend le sens courant de chaque phase.

| Préfixe | Intention | Posé par |
| --- | --- | --- |
| `Grilling - ` | mise au point de la carte avec l'utilisateur, avant ou entre deux constructions : questions ouvertes, décisions, spécification ; le préfixe reste pendant que Claude attend chaque réponse | Claude |
| `Coding - ` | construction de la carte, ses vérifications de fin, les retouches demandées pendant la validation | Claude |
| `Reviewing - ` | revue du code ou d'une PR | Claude |
| `Filming - ` | toute vidéo de la carte : démonstration ou annonce | Claude |
| `Finishing - ` | étapes de clôture que le workflow prévoit une fois le travail validé, avant d'ouvrir la PR | Claude |
| `Finished - ` | tout est au vert et finalisé : il ne reste qu'à placer la PR et à la fusionner ; le préfixe reste jusqu'au merge | Claude |
| `Waiting on user - ` | fin d'un tour de Claude qui ne laisse rien tourner en arrière-plan (sous-agents, commandes de fond), sauf en `Grilling` et en `Finished` | le mod |

Quand Claude reprend le travail, sur la réponse de l'utilisateur ou sur la notification d'une tâche de fond, le préfixe redevient la phase d'avant, quelle qu'elle soit. Avec la réponse de l'utilisateur, le mod rappelle à Claude de changer la phase seulement si la réponse la déplace clairement : une question à trancher mène à `Grilling`, un retour à corriger ramène à `Coding`, une validation ou « finalise » mène à `Finishing`. Dans le doute, Claude garde la phase.

Claude change de phase par l'outil `card_phase` du mod, de lui-même ; on peut aussi le lui demander (« passe en Reviewing », « corrige les mots-clés »). La carte et sa phase sont mémorisées par séance. `/issue clear` arrête le renommage.

Le mod renomme la conversation par l'outil de renommage de l'app desktop : il ne sert que dans l'app desktop.

## Configuration par projet (facultative)

Pour une app hors Node ou à l'adresse fixe, un fichier `.claude/dev-cockpit.json` à la racine du projet :

```json
{
  "apps": [{ "name": "docs", "url": "http://localhost:8080", "label": "Docs" }]
}
```

## Installation

Prérequis : Windows, et des séances Claude Code locales (le mod ne fonctionne pas dans les séances cloud). Facultatif : `gh` pour le titre des issues, VS Code (trouvé via la commande `code`, sinon dans son dossier d'installation habituel), Windows Terminal pour les tâches.

Dans un terminal, lancer `claude`, puis à l'invite :

```
/plugin install dev-cockpit --marketplace sylvain-hamel/dev-cockpit
```

Répondre `y` pour ajouter le marketplace, puis choisir la portée « user » (Entrée). Le mod se charge ensuite dans toutes les séances locales, celles de l'app desktop comprises. La commande ne s'exécute pas depuis l'onglet Code de l'app desktop : il faut un terminal.

Mise à jour vers la dernière version poussée :

```bash
claude plugin update dev-cockpit@dev-cockpit
```

## Développement

Pour travailler sur le mod depuis son dossier, sans passer par l'installation, dans `~/.claude/settings.json` (et sans installer le plugin en parallèle, pour ne pas le charger deux fois) :

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\chemin\\vers\\dev-cockpit",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

Le mod se charge alors dans chaque nouvelle conversation, et une modification du dossier le recharge dans les séances déjà ouvertes.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```
