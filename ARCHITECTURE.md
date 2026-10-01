# Architecture de One App

> Carte du projet, à lire avant toute modification (humain ou IA).
> Les sections de `index.html` sont repérées par leurs commentaires `// --- TITRE ---` :
> cherchez-les avec Ctrl+F plutôt que de vous fier à des numéros de ligne.

## 1. Le principe

One App est un « système d'exploitation » sans serveur pour des mini-applications
générées par IA. Tout est stocké dans le **Google Drive de l'utilisateur** :

- une **app** = un fichier `Nom.oneapp` : un HTML complet (le code) ;
- un **document** = un fichier `Nom.onefile` : du JSON (les données), ouvert avec une app,
  comme un `.docx` avec Word.

One App fournit tout ce qu'une mini-app ne sait pas faire seule : sauvegarde automatique,
Annuler/Rétablir, historique des versions, partage par lien, gestion des conflits entre
appareils, lecture seule.

Choix assumés :

- **Un seul fichier `index.html`** (HTML + CSS + JS) : versions simples à suivre, et une
  seule ressource à mettre en cache pour la PWA hors-ligne.
- **Pas de serveur, pas d'outil de build** : hébergé tel quel sur GitHub Pages.
- **Les apps sont publiques par lien** (lecture seule) : nécessaire pour que le destinataire
  d'un document partagé puisse charger l'app. Les données privées sont dans les `.onefile`.

## 2. Les fichiers du dépôt

| Fichier | Rôle |
|---|---|
| `index.html` | Toute l'application One App |
| `config.js` | Client ID Google OAuth et clé API (publics) |
| `manifest.json`, `icon-512.png` | PWA : installation sur l'écran d'accueil |
| `sw.js` | Service worker : garde One App sur l'appareil pour l'ouvrir sans réseau |
| `Launcher.pdf` | Copié dans le Drive (`#Ouvrir One App.pdf`) : lien pour ouvrir One App depuis Drive |
| `tests/` | Banc d'essai : Chromium + faux Google Drive (voir `tests/README.md`) |

## 3. Organisation dans Google Drive

```
Mon Drive/
└── One App/                         ← rootFolderId
    ├── #Ouvrir One App.pdf
    ├── Budget/                      ← un dossier par app (nom = <title> de l'app)
    │   ├── Budget.oneapp            ← code HTML ; description Drive = icône (emoji)
    │   ├── Budget 2026.onefile      ← données JSON
    │   └── Budget 2025.onefile
    └── Agenda partagé/              ← app reçue par un lien partagé
        ├── Agenda.oneapp            ← RACCOURCI Drive vers l'app d'un autre utilisateur
        └── Planning.onefile         ← RACCOURCI Drive vers son document
```

Format d'un `.onefile` :

```json
{
  "oneapp_metadata": {
    "app_name": "Budget",
    "source_app_drive_id": "<id du .oneapp>",
    "version_timestamp": "2026-10-01T10:00:00.000Z"
  },
  "app_data": { "...": "l'objet state de l'app ([] pour un nouveau document)" }
}
```

L'icône d'une app est le contenu de `<meta name="oneapp-icon">`, copié dans la
**description** du fichier `.oneapp` à l'installation et à chaque sauvegarde de l'éditeur.
Pour un raccourci, l'icône est lue sur l'app d'origine.

## 4. Les écrans (HTML)

Un seul écran est visible à la fois ; on bascule en changeant `style.display`.

| `id` | Écran |
|---|---|
| `unauthenticated-view` | Connexion Google |
| `shared-invite-view` | Lien partagé ouvert sans être connecté |
| `authenticated-view` | Accueil : grille des apps, sous-menu fichiers, installation |
| `execution-view` | App en cours : bandeau (titre, annuler, synchro, partage) + `iframe-container` |
| `edit-app-view` | Éditeur du code d'une app |
| `history-sidebar` | Panneau latéral de l'historique des versions |
| `share-modal-overlay` | Fenêtre de partage |
| `access-modal-overlay` | « Ajouter à One App » : autoriser un document partagé (puis Picker) |
| `session-banner` | Bandeau « session expirée, se reconnecter » (au-dessus de tout) |
| `network-banner` | Pastille « Hors-ligne » en bas de l'écran (ne bloque pas les clics) |
| `install-overlay` | Fenêtre d'installation PWA, adaptée à l'appareil (CSS limité à `#install-overlay`) |

## 5. Le JavaScript, section par section

Dans l'ordre du fichier :

