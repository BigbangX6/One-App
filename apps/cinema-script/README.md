# Cinema Script (version One App)

Outil de **scripte** pour un tournage : préparer le découpage technique, organiser le plan
de travail, noter les prises sur le plateau, jouer un **clap audio** qui identifie chaque prise,
puis tout retrouver au montage grâce à l'extension Premiere Pro.

- Code de l'app : [`cinema-script.html`](cinema-script.html), à coller dans One App → « Créer une app ».
- Version d'origine (GitHub Pages, autonome) : [BigbangX6/cinema_script](https://github.com/BigbangX6/cinema_script), conservée telle quelle.
- Extension Premiere Pro : dossier `Pr Extension/` du même dépôt ; adaptation décrite dans
  [`EXTENSION_PREMIERE.md`](EXTENSION_PREMIERE.md).

## Installer dans One App

One App → « Créer une app » → coller ce lien (rien d'autre) :

```
https://github.com/BigbangX6/cinema_script/blob/main/oneapp/cinema-script.html
```

One App enregistre seulement ce lien dans Drive et suit la branche `main` : chaque mise à jour
poussée sur GitHub est utilisée par tout le monde à l'ouverture suivante (après le cache de
GitHub, environ 5 minutes) ; sinon l'app se charge depuis la copie de l'appareil. Coller le
contenu du fichier HTML marche aussi, mais l'app ne suit alors plus les mises à jour.

## Un projet = un document

Chaque projet est un document `.onefile` dans `Mon Drive/One App/Cinema Script/`.
**Le nom du projet est le nom du document** (renommer le document renomme le projet,
titres des PDF compris). Synchronisation, hors-ligne, partage à l'équipe, Annuler/Rétablir,
versions précédentes et « Exporter le document » sont fournis par One App.

En équipe : **une personne écrit** (la scripte), les autres suivent en lecture (lien partagé
en lecture, ou bouton crayon → Lecture). Si deux personnes écrivent en même temps, One App
garde la version de Drive, crée une copie de secours et passe en lecture.

## L'interface (v4)

- **En haut** : titre (nom du projet), 📄 PDF Découpage, 📄 PDF Feuille de service, **Pr**
  (présentation de l'extension Premiere), et **affichage normal / cahier** (même contenu,
  mise en page de scénario de tournage en Courier). Changer d'affichage, de liste ou ouvrir la
claquette n'envoie rien à Drive : l'affichage (`ui`) part avec la prochaine vraie modification.
- **Barre collée** : 📖 Scénario | 🗓️ Tournage, 🔍 recherche (mot, personnage, décor, ou `5` /
  `5.3`), et le bouton **claquette**.
- **Scénario** : séquences (numéros libres, ils peuvent sauter) et leurs plans, toujours numérotés
  1, 2, 3… dans la séquence. Toucher un texte le modifie et fait apparaître ses outils
  (N° ✎ pour renuméroter ou déplacer « 2.3 », vidéo de référence, supprimer). Les boutons
  « + Séquence » / « + Plan » se **glissent** à l'endroit voulu.
- **Tournage (feuille de service)** : journées repliables (« + Journée » à glisser), plans
  réordonnés à la poignée ⠿, temps par plan et total par journée.
- **Claquette** (téléphone : en haut ; ordinateur : colonne de gauche) : toucher un plan de la
  liste le prend. SÉQ / PLAN / PRISE, 🎬 Clap, commentaire, et **un appui sur un avis enregistre
  la prise** (avec « Annuler » quelques secondes). ⚡ Impro crée un plan improvisé numéroté en fin
  de séquence. « 📍 Dernière prise » et « ▶ À suivre » guident dans l'ordre de tournage.

## Vidéo de référence

Outil d'un plan → 🎞️ **Vidéo de référence** : le sélecteur de Google Drive s'ouvre sur **Mon Drive,
avec ses dossiers** (seules les vidéos sont affichées) ; onglets « toutes les vidéos » et
« partagés avec moi ». L'apparence du sélecteur est celle de Google, elle ne peut pas être changée.
L'app garde l'**id** du fichier, son **nom** et une **miniature** (image ~320 px dans le document,
visible hors-ligne), tirée de la vidéo elle-même au moment du choix. Sur le plan, seul le **nom** de la
vidéo est affiché ; un appui ouvre une **fenêtre** : grande miniature (fond bleu nuit s'il n'y en a pas),
**▶ ouvre la vidéo dans l'app Google Drive** (lien normal ; `googledrive://…` sur iPhone/iPad),
Changer, Retirer. Hors connexion, la lecture marche si la vidéo est « disponible hors connexion »
dans l'app Drive du téléphone. Pour l'équipe : la vidéo doit leur être partagée dans Drive.

## Saisie et mises à jour reçues

Un texte est envoyé 0,8 s après la dernière frappe (pas besoin de sortir du champ). Si une
mise à jour arrive pendant la saisie (autre appareil, Annuler, conflit), le champ en cours garde
son texte, qui est ajouté aux nouvelles données ; l'écran est redessiné en sortant du champ.

