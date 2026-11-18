# Guide d'installation — Bot Cloud PR.SOCIAL 24h/24 (Sans Clé API) + Mini-Chat

Ce pack contient à la fois :
1. **Le Serveur Bot Cloud (`server.js` + `Dockerfile` + `render.yaml`)** qui fait tourner un navigateur Chromium invisible (Playwright) 24h/24 sans clé API, même lorsque votre PC est éteint et que votre téléphone n'a plus d'Internet.
2. **Le Mini-Chat de contrôle PWA (`public/index.html` + `public/sw.js`)** ouvrable dans votre Google Chrome sur Android ou Microsoft Edge sur PC.
3. **L'extension navigateur mise à jour (`extension-edge-et-android/`)** incluant elle aussi la pause automatique de 20+ minutes toutes les 50 tâches et la reprise 100 % autonome sans autorisation.

## Fonctionnalités automatiques intégrées
- **Uniquement Instagram** : filtre automatiquement sur le réseau `Instagram` (`Abonnement sur Instagram`).
- **Enchaînement ultra-rapide (< 60 ms)** : dès que `Capture d'écran envoyée` / `En vérification` apparaît, clique sur `Tâche suivante →` puis `Commencer · $...`.
- **Gestion de « Toutes les places sont prises »** : clique immédiatement sur `Tâche suivante →` et `Commencer`.
- **Gestion de « Vous avez une autre tâche en cours »** : clique automatiquement sur `Ouvrir l'autre tâche` → `Annuler la tâche` → `Oui, annuler`.
- **Pause forcée toutes les 50 tâches (20+ minutes)** : détecte automatiquement le temps de pause imposé par PR.SOCIAL (ou après 50 tâches), attend la fin du compte à rebours et **reprend tout seul la réalisation des tâches sans aucune autorisation de votre part**.

## Déploiement Cloud gratuit 24h/24 (Render / Railway / VPS)
1. Créez un dépôt GitHub privé avec le contenu de ce dossier.
2. Sur **Render.com** ou **Railway.app**, choisissez **New Web Service** (Docker) et sélectionnez votre dépôt.
3. Ouvrez l'URL de votre bot dans Chrome sur Android, collez vos cookies PR.SOCIAL + Instagram une seule fois, puis appuyez sur **START BOT 24H/24**.
4. Vous pouvez éteindre votre PC et couper votre Internet : le serveur continue de travailler jour et nuit.
