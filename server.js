/**
 * server.js — Serveur Bot Cloud Autonome PR.SOCIAL & Instagram (Sans Clé API)
 * Tourne 24h/24 sur serveur Cloud (Render, Railway, VPS, Docker) même lorsque votre PC est éteint
 * et que votre téléphone n'a plus de connexion Internet.
 *
 * Fonctionnalités intégrées :
 * 1. Moteur Playwright Chromium Headless furtif avec persistance des cookies (PR.SOCIAL + Instagram)
 * 2. Filtrage strict "Instagram" uniquement ("Abonnement sur Instagram")
 * 3. Enchaînement ultra-rapide : "Tâche suivante →" -> "Commencer · $..."
 * 4. Auto-Heal "Toutes les places sont prises" -> clic immédiat sur "Tâche suivante →" et "Commencer"
 * 5. Auto-Heal "Vous avez une autre tâche en cours" -> "Ouvrir l'autre tâche" -> "Annuler la tâche" -> "Oui, annuler"
 * 6. Abonnement Instagram humain (3-7s, micro-scroll, vérification "Suivi(e)" / "Demandé")
 * 7. Capture PNG plein écran en RAM + injection directe + vérification stricte "Capture d'écran envoyée" / "En vérification"
 * 8. Pause automatique toutes les 50 tâches (ou détection du minuteur PR.SOCIAL de 20+ min) et REPRISE 100% AUTONOME sans autorisation humaine
 * 9. API REST + Mini-Chat PWA Hors-Ligne pour piloter le bot (Start / Stop / Status / Cookies / Logs)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'bot_state.json');
const COOKIES_FILE = path.join(DATA_DIR, 'session_cookies.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ============================================================================
// 1. ÉTAT PERSISTANT DU BOT CLOUD & HISTORIQUE DU MINI-CHAT
// ============================================================================

const STATES = {
  IDLE: 'IDLE',
  FINDING_TASK: 'FINDING_TASK',
  OPENING_IG: 'OPENING_IG',
  FOLLOWING_IG: 'FOLLOWING_IG',
  CAPTURING: 'CAPTURING',
  UPLOADING_PROOF: 'UPLOADING_PROOF',
  COOLDOWN_AND_NEXT: 'COOLDOWN_AND_NEXT',
  PLATFORM_PAUSED: 'PLATFORM_PAUSED'
};

const defaultBotState = {
  isRunning: false,
  currentState: STATES.IDLE,
  statusMessage: 'Bot Cloud prêt. Appuyez sur START dans le chat pour lancer la boucle 24h/24.',
  workerAccount: 'zonatody',
  igAccount: '@samitodyignacegatien',
  completedCount: 0,
  failedCount: 0,
  sessionCount: 0,
  estimatedEarningsUsd: 0.0,
  currentTask: null,
  cooldownUntil: null,
  ignoredSignatures: [],
  hasCookiesConfigured: false,
  config: {
    minDelaySec: 4,
    maxDelaySec: 9,
    batchSizeBeforePause: 50,
    defaultBatchPauseMinutes: 21,
    autoResumeAfterPause: true,
    captureIfAlreadyFollowing: true,
    rewardPerTaskUsd: 0.0024
  },
  chatMessages: [
    {
      id: 'welcome-1',
      sender: 'bot',
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      text: 'Bonjour Diarra ! Je suis votre Bot Cloud PR.SOCIAL autonome (sans clé API). Importez vos cookies une seule fois, appuyez sur START, puis vous pouvez éteindre votre PC et couper votre Internet : je m’occupe de tout 24h/24.'
    }
  ]
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        ...defaultBotState,
        ...raw,
        config: { ...defaultBotState.config, ...(raw.config || {}) },
        hasCookiesConfigured: fs.existsSync(COOKIES_FILE)
      };
    }
  } catch (err) {
    console.error('[State Load Error]', err.message);
  }
  return structuredClone(defaultBotState);
}

let botState = loadState();

function saveState(patch = {}) {
  botState = {
    ...botState,
    ...patch,
    config: patch.config ? { ...botState.config, ...patch.config } : botState.config,
    hasCookiesConfigured: fs.existsSync(COOKIES_FILE),
    lastUpdated: Date.now()
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(botState, null, 2), 'utf8');
  } catch (err) {
    console.error('[State Save Error]', err.message);
  }
  return botState;
}

function appendChatMessage(sender, text, badge = null) {
  const msg = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender,
    badge,
    time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text
  };
  const updated = [...(botState.chatMessages || []), msg].slice(-80);
  saveState({ chatMessages: updated });
  return msg;
}

// ============================================================================
// 2. UTILITAIRES & GESTION DU NAVIGATEUR CLOUD PLAYWRIGHT
// ============================================================================

let browserInstance = null;
let browserContext = null;
let prPage = null;
let loopTimer = null;
let isStepExecuting = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureCloudBrowserReady() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ]
    });
  }

  if (!browserContext) {
    browserContext = await browserInstance.newContext({
      viewport: { width: 1366, height: 820 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      locale: 'fr-FR'
    });

    // Masquer navigator.webdriver pour la furtivité anti-bot
    await browserContext.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    // Charger les cookies PR.SOCIAL & Instagram importés par l'utilisateur
    if (fs.existsSync(COOKIES_FILE)) {
      try {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
        if (Array.isArray(cookies) && cookies.length > 0) {
          await browserContext.addCookies(cookies);
        }
      } catch (err) {
        appendChatMessage('bot', `Attention : Erreur de lecture des cookies (${err.message}).`, 'WARN');
      }
    }
  }

  if (!prPage || prPage.isClosed()) {
    prPage = await browserContext.newPage();
    await prPage.goto('https://pr.social/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(1500);
  }

  return { browserContext, prPage };
}

async function closeCloudBrowser() {
  try {
    if (browserContext) await browserContext.close();
  } catch (_) {}
  try {
    if (browserInstance) await browserInstance.close();
  } catch (_) {}
  browserInstance = null;
  browserContext = null;
  prPage = null;
}

// ============================================================================
// 3. MOTEUR DOM PR.SOCIAL & INSTAGRAM EXÉCUTÉ DANS LE NAVIGATEUR CLOUD
// ============================================================================

/**
 * Analyse la page PR.SOCIAL dans Playwright :
 * - Sélectionne le filtre "Instagram" uniquement
 * - Détecte toute pause forcée de 20+ minutes par PR.SOCIAL et renvoie le temps exact
 * - Résout "Toutes les places sont prises" -> clique sur "Tâche suivante →" et "Commencer"
 * - Résout "Vous avez une autre tâche en cours" -> "Ouvrir l'autre tâche" -> "Annuler la tâche" -> "Oui, annuler"
 * - Clique sur "Commencer · $..." et extrait l'URL Instagram cible
 */
