# Instructions : adapter l'extension Premiere Pro à Cinema Script (One App)

> À donner à une conversation Claude Code **sur l'ordinateur qui a Premiere Pro**, ouverte dans
> le dépôt `BigbangX6/cinema_script`, dossier `Pr Extension/`. Lire aussi
> [`README.md`](README.md) (format des données et clap). Ne pas toucher au reste du dépôt
> (la version GitHub Pages de l'app reste telle quelle).

## Contexte

Cinema Script est devenue une app One App. Un projet n'est plus un CSV mais un fichier
**`<Nom du projet>.onefile`** (JSON) dans Google Drive, synchronisé sur l'ordinateur par
**Google Drive pour ordinateur**, typiquement :

```
G:\Mon Drive\One App\Cinema Script\<Nom du projet>.onefile
```

(la lettre de lecteur et « Mon Drive » / « My Drive » dépendent de l'installation ; le dossier
de l'app porte le nom de l'app, « Cinema Script »).

Contenu : `{ "oneapp_metadata": {…}, "app_data": { "v": 1, "sequences", "plans", "takes", "tournageList" } }`
— détail dans `README.md`. Le **nom du projet = nom du fichier** sans `.onefile`.
`app_data` peut valoir `[]` (projet jamais modifié) : le traiter comme un projet vide.

Ce qui ne change pas : `analyze.py`, l'extraction audio FFmpeg, le décodage du clap, la
logique de rangement / chutiers / séquence de synchro dans `host.jsx`, les libellés d'avis
et leurs couleurs.

## Règle principale

**L'extension ne doit jamais écrire dans le `.onefile`.** Il est modifié par le téléphone
de la scripte (One App) et synchronisé par Drive : une écriture de l'extension créerait des
conflits et serait écrasée. Tout ce qui est propre à l'extension (lien vers le `.onefile`,
rushs associés aux prises) va dans un **fichier annexe** à côté du projet Premiere :

```
<projet Premiere sans .prproj>_CinemaScript.json
{
  "onefilePath": "G:\\Mon Drive\\One App\\Cinema Script\\Mon film.onefile",
  "rushes": { "<uid de la prise>": ["2.1.3_A001C003.mov", "2.1.3_ZOOM0012.wav"] }
}
```

Clé de `rushes` : `take.uid` ; si une prise n'a pas d'`uid`, utiliser `"seqId.planId.prise"`.

## Modifications à faire

1. **Choisir le projet** : remplacer le bouton « 📂 Importer CSV Script » par
   « 📂 Choisir le projet (.onefile) ». Utiliser la boîte de dialogue native CEP
   (`window.cep.fs.showOpenDialogEx(false, false, "Projet Cinema Script", dossierInitial, ["onefile"])`),
   pas un `<input type="file">` (le chemin complet est nécessaire). Enregistrer le chemin dans
   le fichier annexe. Afficher le nom du projet (nom du fichier) dans l'en-tête.