| Section (`// --- … ---`) | Contenu | Fonctions clés |
|---|---|---|
| FENÊTRE D'INSTALLATION (PWA) | Parcours par appareil : bouton natif (Android, ordinateur) ou étapes illustrées (iPhone, iPad) | `openInstallSheet` (seul point d'entrée) |
| CONSTANTES SVG / CONFIGURATION | Icônes de synchro, URLs Drive, scope OAuth | |
| CERVEAU LOCAL | État global du fichier ouvert | `isDirty`, `localContent`, `currentFileVersion` |
| **ACCÈS DRIVE CENTRALISÉ** | Point d'entrée unique vers Google | `driveFetch`, `driveJson`, `renewToken`, `driveCreateFile`, `createOneFile`, `escapeDriveQuery` |
| **ACCÈS AUX FICHIERS DES AUTRES (SCOPE drive.file)** | Apps publiques lues par clé API, documents partagés autorisés via le Picker | `readDriveFile`, `publicDriveFetch`, `getFileMetaWithAccess`, `requestFileAccess`, `pickFile` |
| **STOCKAGE LOCAL (LOCAL D'ABORD)** | Copie des documents et des apps sur l'appareil (IndexedDB) | `localStore`, `persistOpenDoc`, `prepareLocalStore` |
| REPRISE DES ENVOIS EN ATTENTE | Envoie les modifications restées sur l'appareil | `syncPendingDocs`, `syncPendingDoc` |
| LOGIQUE DU MOTEUR (Système de Fichiers) | Démarrage, dossiers, accueil | `initializeAppSystem`, `getOrCreateFolder`, `listInstalledApps`, `buildAppIcon`, `toggleAppMenu` |
| GESTION DU BANDEAU D'EXÉCUTION | Renommer, dupliquer, liste de fichiers | `renameActiveFile`, `duplicateActiveFile`, `loadAppFiles`, `renameFile`, `deleteFile` |
| **CONTRAT ONE APP** | Règles de création données aux IA | `ONEAPP_RULES`, `copyAppGenerationPrompt`, `createNewFile` |
| **LE PONT DE COMMUNICATION** | API injectée dans chaque app + réception des messages | `oneAppBridge`, `injectBridge`, écouteur `message` |
| COMMANDES DU MOTEUR VERS L'IFRAME | Annuler/Rétablir des données, lecture seule | `appUndo`, `appRedo`, `toggleAppMode` |
| **LE BOUCLIER DE SAUVEGARDE** | File de synchronisation et conflits | `markDirty`, `syncToDrive`, `performSync`, `resolveConflict`, `flushSync` |
| LE RADAR SILENCIEUX (POLLING) | Vérifie le Cloud toutes les 15 s | `checkCloudVersion`, `startPolling` |
| (liens partagés) | `?file=ID` | `checkSharedLink`, `createShortcutIfNeeded` |
| **MODE HORS-LIGNE** | Accueil, listes et documents servis depuis l'appareil | `isOffline`, `enterOfflineMode`, `leaveOfflineMode`, `openFromDevice`, `requireOnline` |
| LE CHARGEUR D'APPLICATION | Ouvrir/fermer un document | `openAppEnvironment`, `mountApp`, `closeApp` |
| (partage) | Droits Drive, lien, QR code | `openShareModal`, `validatePermissionChange` |
| LOGIQUE D'INSTALLATION | Coller le HTML d'une IA | `extractAppHtml`, `confirmAppHtml`, `installAppFromHtml` |
| LOGIQUE DE L'ÉDITEUR | Modifier le code d'une app | `openAppEditor`, `copyCodeForAI`, `saveEditorCode`, `saveAppToDrive` |
| MACHINE À REMONTER LE TEMPS | Révisions Drive | `showDataHistory`, `renderRevisions`, `restoreDataVersion`, `copyDataVersion` |
| RACCOURCIS CLAVIER | Ctrl+Z / Ctrl+Y dans One App | |
| PWA : SERVICE WORKER | Enregistrement de `sw.js` | |

## 6. Les flux principaux

### Ouvrir un document
`openAppEnvironment` → `flushSync` (enregistre le document précédent) → lit les
métadonnées (`headRevisionId`, droits) → télécharge l'app et les données →
`injectBridge` → crée l'iframe `sandbox="allow-scripts allow-modals allow-forms"` →
`startPolling`.

### Sauvegarder (le cœur du système)
1. L'app appelle `OneAppAPI.saveData(state)` → message `SAVE_DATA_REQUEST`.
2. One App ajoute l'état à l'historique Annuler (`appDataHistory`), puis `markDirty`.
3. `markDirty` incrémente `localRevision`, **écrit tout de suite l'état sur l'appareil**
   (`persistOpenDoc`, document marqué `dirty`) et programme `syncToDrive` dans 3 s.
4. `performSync` vérifie la version distante :
   - inchangée → PATCH du fichier ; `isDirty` ne repasse à `false` **que si** aucune
     modification n'est arrivée pendant l'envoi (`localRevision` identique) ;
   - changée par un autre appareil → `resolveConflict` : copie de secours des
     modifications locales, puis affichage de la version du Cloud.
5. En cas d'échec : `isDirty` reste `true`, l'icône passe au rouge, nouvel essai
   (5 s, 10 s… 60 s max).

`flushSync` force l'enregistrement immédiat : appelé avant de fermer ou de changer de
fichier. Si Drive reste injoignable, les modifications sont déjà sur l'appareil : on
prévient l'utilisateur et on continue ; elles partiront plus tard. Il y a aussi un enregistrement quand l'onglet passe en arrière-plan, au retour du
réseau, et une alerte `beforeunload` s'il reste des modifications.

### Local d'abord (stockage sur l'appareil)
Base IndexedDB `OneAppLocal` :

| Store | Contenu |
|---|---|
| `docs` | Dernier état connu de chaque document ouvert : `data`, `metadata`, `dirty` (modifications pas encore sur Drive), `base` (version Drive sur laquelle reposent les données), `lastOpened` |
| `apps` | Code HTML des apps ouvertes (utilisé hors-ligne) |
| `meta` | `account` : e-mail du compte Google propriétaire de ce stockage ; `appList` : dernière liste des apps (accueil hors-ligne) |

- **Reprise** : au démarrage, au retour du réseau, après la fermeture d'un document et
  toutes les minutes, `syncPendingDocs` envoie les documents `dirty`. Si le document a
  changé ailleurs depuis `base`, une copie de secours est créée au lieu d'écraser Drive.
- **Réouverture** d'un document `dirty` : `openAppEnvironment` affiche les données locales
  et les envoie (conflit détecté par rapport à `base`).
- **Confidentialité** : tout est effacé à la déconnexion, et si un autre compte Google se
  connecte sur l'appareil (`ensureAccount`).
- **Espace** : pas de limite fixe. Si le navigateur manque de place, les copies déjà
  synchronisées les plus anciennes sont retirées (`freeSpace`), jamais un document `dirty`.

### Hors-ligne (PWA)
- **`sw.js`** garde la page sur l'appareil : réseau d'abord (toujours la dernière
  version), cache si pas de réseau ou s'il ne répond pas en 4 s. Les autres fichiers de
  One App : cache immédiat, mise à jour en arrière-plan. Google n'y passe jamais.
- **Sans réseau** (`isOffline()` : `navigator.onLine` faux, ou réseau constaté injoignable),
  `enterOfflineMode` construit l'accueil depuis l'appareil : liste `appList`, apps
  jamais ouvertes ici grisées, documents de `docs`. Le jeton n'est pas nécessaire.
- **`openAppEnvironment`** ouvre la copie locale (`openFromDevice`) hors-ligne, ou si le
  réseau tombe pendant le chargement. Les modifications suivent le flux « local d'abord ».
- **Actions qui demandent Internet** (créer, installer, modifier une app, partager,
  renommer, supprimer, historique) : bloquées par `requireOnline`, avec un message.
- **Retour du réseau** : `leaveOfflineMode` recharge les scripts Google si besoin,
  recharge l'accueil depuis Drive ; les envois en attente partent.

### Jeton Google expiré
`driveFetch` reçoit 401 (ou voit le jeton périmé) → `renewToken` tente un renouvellement
silencieux. Si le navigateur bloque la popup, `session-banner` demande un clic. Pendant ce
temps, les requêtes **attendent** : rien n'est perdu.

### Scope `drive.file`
One App ne demande que `drive.file` (scope « non sensible » : pas d'audit Google).
Elle ne voit donc que les fichiers **qu'elle a créés** ou que l'utilisateur **lui a
ouverts** via le Google Picker. Pour un fichier d'un autre utilisateur, Drive répond 404 :

- **app (`.oneapp`)** : publique par lien, elle est lue sans jeton avec la clé API
  (`readDriveFile` essaie le jeton, puis `publicDriveFetch`) ;
- **document (`.onefile`)** : il doit pouvoir être modifié, l'utilisateur l'autorise
  donc une fois (`getFileMetaWithAccess` → écran `access-modal-overlay` → `pickFile`,
  Picker positionné sur ce seul fichier avec `setFileIds`). L'accès vaut pour le compte
  Google, sur tous ses appareils.

`include_granted_scopes: false` : le jeton ne reprend pas un ancien scope `drive` complet.
L'e-mail du compte vient de `drive/v3/about` (disponible avec `drive.file`).

### Partage
Le lien est `index.html?file=<id du .onefile>`. Chez le destinataire, `checkSharedLink`
propose d'ajouter le document à One App s'il n'y a pas encore accès (voir ci-dessus),
crée des raccourcis vers l'app et le document (sauf s'ils lui appartiennent), puis ouvre
le document. Les droits (lecture / édition) sont ceux du fichier Drive.

## 7. Le contrat app ↔ One App

Référence complète : la constante `ONEAPP_RULES` (c'est aussi le texte donné aux IA).

API disponible dans l'app (`window.OneAppAPI`, injectée par `oneAppBridge`) :

| Fonction | Rôle |
|---|---|
| `loadData()` → `{ app_data, readOnly }` | Au démarrage ; `app_data` vaut `[]` pour un nouveau document |
| `saveData(state)` | Après chaque modification, avec l'état complet |
| `onDataChange(cb)` | Données remplacées de l'extérieur (annuler, historique, autre appareil) |
| `onModeChange(cb)` | Passage en lecture seule / édition |

Messages `postMessage` entre l'app et One App :

| Sens | Type |
|---|---|
| app → One App | `LOAD_DATA_REQUEST`, `SAVE_DATA_REQUEST`, `UNDO_REQUEST`, `REDO_REQUEST` |
| One App → app | `LOAD_DATA_RESPONSE`, `RESTORE_DATA`, `SET_READ_ONLY` |

Compatibilité : les anciennes apps utilisent `window.OneAppInternal_OnRestore` et
`window.OneAppInternal_OnModeChange`. Le pont les appelle toujours.

## 8. Règles à ne pas casser

1. **Tout accès à Google passe par `driveFetch` / `driveJson`.** Jamais de `fetch` direct
   vers googleapis.com : on perdrait la vérification d'erreurs et le renouvellement du jeton.
2. **Toute modification des données du document ouvert passe par `markDirty`.**
   Ne jamais mettre `isDirty = false` ailleurs qu'après une confirmation de Drive.
3. **Avant de fermer ou de changer de document : `await flushSync()`.** Et un document
   `dirty` n'est retiré de l'appareil qu'après confirmation de Drive (ou à la déconnexion,
   après avertissement).
4. **Ne jamais insérer un nom, une icône ou une donnée Drive avec `innerHTML`** ou dans un
   `onclick="..."` généré. Utiliser `textContent`, `addEventListener`, `makeButton`.
   (Un fichier partagé porte un nom choisi par quelqu'un d'autre.)
5. **Valeurs insérées dans une requête Drive (`q=`) : `escapeDriveQuery`.** Et **ne pas élargir le scope au-delà de `drive.file`** (un scope restreint impose un
   audit de sécurité Google). Lire un fichier qui peut appartenir à un autre :
   `readDriveFile` ; ouvrir un document partagé : `getFileMetaWithAccess`.
6. **Le contrat app ↔ One App ne change qu'en restant compatible** : les apps déjà
   installées doivent continuer à fonctionner. Mettre `ONEAPP_RULES` à jour en même temps.
7. **Garder le fichier unique**, sans dépendance ni étape de build.
8. **Lancer les tests (`tests/`) avant de publier sur `main`**, et ajouter un test pour
   chaque bug corrigé.
9. **Toute nouvelle action qui a besoin du réseau commence par `requireOnline(...)`**, et
   tout nouveau fichier indispensable à One App est ajouté à `CORE_FILES` dans `sw.js`.

## 9. Limites connues / pistes

- Hors-ligne, seuls les documents déjà ouverts sur l'appareil sont disponibles ; on ne
  peut pas créer de document.
- Une app qui charge une bibliothèque externe (`<script src="https://...">`) ne
  fonctionne pas hors-ligne.
- iPhone : la connexion Google depuis One App installée sur l'écran d'accueil reste à
  vérifier sur un vrai appareil.
- Un document en attente dont on a perdu l'accès en écriture est retenté indéfiniment.
- Deux apps avec le même `<title>` partagent le même dossier (leurs documents se mélangent).
- Renommer une app ne renomme ni son dossier ni `app_name` dans ses documents.
- La liste des apps et des fichiers n'est pas paginée (100 éléments maximum).
- Le QR code est généré par un service externe (api.qrserver.com).
- Les messages passent encore par `alert()` / `confirm()`.
- Un `.onefile` partagé par Drive directement (sans le lien One App) n'apparaît pas tant
  qu'il n'a pas été ouvert avec le lien : pas encore de bouton « Ajouter depuis Drive ».
- Une app partagée rendue privée par son auteur ne peut plus être lue par la clé API.

## 10. Travailler avec une IA sur ce projet

- Donner ce fichier en contexte, puis seulement la ou les sections concernées.
- Demander des modifications ciblées (« remplace cette fonction »), pas une réécriture du fichier.
- Pour une nouvelle mini-app : utiliser le bouton « Copier les règles de création » de
  One App (il contient `ONEAPP_RULES`), pas ce document.
