# Banc d'essai One App

Ces tests ouvrent `index.html` dans un vrai navigateur (Chromium), face à un
**faux Google Drive** simulé en mémoire. Aucun compte Google n'est nécessaire
et rien n'est envoyé sur Internet.

Ils vérifient notamment :

- la sauvegarde (modifs pendant un envoi, fermeture rapide, erreurs 500,
  jeton expiré, popup bloquée, conflits entre appareils) ;
- le contrat app ↔ One App (squelette du prompt, Annuler/Rétablir, lecture seule) ;
- la sécurité (noms de fichiers piégés) ;
- de vraies apps générées par IA, rangées dans `fixtures/`.

## Lancer les tests

```bash
cd tests
npm install
npx playwright install chromium   # une seule fois
npm test
```

Pour ne lancer que certains tests : `node run.mjs "Compteur"`.

## Ajouter une app de référence

1. Copier le HTML de l'app dans `fixtures/mon-app.html`.
2. Dans `run.mjs`, ajouter un test sur le modèle de ceux du « Compteur (Gemini) » :
   `openFixture(page, 'mon-app.html')`, puis cliquer/remplir dans `frame`
   comme le ferait un utilisateur, et vérifier `saved()` (le contenu enregistré sur le faux Drive).
