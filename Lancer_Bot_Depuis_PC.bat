@echo off
chcp 65001 >nul
title PR.SOCIAL Cloud Bot — Lanceur Rapide 06h00 (Zéro Data)
color 0A

echo ============================================================================
echo   PR.SOCIAL CLOUD BOT — ACTIVATION A DISTANCE (GITHUB ACTIONS 24/7)
echo   Compte PR.SOCIAL : zonatody ^| Instagram : @samitodyignacegatien
echo   Mode : Abonnements Instagram uniquement (Tous revenus) + Bouclier Anti-Ban
echo ============================================================================
echo.

REM Remplacez VOTRE_PSEUDO_GITHUB et VOTRE_TOKEN_GITHUB ci-dessous (ou utilisez la programmation auto 06h00)
set "GITHUB_USER=VOTRE_PSEUDO_GITHUB"
set "GITHUB_REPO=pr-social-cloud-bot"
set "GITHUB_TOKEN=VOTRE_TOKEN_GITHUB"

if "%GITHUB_TOKEN%"=="VOTRE_TOKEN_GITHUB" (
    echo [INFO] Rappel : Votre bot est deja programme pour demarrer TOUT SEUL chaque matin a 06h00
    echo        sur les serveurs de GitHub ^(meme si votre PC est eteint et votre Internet coupe^).
    echo.
    echo Ouverture de votre tableau de bord GitHub Actions dans Microsoft Edge...
    start msedge "https://github.com/"
    pause
    exit /b 0
)

echo Envoi du signal de demarrage au serveur Cloud GitHub Actions...
curl -s -X POST ^
  -H "Accept: application/vnd.github+json" ^
  -H "Authorization: Bearer %GITHUB_TOKEN%" ^
  https://api.github.com/repos/%GITHUB_USER%/%GITHUB_REPO%/actions/workflows/pr-social-auto-bot.yml/dispatches ^
  -d "{\"ref\":\"main\"}"

echo.
echo [SUCCES] Le Bot Cloud a demarre sur les serveurs de GitHub !
echo Vous pouvez maintenant COUPER votre connexion Internet et ETEINDRE votre PC.
echo.
pause