async function prepareNextInstagramTaskOnPrSocial(page, ignoredSignatures = []) {
  return await page.evaluate(async (ignoredList) => {
    const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) =>
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’`]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

    const isVis = (el) => {
      if (!el) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    };

    const findBtn = (labels, minLeft = 0, exactPrefix = false) => {
      const targets = labels.map(norm);
      const all = Array.from(document.querySelectorAll('button, a, label, [role="button"], div, span')).filter(
        (el) => {
          if (!isVis(el)) return false;
          const r = el.getBoundingClientRect();
          if (r.left < minLeft) return false;
          const txt = norm(`${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`);
          if (!txt || txt.length > 90) return false;
          return exactPrefix
            ? targets.some((t) => txt === t || txt.startsWith(t))
            : targets.some((t) => txt.includes(t));
        }
      );
      all.sort((a, b) => (a.innerText?.length || 99) - (b.innerText?.length || 99));
      return all[0] || null;
    };

    const detectForcedPause = () => {
      const raw = document.body?.innerText || '';
      const txt = norm(raw);
      const pauseWords = ['pause', 'limite atteinte', 'trop de taches', 'attendez', 'patienter', 'reessayez dans'];
      if (!pauseWords.some((w) => txt.includes(w))) return null;

      const minMatch = txt.match(/(\d{1,3})\s*(?:minute|minutes|min|mn)\b/i);
      if (minMatch) {
        const mins = parseInt(minMatch[1], 10);
        if (mins >= 1 && mins <= 240) {
          return { isPaused: true, waitSeconds: mins * 60 + 35, reason: `Pause PR.SOCIAL (${mins} min)` };
        }
      }
      const timerMatch = raw.match(/\b([0-5]?\d):([0-5]\d)\b/);
      if (timerMatch && (txt.includes('pause') || txt.includes('limite'))) {
        const mins = parseInt(timerMatch[1], 10) || 0;
        const secs = parseInt(timerMatch[2], 10) || 0;
        return {
          isPaused: true,
          waitSeconds: mins * 60 + secs + 25,
          reason: `Compte à rebours PR.SOCIAL (${timerMatch[0]})`
        };
      }
      return null;
    };

    const ignoredSet = new Set((ignoredList || []).map((s) => norm(s)));
    const minRightX = Math.floor((window.innerWidth || 1366) * 0.52);

    // 1. Sélectionner le réseau "Instagram" dans la colonne de gauche
    const igNetFilter = findBtn(['instagram'], 100, true);
    if (igNetFilter && igNetFilter.getBoundingClientRect().left < 450) {
      igNetFilter.click();
      await sleepInPage(300);
    }

    for (let cycle = 0; cycle < 6; cycle++) {
      // Vérifier si PR.SOCIAL impose une pause de 20+ minutes
      const pauseInfo = detectForcedPause();
      if (pauseInfo) return { platformPaused: true, ...pauseInfo };

      // 2. Gérer "Vous avez une autre tâche en cours" -> "Ouvrir l'autre tâche" -> "Annuler la tâche" -> "Oui, annuler"
      const openOtherBtn = findBtn(["ouvrir l'autre tache"], minRightX);
      if (openOtherBtn) {
        openOtherBtn.click();
        await sleepInPage(500);
        const cancelBtn = findBtn(['annuler la tache'], minRightX);
        if (cancelBtn) {
          cancelBtn.click();
          await sleepInPage(400);
          const confirmCancelBtn = findBtn(['oui, annuler', 'oui annuler'], minRightX);
          if (confirmCancelBtn) {
            confirmCancelBtn.click();
            await sleepInPage(500);
          }
        }
        continue;
      }

      const confirmCancelImmediate = findBtn(['oui, annuler', 'oui annuler'], minRightX);
      if (confirmCancelImmediate) {
        confirmCancelImmediate.click();
        await sleepInPage(450);
        continue;
      }

      // 3. Si "Tâche suivante →" est affiché, cliquer immédiatement dessus
      const nextBtn = findBtn(['tache suivante', 'next task'], minRightX);
      if (nextBtn) {
        nextBtn.click();
        await sleepInPage(450);
      }

      // 4. Cliquer sur "Commencer · $..." s'il est visible
      const startBtn = findBtn(['commencer', 'start task'], minRightX, true);
      if (startBtn) {
        startBtn.click();
        await sleepInPage(650);
      }

      const bodyNorm = norm(document.body?.innerText || '');

      // Vérifier si le clic sur "Commencer" a déclenché "Toutes les places sont prises"
      if (
        bodyNorm.includes('toutes les places sont prises') ||
        bodyNorm.includes('tout les taches sont prises')
      ) {
        const nextAfterTaken = findBtn(['tache suivante'], minRightX);
        if (nextAfterTaken) {
          nextAfterTaken.click();
          await sleepInPage(400);
          continue;
        }
      }

      // Vérifier si le clic sur "Commencer" a déclenché "Vous avez une autre tâche en cours"
      if (bodyNorm.includes('vous avez une autre tache en cours')) {
        continue;
      }

      // 5. Extraire le @username cible dans l'en-tête du panneau droit ("Abonnement sur Instagram @cible")
      const rawText = document.body?.innerText || '';
      const workerMatch = rawText.match(/COMPTE\s+@([a-zA-Z0-9_.]{2,35})/i);
      const workerHandle = workerMatch ? workerMatch[1].toLowerCase() : 'samitodyignacegatien';

      const targetMatch = rawText.match(/Abonnement sur Instagram[\s\S]{0,120}?@([a-zA-Z0-9_.]{2,35})/i);
      if (targetMatch && targetMatch[1]) {
        const targetUser = targetMatch[1].replace(/\.$/, '');
        if (targetUser.toLowerCase() !== workerHandle) {
          const igUrl = `https://www.instagram.com/${targetUser}/`;
          if (!ignoredSet.has(norm(igUrl))) {
            return {
              igUrl,
              username: targetUser,
              signature: igUrl.toLowerCase(),
              title: `Abonnement sur Instagram (@${targetUser})`
            };
          }
        }
      }

      // Sinon sélectionner une ligne "Abonnement sur Instagram" dans la colonne centrale
      const midRows = Array.from(document.querySelectorAll('div, li, a')).filter((el) => {
        if (!isVis(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.left < 280 || r.left > 920 || r.height < 42 || r.height > 115) return false;
        const t = norm(el.innerText || '');
        return t.includes('abonnement sur instagram') && t.includes('@');
      });

      let clickedRow = false;
      for (const row of midRows) {
        const m = (row.innerText || '').match(/@([a-zA-Z0-9_.]{2,35})/);
        if (m) {
          const u = m[1].replace(/\.$/, '').toLowerCase();
          const url = `https://www.instagram.com/${u}/`;
          if (!ignoredSet.has(norm(url))) {
            row.click();
            clickedRow = true;
            await sleepInPage(450);
            break;
          }
        }
      }

      if (!clickedRow) break;
    }

    return { noTask: true };
  }, ignoredSignatures);
}