2. **Lire le `.onefile` avec Node** (`fs.readFileSync(path, 'utf8')`, retirer un BOM éventuel,
   `JSON.parse`, prendre `app_data`). Relire :
   - à l'ouverture du panneau et quand il reprend le focus ;
   - quand le fichier change (`fs.watchFile(path, { interval: 2000 })` : Drive remplace le
     fichier, `fs.watch` est peu fiable dessus) ;
   - avant chaque « Scanner & Synchro ».

   Si la lecture ou le `JSON.parse` échoue (fichier en cours d'écriture par Drive), réessayer
   après 1 s, 3 fois, puis afficher l'erreur dans le journal sans effacer les données déjà
   affichées. Si le fichier est « en ligne uniquement » (mode streaming de Drive), la lecture
   le télécharge : prévoir un message si cela échoue hors connexion.
3. **Passer les données au script Premiere** au lieu de les lui faire lire :
   `processAnalyzedRushes(matchedEncoded, unmatchedEncoded, scriptEncoded)`, où
   `scriptEncoded = encodeURIComponent(JSON.stringify(app_data))`. Dans `host.jsx`, décoder ce
   troisième argument et l'utiliser à la place de `loadKinoData()`.
4. **Rushs associés aux prises** : `host.jsx` ne sauvegarde plus rien. Il renvoie au panneau la
   liste `[{ uid, seqId, planId, prise, name }]` des rushs renommés (par exemple
   `"SUCCESS|<message>|<json encodé>"`), et le panneau les fusionne dans `rushes` du fichier
   annexe (sans doublon), écrit avec Node (`JSON.stringify`). Supprimer `saveKinoData`,
   `loadKinoData`, `JSON_stringify_fallback` et le fichier `_KinoData.json`, devenus inutiles
   (si un ancien `_KinoData.json` existe, on peut reprendre ses `rushes` une fois, par
   `seqId.planId.prise`).
5. **Retrouver une prise** pour un rush : comme aujourd'hui, par
   `(seqId, planId, prise)` décodés du clap. Note : dans la nouvelle app, **les numéros de
   prise ne sont plus renumérotés** quand on en supprime une (il peut y avoir des trous :
   prises 1, 3, 4). Ne rien supposer sur la continuité.
6. **Affichage** (`renderDisplay`, `renderTakesHTML`) : mêmes vues (Ordre Montage / Ordre
   Tournage), mais construire le DOM avec `textContent` au lieu de `innerHTML` pour tout
   texte venant du projet (`info`, `com`, `text`, `avis`, noms de rushs) : le projet est
   partagé en équipe. Rushs affichés depuis le fichier annexe (`rushes[take.uid]`).
   Prises triées par numéro. Les plans « impro » (`impro: 1`) peuvent être signalés.
7. **Supprimer** l'import CSV (`importCSV`, `csvInput`) et tout ce qui concerne le CSV.
8. Passer `ExtensionBundleVersion` / `Version` du `manifest.xml` à `1.1.0`, mettre à jour le
   `README.md` de l'extension (nouveau fonctionnement, fichier annexe).

## Point à vérifier sur Windows : les projets partagés

Un projet partagé par quelqu'un d'autre apparaît dans « Mon Drive » sous forme de
**raccourci Google Drive** (One App en crée un dans le dossier « Cinema Script »). Vérifier
avec Google Drive pour ordinateur :

- Le raccourci apparaît-il dans l'Explorateur, et comment (fichier `.onefile` lisible
  directement, `.lnk`, dossier, ou absent) ?
- Peut-on le sélectionner dans la boîte de dialogue et le lire avec `fs.readFileSync` ?
  Se met-il à jour quand le propriétaire modifie le projet ?

Si le raccourci n'est pas lisible tel quel, chercher le fichier réel (dans
« Partagés avec moi », s'il est exposé par Drive pour ordinateur, ou via un `.lnk` résolu par
`shell.readShortcutLink` côté Node) et documenter la solution retenue dans le README de
l'extension. Rapporter le résultat, c'est une information utile pour One App.

## Tests à faire

1. Créer un projet sur le téléphone (One App → Cinema Script), quelques séquences, plans,
   séparateurs ; attendre la synchronisation ; le choisir dans le panneau : affichage correct
   dans les deux vues, nom du projet = nom du fichier.
2. Modifier le projet sur le téléphone : le panneau se met à jour seul (≤ quelques secondes
   après la synchronisation de Drive).
3. Tourner 2–3 prises avec le clap de l'app (dont une prise supprimée → trou de numérotation),
   importer les rushs, « Scanner & Synchro » : rangement, couleurs, renommage `S.P.T_`,
   séquence de synchro identiques à avant ; rushs listés sous les bonnes prises.
4. Vérifier que le `.onefile` n'a pas été modifié par l'extension (date de modification dans
   Drive) et que le fichier annexe contient les rushs.
5. Fermer / rouvrir Premiere : le projet et les rushs sont retrouvés.
6. Projet partagé par un autre compte (voir ci-dessus).
7. Texte piégé dans un commentaire de prise (`<img src=x onerror=alert(1)>`) : affiché tel quel.