## Prises

Avis possibles (libellés lus par l'extension, **ne pas les modifier**) :
`❓ À vérifier`, `✅ OK (Bonne)`, `⭐ MASTER (Parfaite)`, `😐 Moyen`, `😕 Bof`, `❌ KO (Ratée)`.

- La prise suivante est **le plus grand numéro + 1** ; les numéros de prise ne sont jamais
  renumérotés (leur clap a déjà été joué).
- Une **pastille de couleur par prise** (couleur de l'avis) à côté du numéro du plan ; s'il y en a
  beaucoup, « … » puis les dernières (8 dans le scénario, 4 dans la feuille de service).
- Outils d'un plan → **🎬 Prises (n)** : liste des prises (avis, commentaire, heure) ; 🗑 supprime
  une prise, après un avertissement.
- Changer le numéro de plans ou de séquences **déjà tournés** demande confirmation (leur clap
  garde l'ancien numéro).

## PDF

Deux impressions (choisir « Enregistrer au format PDF ») : **découpage technique** et **feuille
de service**. Tableau en affichage normal (colonnes de numéro et de temps étroites, le texte prend la
place), mise en page de scénario en affichage cahier.

## Format des données (contrat avec l'extension Premiere)

Le `.onefile` est du JSON :

```json
{
  "oneapp_metadata": { "app_name": "Cinema Script", "source_app_drive_id": "…", "version_timestamp": "ISO" },
  "app_data": {
    "v": 1,
    "sequences":    [ { "id": 1, "info": "Cuisine, jour" } ],
    "plans":        [ { "seqId": 1, "id": 1, "impro": 0, "info": "Plan large", "temps": "20 min",
                        "video": { "id": "<id Drive>", "name": "repetition.mp4", "thumb": "data:image/jpeg;base64,…" } } ],
    "takes":        [ { "uid": "lq3k9x2a1b", "seqId": 1, "planId": 1, "prise": 1,
                        "avis": "✅ OK (Bonne)", "com": "raccord verre", "timestamp": "2026-10-13T09:12:00.000Z" } ],
    "tournageList": [ { "type": "sep", "text": "Lundi matin" }, { "type": "plan", "seqId": 1, "planId": 1 } ],
    "ui": { "style": "normal", "view": "scenario", "clap": false, "active": null }
  }
}
```

- `app_data` est vide (`[]`) pour un projet jamais modifié : l'app part alors d'une séquence 1 / plan 1.
- `uid` : identifiant stable d'une prise (ne change pas si les numéros changent).
- Une prise est identifiée au montage par **(seqId, planId, prise)**, les numéros joués par le clap.
- `video` : `null` ou la vidéo de référence (id Drive, nom, miniature). `ui` : l'affichage où l'on
  en était (ignoré par l'extension).
- Il n'y a plus de `projectName` (nom du fichier) ni de colonne `rushes` (gérée par l'extension, à part).

## Le clap audio

Classe `DigitalClapper`, **copie exacte** de l'original (un test du banc d'essai vérifie que
le code et le son produit sont identiques à l'échantillon près). Ne pas la modifier sans
refaire les essais à deux appareils.

- Message joué : `*S*P*T#*` (S = séquence, P = plan, T = prise ; ex. `*12*3*4#*`).
- Chaque caractère = 2 sinusoïdes simultanées (principe DTMF), décalées vers 10–12 kHz pour ne
  pas se superposer à la voix :

  | | 12209 Hz | 12336 Hz | 12477 Hz |
  |---|---|---|---|
  | **10697 Hz** | 1 | 2 | 3 |
  | **10770 Hz** | 4 | 5 | 6 |
  | **10852 Hz** | 7 | 8 | 9 |
  | **10941 Hz** | * | 0 | # |

- Début 65 ms après l'appui, 80 ms par tonalité, 120 ms de silence entre deux, gain 0,75
  (montée/descente de 5 ms).
- Au montage, `analyze.py` (extension) lit les 100 premières secondes de chaque rush, décode
  le message et prend comme **point de synchronisation le `*` qui suit le `#`**.
- **Puis le claquement** : après la fin du signal et **0,5 s de silence**, un vrai « clac » de
  claquette (bruit bref filtré sous 7 kHz + corps boisé), pour l'oreille de l'équipe et en secours
  au montage. Il est joué par une fonction à part (`playSlateSound`) : la classe du signal n'est pas
  modifiée, et le décodeur s'arrête au `*` final, avant le claquement. Le banc d'essai vérifie que le
  signal est identique à l'original échantillon par échantillon, que la pause est silencieuse et
  que le claquement n'a pas d'énergie dans la bande du signal.
- Sur iPhone, ce son ne sort pas si le bouton silencieux est activé (Web Audio).

## Ce qui a été retiré par rapport à la version GitHub Pages

Bandeau Installer/Partager, service worker et manifest (fournis par One App), stockage
`localStorage`, CSV (export, fichier lié en direct, import), bouton RAZ, nom de projet saisi
à la main.