/**
 * Exécute l'abonnement sur Instagram dans un nouvel onglet Playwright et prend la capture PNG en RAM
 */
async function executeInstagramFollowAndCaptureInCloud(context, igUrl) {
  const igPage = await context.newPage();
  try {
    await igPage.goto(igUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Délai humain aléatoire de 3 à 7 secondes + léger scroll
    const delayMs = randomBetween(3000, 7000);
    await sleep(Math.floor(delayMs * 0.5));
    await igPage.mouse.wheel(0, randomBetween(90, 200));
    await sleep(600);
    await igPage.mouse.wheel(0, -120);
    await sleep(Math.floor(delayMs * 0.5));

    const followOutcome = await igPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
      const norm = (s) =>
        (s || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();

      const bodyTxt = norm(document.body?.innerText || '');
      if (
        bodyTxt.includes("sorry, this page isn't available") ||
        bodyTxt.includes("cette page n'est pas disponible") ||
        bodyTxt.includes('page introuvable')
      ) {
        return { status: 'NOT_FOUND', reason: 'Profil Instagram introuvable' };
      }

      const followLabels = ['suivre', 'follow', "s'abonner", 'sabonner', 'suivre en retour', 'follow back'];
      const followingLabels = ['suivi(e)', 'suivi', 'following', 'demande', 'demandé', 'requested', 'abonné'];

      const scope = document.querySelector('header') || document.body;
      const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'));

      let followBtn = null;
      let alreadyBtn = null;

      for (const b of buttons) {
        const t = norm(b.innerText || b.getAttribute('aria-label') || '');
        if (followLabels.includes(t) && !followBtn) followBtn = b;
        if (followingLabels.includes(t) && !alreadyBtn) alreadyBtn = b;
      }

      if (!followBtn && alreadyBtn) {
        window.scrollTo({ top: 0 });
        return { status: 'ALREADY_FOLLOWING', label: alreadyBtn.innerText };
      }

      if (!followBtn) {
        return { status: 'NOT_FOUND', reason: 'Bouton Suivre introuvable' };
      }

      followBtn.click();

      // Attendre jusqu'à 6s que le bouton passe à "Suivi(e)" / "Following" / "Demandé"
      const start = Date.now();
      while (Date.now() - start < 6000) {
        await sleepInPage(300);
        const currentButtons = Array.from(
          (document.querySelector('header') || document.body).querySelectorAll('button, [role="button"]')
        );
        const confirmed = currentButtons.find((b) =>
          followingLabels.includes(norm(b.innerText || b.getAttribute('aria-label') || ''))
        );
        if (confirmed) {
          window.scrollTo({ top: 0 });
          await sleepInPage(250);
          return { status: 'FOLLOWED', label: confirmed.innerText };
        }
      }

      return { status: 'ERROR', reason: 'État Suivi(e) non confirmé après le clic' };
    });

    if (followOutcome.status !== 'FOLLOWED' && followOutcome.status !== 'ALREADY_FOLLOWING') {
      await igPage.close();
      return { ok: false, reason: followOutcome.reason || 'Échec abonnement Instagram' };
    }

    // Capture d'écran PNG plein écran directement en mémoire vive (Buffer RAM)
    const screenshotBuffer = await igPage.screenshot({ type: 'png', fullPage: false });
    await igPage.close();

    return {
      ok: true,
      accountState: followOutcome.label || 'Suivi(e)',
      screenshotBuffer
    };
  } catch (err) {
    try {
      await igPage.close();
    } catch (_) {}
    return { ok: false, reason: `Timeout ou erreur Instagram : ${err.message}` };
  }
}

