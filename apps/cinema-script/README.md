# Cinema Script (version One App)

Outil de **scripte** pour un tournage : préparer le découpage technique, organiser le plan
de travail, noter les prises sur le plateau, jouer un **clap audio** qui identifie chaque prise,
puis tout retrouver au montage grâce à l'extension Premiere Pro.

- Code de l'app : [`cinema-script.html`](cinema-script.html), à coller dans One App → « Créer une app ».
- Version d'origine (GitHub Pages, autonome) : [BigbangX6/cinema_script](https://github.com/BigbangX6/cinema_script), conservée telle quelle.
- Extension Premiere Pro : dossier `Pr Extension/` du même dépôt ; adaptation décrite dans
  [`EXTENSION_PREMIERE.md`](EXTENSION_PREMIERE.md).

## Un projet = un document

Chaque projet est un document `.onefile` dans `Mon Drive/One App/Cinema Script/`.
**Le nom du projet est le nom du document** (renommer le document renomme le projet,
titres des PDF compris). Synchronisation, hors-ligne, partage à l'équipe, Annuler/Rétablir,
versions précédentes et « Télécharger une copie » sont fournis par One App.

En équipe : **une personne écrit** (la scripte), les autres suivent en lecture (lien partagé
en lecture, ou bouton crayon → Lecture). Si deux personnes écrivent en même temps, One App
garde la version de Drive, crée une copie de secours et passe en lecture.

## Les deux modes

**📖 Découpage (scénario)** — séquences (infos : lieu, personnages…) contenant des plans
(découpage technique). Insérer avant, supprimer, renuméroter une séquence, ajouter un plan
« impro » (orange) décidé sur le plateau. Un appui sur un plan le rend actif : le tableau de bord
affiche `SÉQ | PLAN | PRISE n`, avec clap et enregistrement de la prise.

**🎥 Plan de travail (tournage)** — tous les plans dans l'ordre de tournage, réorganisables
par glisser-déposer (poignée ☰, souris ou doigt), avec des séparateurs (« Lundi matin ») et un
temps par plan. **Sur le plateau, un appui sur un plan ouvre son panneau de prise**, dans
l'ordre des gestes : 🎬 Clap · prise n → avis + commentaire → ENREGISTRER PRISE n.
Un second appui le referme.

## Prises

Avis possibles (libellés lus par l'extension, **ne pas les modifier**) :
`❓ À vérifier`, `✅ OK (Bonne)`, `⭐ MASTER (Parfaite)`, `😐 Moyen`, `😕 Bof`, `❌ KO (Ratée)`.

- La prise suivante est **le plus grand numéro + 1**. Supprimer une prise **ne renumérote
  plus** les suivantes : leur clap a déjà été joué avec leur numéro (l'ancienne version
  renumérotait, ce qui cassait la synchronisation au montage).
- Insérer une séquence ou un plan avant, ou renuméroter une séquence, décale les numéros :
  si des prises existent déjà sur les éléments décalés, l'app demande confirmation (leur clap
  garde l'ancien numéro).

## PDF

Deux impressions (choisir « Enregistrer au format PDF ») : **feuille de service** (plan de
travail, séparateurs, temps) et **découpage technique**. Titre : nom du projet et date.

## Format des données (contrat avec l'extension Premiere)

Le `.onefile` est du JSON :

```json
{
  "oneapp_metadata": { "app_name": "Cinema Script", "source_app_drive_id": "…", "version_timestamp": "ISO" },
  "app_data": {
    "v": 1,
    "sequences":    [ { "id": 1, "info": "Cuisine, jour" } ],
    "plans":        [ { "seqId": 1, "id": 1, "impro": 0, "info": "Plan large", "temps": "20 min" } ],
    "takes":        [ { "uid": "lq3k9x2a1b", "seqId": 1, "planId": 1, "prise": 1,
                        "avis": "✅ OK (Bonne)", "com": "raccord verre", "timestamp": "2026-10-13T09:12:00.000Z" } ],
    "tournageList": [ { "type": "sep", "text": "Lundi matin" }, { "type": "plan", "seqId": 1, "planId": 1 } ]
  }
}
```

- `app_data` est vide (`[]`) pour un projet jamais modifié : l'app part alors d'une séquence 1 / plan 1.
- `uid` : identifiant stable d'une prise (ne change pas si les numéros changent).
- Une prise est identifiée au montage par **(seqId, planId, prise)**, les numéros joués par le clap.
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
- Sur iPhone, ce son ne sort pas si le bouton silencieux est activé (Web Audio).

## Ce qui a été retiré par rapport à la version GitHub Pages

Bandeau Installer/Partager, service worker et manifest (fournis par One App), stockage
`localStorage`, CSV (export, fichier lié en direct, import), bouton RAZ, nom de projet saisi
à la main.
