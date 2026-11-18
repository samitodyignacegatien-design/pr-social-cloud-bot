# Guide Rapide (3 Étapes) — Activer votre Bot Cloud Gratuit sur GitHub Actions

Grâce à vos choix, votre bot est configuré pour :
1. **Tourner gratuitement sur votre compte GitHub (GitHub Actions)** de **06h00 du matin à 22h00 le soir** (heure de Madagascar), même quand **votre PC est éteint et votre connexion Internet coupée**.
2. **Utiliser uniquement votre compte `@samitodyignacegatien`** avec un **Bouclier Anti-Ban** (mouvements de souris courbes de Bézier, micro-scrolls sur les photos du profil, micro-pause de 30s toutes les 12 tâches, arrêt immédiat si Instagram affiche un avertissement, et sommeil nocturne de 22h00 à 06h00).
3. **Faire UNIQUEMENT les tâches « Abonnement sur Instagram »** (à n'importe quel tarif : `$0.0028`, `$0.0024`, `$0.0022`, etc.) et **ignorer totalement** les tâches de commentaires, de signalement/bannissement ou les autres réseaux.
4. **Enchaîner les cycles de 50 tâches + pause de 20+ minutes** et **reprendre tout seul** dès que la pause est terminée sans vous demander d'autorisation.

---

## Étape 1 : Créer un dépôt PRIVÉ sur votre compte GitHub
1. Connectez-vous sur [github.com](https://github.com/) et cliquez sur **New repository** (`+` en haut à droite).
2. Nommez-le `pr-social-cloud-bot`, cochez impérativement **Private** (Privé), puis cliquez sur **Create repository**.
3. Cliquez sur **uploading an existing file** et glissez tous les fichiers du dossier `cloud-bot-24-7` (y compris le dossier `.github/workflows/pr-social-auto-bot.yml`), puis validez avec **Commit changes**.

## Étape 2 : Ajouter vos cookies de connexion (1 seule fois)
1. Dans Microsoft Edge sur votre PC, connectez-vous à `pr.social` et à `instagram.com` (`@samitodyignacegatien`).
2. Installez l'extension gratuite **Cookie-Editor** sur Edge, exportez les cookies de `pr.social` et d'`instagram.com` au format **JSON** et réunissez-les dans un seul tableau `[...]`.
3. Sur votre dépôt GitHub, allez dans **Settings** → **Secrets and variables** → **Actions** → **New repository secret** :
   - **Name** : `SESSION_COOKIES_JSON`
   - **Secret** : Collez votre tableau JSON de cookies et cliquez sur **Add secret**.

## Étape 3 : Lancer en 1 clic ou laisser le réveil automatique de 06h00 travailler
- **Programmation automatique** : Vous n'avez rien à faire ! Chaque matin à **06h00**, GitHub démarre le bot automatiquement, travaille jusqu'à **22h00** (avec les pauses de 20 minutes toutes les 50 tâches), puis s'arrête la nuit.
- **Lancement immédiat à tout moment** : Allez dans l'onglet **Actions** de votre dépôt GitHub → cliquez sur **PR.SOCIAL Stealth IG Bot** → bouton **Run workflow** (ou double-cliquez sur `Lancer_Bot_Depuis_PC.bat`), puis coupez votre Internet et éteignez votre PC !