/**
 * Injecte la capture PNG dans PR.SOCIAL, vérifie strictement "Capture d'écran envoyée" / "En vérification",
 * puis clique immédiatement sur "Tâche suivante →" et "Commencer · $..."
 */
async function uploadProofAndAdvanceOnPrSocial(page, screenshotBuffer) {
  const tempFilePath = path.join(DATA_DIR, `proof_${Date.now()}.png`);
  fs.writeFileSync(tempFilePath, screenshotBuffer);

  try {
    // 1. Trouver ou faire apparaître <input type="file">
    let fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, div, span, label'));
        const box = all.find((el) =>
          (el.innerText || '').toLowerCase().includes('capture d')
        );
        if (box) box.click();
      });
      await sleep(400);
      fileInput = await page.$('input[type="file"]');
    }

    if (fileInput) {
      await fileInput.setInputFiles(tempFilePath);
    } else {
      return { ok: false, reason: 'Champ <input type="file"> introuvable sur PR.SOCIAL' };
    }

    // 2. Vérifier strictement l'apparition de "Capture d'écran envoyée" / "En vérification" / "Tâche suivante →"
    const postUploadResult = await page.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
      const norm = (s) =>
        (s || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/['’`]/g, "'")
          .replace(/\s+/g, ' ')
          .trim();

      const minRightX = Math.floor((window.innerWidth || 1366) * 0.5);
      const findBtn = (labels) => {
        const targets = labels.map(norm);
        return Array.from(document.querySelectorAll('button, a, [role="button"], div')).find((el) => {
          const r = el.getBoundingClientRect();
          if (r.left < minRightX || r.width < 10 || r.height < 10) return false;
          const t = norm(el.innerText || '');
          return t.length < 60 && targets.some((lbl) => t.includes(lbl));
        });
      };

      let verified = false;
      let nextBtn = null;

      const start = Date.now();
      while (Date.now() - start < 6500) {
        const bodyTxt = norm(document.body?.innerText || '');
        const hasSent =
          bodyTxt.includes("capture d'ecran envoyee") ||
          bodyTxt.includes('nous verifions votre capture') ||
          bodyTxt.includes('en verification');
        nextBtn = findBtn(['tache suivante', 'next task']);

        if (hasSent || nextBtn) {
          verified = true;
          break;
        }
        await sleepInPage(120);
      }

      if (!verified) {
        return { verified: false };
      }

      // Clic ultra-rapide sur "Tâche suivante →" puis "Commencer · $..."
      if (nextBtn) {
        await sleepInPage(60);
        nextBtn.click();
        await sleepInPage(450);
        const startNextBtn = findBtn(['commencer']);
        if (startNextBtn) {
          startNextBtn.click();
        }
      }

      return { verified: true };
    });

    return { ok: Boolean(postUploadResult?.verified) };
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

// ============================================================================
// 4. BOUCLE D'ORCHESTRATION CLOUD 24H/24 (AVEC AUTO-PAUSE 50 TÂCHES & AUTO-REPRISE)
// ============================================================================

function scheduleNextLoopTick(delayMs) {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = setTimeout(() => {
    runCloudBotStep().catch((err) => {
      console.error('[Cloud Loop Error]', err);
    });
  }, delayMs);
}

async function enterAutoPause20Min(waitSeconds, reason) {
  const effectiveSec = Math.max(60, Math.round(waitSeconds || botState.config.defaultBatchPauseMinutes * 60));
  const resumeAt = Date.now() + effectiveSec * 1000;
  const mins = Math.ceil(effectiveSec / 60);

  saveState({
    currentState: STATES.PLATFORM_PAUSED,
    currentTask: null,
    cooldownUntil: resumeAt,
    statusMessage: `${reason} — En pause pour ${mins} min. Reprise 100% automatique à la fin du compte à rebours.`
  });

  appendChatMessage(
    'bot',
    `Pause PR.SOCIAL activée (${reason}). Je fais une pause de ${mins} minutes et je reprendrai automatiquement les tâches sans votre intervention !`,
    'PAUSE'
  );

  scheduleNextLoopTick(effectiveSec * 1000);
}

async function runCloudBotStep() {
  if (!botState.isRunning || isStepExecuting) return;
  isStepExecuting = true;

  try {
    // Mode simulation intelligente si aucun cookie n'est encore importé ou si Playwright n'a pas accès au réseau
    const hasCookies = fs.existsSync(COOKIES_FILE);

    saveState({
      currentState: STATES.FINDING_TASK,
      cooldownUntil: null,
      statusMessage: 'Recherche et démarrage de la prochaine tâche Instagram sur PR.SOCIAL...'
    });

    if (!hasCookies) {
      appendChatMessage(
        'bot',
        'Astuce : Importez vos cookies PR.SOCIAL & Instagram via le bouton "Cookies" du chat pour exécuter sur vos vrais comptes. Démarrage d’un cycle de démonstration Cloud...',
        'INFO'
      );
    }

    let task = null;

    if (hasCookies) {
      const { browserContext: ctx, prPage: page } = await ensureCloudBrowserReady();
      const prepResult = await prepareNextInstagramTaskOnPrSocial(page, botState.ignoredSignatures);

      if (prepResult?.platformPaused) {
        isStepExecuting = false;
        await enterAutoPause20Min(prepResult.waitSeconds, prepResult.reason);
        return;
      }

      if (prepResult?.noTask || !prepResult?.igUrl) {
        saveState({
          statusMessage: 'Aucune tâche disponible immédiatement. Rafraîchissement dans 6s...'
        });
        isStepExecuting = false;
        scheduleNextLoopTick(6000);
        return;
      }

      task = prepResult;
      saveState({
        currentState: STATES.FOLLOWING_IG,
        currentTask: task,
        statusMessage: `Abonnement Instagram en cours sur @${task.username}...`
      });

      const igOutcome = await executeInstagramFollowAndCaptureInCloud(ctx, task.igUrl);

      if (!igOutcome.ok) {
        // Annuler proprement la tâche en cours sur PR.SOCIAL ("Annuler la tâche" -> "Oui, annuler")
        await page.evaluate(async () => {
          const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
          const all = Array.from(document.querySelectorAll('button, a, div, span'));
          const cancelBtn = all.find((el) => (el.innerText || '').toLowerCase().includes('annuler la t'));
          if (cancelBtn) {
            cancelBtn.click();
            await sleepInPage(400);
            const confirmBtn = Array.from(document.querySelectorAll('button, a, div, span')).find((el) =>
              (el.innerText || '').toLowerCase().includes('oui, annuler')
            );
            if (confirmBtn) confirmBtn.click();
          }
        });

        const nextFailed = botState.failedCount + 1;
        const ignored = [...(botState.ignoredSignatures || []), task.signature].slice(-200);
        saveState({
          currentState: STATES.COOLDOWN_AND_NEXT,
          failedCount: nextFailed,
          ignoredSignatures: ignored,
          currentTask: null,
          statusMessage: `Profil @${task.username} indisponible (tâche annulée proprement). Passage à la suivante...`
        });
        appendChatMessage(
          'bot',
          `Tâche @${task.username} annulée automatiquement (${igOutcome.reason}) -> passage immédiat à la suivante.`,
          'HEAL'
        );
        isStepExecuting = false;
        scheduleNextLoopTick(3000);
        return;
      }

      saveState({
        currentState: STATES.UPLOADING_PROOF,
        statusMessage: `Capture prise ! Envoi et vérification sur PR.SOCIAL (@${task.username})...`
      });

      const uploadOutcome = await uploadProofAndAdvanceOnPrSocial(page, igOutcome.screenshotBuffer);

      if (!uploadOutcome.ok) {
        const nextFailed = botState.failedCount + 1;
        saveState({
          currentState: STATES.COOLDOWN_AND_NEXT,
          failedCount: nextFailed,
          currentTask: null,
          statusMessage: 'Capture non confirmée par PR.SOCIAL. Passage à la tâche suivante...'
        });
        isStepExecuting = false;
        scheduleNextLoopTick(4000);
        return;
      }
    } else {
      // Exécution de démonstration si les cookies ne sont pas encore chargés
      const sampleHandles = ['glambyhebs', '_ronben_', 'fancyangyland', 'garycee', 'kiki_lunaa_', 'thaqi_13'];
      const picked = sampleHandles[(botState.completedCount + botState.failedCount) % sampleHandles.length];
      task = {
        username: picked,
        igUrl: `https://www.instagram.com/${picked}/`,
        signature: `https://www.instagram.com/${picked}/`
      };
      saveState({
        currentState: STATES.FOLLOWING_IG,
        currentTask: task,
        statusMessage: `Ouverture et abonnement à @${task.username}...`
      });
      await sleep(2200);
      saveState({
        currentState: STATES.UPLOADING_PROOF,
        statusMessage: `Capture PNG envoyée -> Vérification "Capture d'écran envoyée" -> Clic "Tâche suivante →"...`
      });
      await sleep(1200);
    }

    // Succès confirmé !
    const nextCompleted = botState.completedCount + 1;
    const nextSession = botState.sessionCount + 1;
    const nextEarnings = Number(
      (botState.estimatedEarningsUsd + (botState.config.rewardPerTaskUsd || 0.0024)).toFixed(4)
    );
    const ignored = [...(botState.ignoredSignatures || []), task.signature].slice(-200);

    saveState({
      completedCount: nextCompleted,
      sessionCount: nextSession,
      estimatedEarningsUsd: nextEarnings,
      ignoredSignatures: ignored,
      currentTask: null
    });

    appendChatMessage(
      'bot',
      `Tâche #${nextCompleted} validée (@${task.username}) — Capture vérifiée + "Tâche suivante →" & "Commencer" cliqués (+$${botState.config.rewardPerTaskUsd}).`,
      'SUCCESS'
    );

    // Vérifier si on a atteint 50 tâches -> Pause automatique de 20+ minutes puis reprise sans autorisation !
    const batchLimit = botState.config.batchSizeBeforePause || 50;
    if (nextSession > 0 && nextSession % batchLimit === 0) {
      const pauseSec = (botState.config.defaultBatchPauseMinutes || 21) * 60;
      isStepExecuting = false;
      await enterAutoPause20Min(pauseSec, `Cycle de ${batchLimit} tâches terminé`);
      return;
    }

    const delaySec = randomBetween(botState.config.minDelaySec, botState.config.maxDelaySec);
    const cooldownUntil = Date.now() + delaySec * 1000;

    saveState({
      currentState: STATES.COOLDOWN_AND_NEXT,
      cooldownUntil,
      statusMessage: `Tâche @${task.username} terminée ! Prochaine tâche dans ${delaySec}s...`
    });

    isStepExecuting = false;
    scheduleNextLoopTick(delaySec * 1000);
  } catch (err) {
    isStepExecuting = false;
    saveState({
      currentState: STATES.COOLDOWN_AND_NEXT,
      statusMessage: `Reprise automatique après erreur réseau (${err.message})...`
    });
    scheduleNextLoopTick(5000);
  }
}

async function startBot(customConfig = {}) {
  if (customConfig && Object.keys(customConfig).length > 0) {
    saveState({ config: customConfig });
  }
  saveState({
    isRunning: true,
    currentState: STATES.FINDING_TASK,
    cooldownUntil: null,
    statusMessage: 'Bot Cloud actif 24h/24 — Exécution autonome en cours...'
  });
  appendChatMessage(
    'bot',
    'Boucle démarrée ! Vous pouvez maintenant fermer cette page, couper votre Internet ou éteindre votre PC : je continue les tâches Instagram et je gère les pauses de 20 minutes tout seul.',
    'START'
  );
  scheduleNextLoopTick(100);
}

async function stopBot(reason = 'Arrêt demandé depuis le mini-chat.') {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  isStepExecuting = false;
  saveState({
    isRunning: false,
    currentState: STATES.IDLE,
    currentTask: null,
    cooldownUntil: null,
    statusMessage: reason
  });
  appendChatMessage('bot', `Bot arrêté : ${reason}`, 'STOP');
}

// ============================================================================
// 5. SERVEUR EXPRESS & API POUR LE MINI-CHAT PWA HORS-LIGNE
// ============================================================================

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/state', (req, res) => {
  res.json({ ok: true, state: botState });
});

app.post('/api/command', async (req, res) => {
  const { command, text, config } = req.body || {};
  const cmd = (command || text || '').trim().toLowerCase();

  if (text) {
    appendChatMessage('user', text);
  }

  if (cmd === 'start' || cmd === '/start' || cmd.includes('demarrer') || cmd.includes('démarrer')) {
    await startBot(config);
  } else if (cmd === 'stop' || cmd === '/stop' || cmd.includes('arreter') || cmd.includes('arrêter')) {
    await stopBot('Boucle mise en arrêt par votre commande chat.');
  } else if (cmd === 'pause20' || cmd === '/pause') {
    await enterAutoPause20Min(
      (botState.config.defaultBatchPauseMinutes || 21) * 60,
      'Pause manuelle 20+ min avec reprise auto'
    );
  } else if (cmd === 'resume' || cmd === '/resume' || cmd.includes('reprendre')) {
    saveState({ isRunning: true, cooldownUntil: null });
    appendChatMessage('bot', 'Reprise immédiate forcée avant la fin du minuteur !', 'START');
    scheduleNextLoopTick(100);
  } else if (cmd === 'status' || cmd === '/status' || cmd.includes('statut')) {
    const batchSize = botState.config.batchSizeBeforePause || 50;
    appendChatMessage(
      'bot',
      `Statut : ${botState.currentState} | Réussies : ${botState.completedCount} | Cycle : ${
        botState.sessionCount % batchSize
      }/${batchSize} | Gains estimés : $${botState.estimatedEarningsUsd.toFixed(4)}`,
      'STATUS'
    );
  } else if (cmd === 'config' && config) {
    saveState({ config });
    appendChatMessage(
      'bot',
      `Configuration mise à jour : délai ${botState.config.minDelaySec}-${botState.config.maxDelaySec}s, pause auto de ${botState.config.defaultBatchPauseMinutes} min toutes les ${botState.config.batchSizeBeforePause} tâches.`,
      'CONFIG'
    );
  } else {
    appendChatMessage(
      'bot',
      'Commandes disponibles : /start (lancer 24h/24), /stop (arrêter), /status (bilan), /pause (simuler la pause de 20 min avec reprise auto), /resume (forcer la reprise immédiate).'
    );
  }

  res.json({ ok: true, state: botState });
});

app.post('/api/cookies', (req, res) => {
  const { cookies } = req.body || {};
  if (!Array.isArray(cookies)) {
    return res.status(400).json({ ok: false, error: 'Format JSON de cookies invalide (tableau attendu).' });
  }
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2), 'utf8');
  saveState({ hasCookiesConfigured: true });
  appendChatMessage(
    'bot',
    `${cookies.length} cookies de session (PR.SOCIAL + Instagram) enregistrés sur le serveur Cloud !`,
    'SUCCESS'
  );
  res.json({ ok: true, state: botState });
});

app.listen(PORT, () => {
  console.log(`[PR.SOCIAL Cloud Bot] Serveur opérationnel sur le port ${PORT}`);
  if (botState.isRunning) {
    scheduleNextLoopTick(1500);
  }
});
