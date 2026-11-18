/**
 * bot_cloud_runner.js — Robot Cloud 100% Autonome pour GitHub Actions (Sans Clé API)
 * Version corrigée : intercepteur filechooser natif Playwright + anti-boucle infinie
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'bot_state.json');
const COOKIES_FILE = path.join(DATA_DIR, 'session_cookies.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MAX_RUNTIME_MINUTES = parseInt(process.env.MAX_RUNTIME_MINUTES || '315', 10);
const STOP_HOUR_EVENING = parseInt(process.env.STOP_HOUR_EVENING || '22', 10);

const FORBIDDEN_TASK_KEYWORDS = [
  'commentaire', 'commenter', 'comment', 'signaler', 'signalement',
  'report', 'bannir', 'bloquer', 'like', "j'aime", 'partager',
  'story', 'vue', 'twitter', 'linkedin', 'tiktok', 'youtube', 'facebook', 'surf'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

async function moveMouseHumanLike(page, targetX, targetY) {
  const startX = randomBetween(180, 950);
  const startY = randomBetween(140, 620);
  const ctrlX = (startX + targetX) / 2 + randomBetween(-90, 90);
  const ctrlY = (startY + targetY) / 2 + randomBetween(-70, 70);
  const steps = randomBetween(14, 22);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * targetX);
    const y = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * ctrlY + t * t * targetY);
    await page.mouse.move(x, y);
    await sleep(randomBetween(6, 15));
  }
}

function isEveningStopTimeReached() {
  const hour = new Date().getHours();
  return hour >= STOP_HOUR_EVENING || hour < 5;
}

function loadBotState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) {}
  return {
    completedCount: 0,
    failedCount: 0,
    cycleCount: 0,
    ignoredSignatures: [],
    lastUpdated: Date.now()
  };
}

function saveBotState(state) {
  state.lastUpdated = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function loadSessionCookies() {
  if (process.env.SESSION_COOKIES_JSON && process.env.SESSION_COOKIES_JSON.trim().startsWith('[')) {
    return JSON.parse(process.env.SESSION_COOKIES_JSON);
  }
  if (fs.existsSync(COOKIES_FILE)) {
    return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  }
  throw new Error('Aucun cookie trouvé. Ajoutez le secret GitHub SESSION_COOKIES_JSON.');
}

async function cancelActiveTaskOnPrSocial(prPage) {
  await prPage.evaluate(async () => {
    const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const all = Array.from(document.querySelectorAll('button, a, div, span'));
    const cancelBtn = all.find((el) => norm(el.innerText || '').includes('annuler la tache'));
    if (cancelBtn) {
      cancelBtn.click();
      await sleepInPage(450);
      const confirmBtn = Array.from(document.querySelectorAll('button, a, div, span')).find((el) =>
        norm(el.innerText || '').includes('oui, annuler')
      );
      if (confirmBtn) {
        confirmBtn.click();
        await sleepInPage(500);
      }
    }
  });
}

async function findAndStartNextInstagramSubscriptionTask(page, ignoredSignatures) {
  return await page.evaluate(
    async ({ ignoredList, forbiddenWords }) => {
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
        const all = Array.from(
          document.querySelectorAll('button, a, label, [role="button"], div, span')
        ).filter((el) => {
          if (!isVis(el)) return false;
          const r = el.getBoundingClientRect();
          if (r.left < minLeft) return false;
          const txt = norm(`${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`);
          if (!txt || txt.length > 90) return false;
          return exactPrefix
            ? targets.some((t) => txt === t || txt.startsWith(t))
            : targets.some((t) => txt.includes(t));
        });
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
            return { isPaused: true, waitSeconds: mins * 60 + 40, reason: `Pause PR.SOCIAL (${mins} min)` };
          }
        }
        return null;
      };

      const ignoredSet = new Set((ignoredList || []).map((s) => norm(s)));
      const minRightX = Math.floor((window.innerWidth || 1366) * 0.52);

      const igNetFilter = findBtn(['instagram'], 100, true);
      if (igNetFilter && igNetFilter.getBoundingClientRect().left < 450) {
        igNetFilter.click();
        await sleepInPage(300);
      }

      for (let cycle = 0; cycle < 6; cycle++) {
        const pauseInfo = detectForcedPause();
        if (pauseInfo) return { platformPaused: true, ...pauseInfo };

        const openOtherBtn = findBtn(["ouvrir l'autre tache"], minRightX);
        if (openOtherBtn) {
          openOtherBtn.click();
          await sleepInPage(450);
          const cancelBtn = findBtn(['annuler la tache'], minRightX);
          if (cancelBtn) {
            cancelBtn.click();
            await sleepInPage(350);
            const confirmCancelBtn = findBtn(['oui, annuler', 'oui annuler'], minRightX);
            if (confirmCancelBtn) {
              confirmCancelBtn.click();
              await sleepInPage(450);
            }
          }
          continue;
        }

        const confirmCancelImmediate = findBtn(['oui, annuler', 'oui annuler'], minRightX);
        if (confirmCancelImmediate) {
          confirmCancelImmediate.click();
          await sleepInPage(400);
          continue;
        }

        const nextBtn = findBtn(['tache suivante', 'next task'], minRightX);
        if (nextBtn) {
          nextBtn.click();
          await sleepInPage(400);
        }

        const rightPanelText = norm(document.body?.innerText || '');
        const hasForbiddenTaskType = forbiddenWords.some(
          (w) => rightPanelText.includes(`${w} sur instagram`) || rightPanelText.includes(`type ${w}`)
        );

        if (hasForbiddenTaskType || !rightPanelText.includes('abonnement sur instagram')) {
          const midRows = Array.from(document.querySelectorAll('div, li, a')).filter((el) => {
            if (!isVis(el)) return false;
            const r = el.getBoundingClientRect();
            if (r.left < 260 || r.left > 930 || r.height < 40 || r.height > 115) return false;
            const t = norm(el.innerText || '');
            const isStrictSub = t.includes('abonnement sur instagram') && t.includes('@');
            const isForbidden = forbiddenWords.some((fw) => t.includes(fw));
            return isStrictSub && !isForbidden;
          });

          if (midRows.length > 0) {
            midRows[0].click();
            await sleepInPage(400);
          }
        }

        const startBtn = findBtn(['commencer', 'start task'], minRightX, true);
        if (startBtn) {
          startBtn.click();
          await sleepInPage(700);
        }

        const afterStartPause = detectForcedPause();
        if (afterStartPause) return { platformPaused: true, ...afterStartPause };

        const bodyNorm = norm(document.body?.innerText || '');

        if (bodyNorm.includes('toutes les places sont prises') || bodyNorm.includes('tout les taches sont prises')) {
          const nextAfterTaken = findBtn(['tache suivante'], minRightX);
          if (nextAfterTaken) {
            nextAfterTaken.click();
            await sleepInPage(350);
            continue;
          }
        }

        if (bodyNorm.includes('vous avez une autre tache en cours')) {
          continue;
        }

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
      }

      return { noTask: true };
    },
    { ignoredList: ignoredSignatures, forbiddenWords: FORBIDDEN_TASK_KEYWORDS }
  );
}

async function uploadProofToPrSocial(prPage, tempProofPath) {
  let fileSet = false;

  // 1. Tenter d'abord un <input type="file"> déjà présent dans le DOM
  const existingInput = await prPage.$('input[type="file"]');
  if (existingInput) {
    await existingInput.setInputFiles(tempProofPath);
    fileSet = true;
  } else {
    // 2. Cliquer sur le bouton orange "Ajouter une capture d'écran" en interceptant le sélecteur natif filechooser
    const uploadButtonLocator = prPage.locator('button, a, label, div').filter({
      hasText: /Ajouter une capture|Ajoutez une capture/i
    }).last();

    try {
      const [fileChooser] = await Promise.all([
        prPage.waitForEvent('filechooser', { timeout: 5000 }),
        uploadButtonLocator.click({ force: true })
      ]);
      await fileChooser.setFiles(tempProofPath);
      fileSet = true;
    } catch (_) {
      // 3. Dernier recours : revérifier si un <input type="file"> vient d'apparaître après le clic
      const postClickInput = await prPage.$('input[type="file"]');
      if (postClickInput) {
        await postClickInput.setInputFiles(tempProofPath);
        fileSet = true;
      }
    }
  }

  if (!fileSet) {
    return { verified: false, reason: 'Bouton ou champ upload introuvable sur PR.SOCIAL' };
  }

  // 4. Attendre la confirmation "Capture d'écran envoyée" / "En vérification" / "Tâche suivante →"
  return await prPage.evaluate(async () => {
    const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, "'").trim();
    const minRightX = Math.floor((window.innerWidth || 1366) * 0.5);

    const start = Date.now();
    while (Date.now() - start < 8000) {
      const txt = norm(document.body?.innerText || '');
      const hasSent =
        txt.includes("capture d'ecran envoyee") ||
        txt.includes('nous verifions votre capture') ||
        txt.includes('en verification');
      const nextBtn = Array.from(document.querySelectorAll('button, a, div')).find((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= minRightX && norm(el.innerText || '').includes('tache suivante');
      });

      if (hasSent || nextBtn) {
        if (nextBtn) {
          await sleepInPage(80);
          nextBtn.click();
        }
        return { verified: true };
      }
      await sleepInPage(150);
    }
    return { verified: false, reason: 'Confirmation "Capture d’écran envoyée" non détectée sous 8s' };
  });
}

async function main() {
  console.log('================================================================');
  console.log('🚀 Démarrage du Bot Cloud PR.SOCIAL (Mono-Compte @samitodyignacegatien)');
  console.log('🎯 Mode : UNIQUEMENT Abonnements sur Instagram (Tous revenus)');
  console.log('🛡️ Bouclier Anti-Ban + Pause auto 50 tâches (20+ min) activés');
  console.log('================================================================');

  const startTime = Date.now();
  const state = loadBotState();
  const cookies = loadSessionCookies();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 820 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    locale: 'fr-FR'
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await context.addCookies(cookies);

  const prPage = await context.newPage();
  await prPage.goto('https://pr.social/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  while (true) {
    if ((Date.now() - startTime) / 60000 >= MAX_RUNTIME_MINUTES) {
      console.log('⏱️ Fin du relais Cloud. Sauvegarde de l’état.');
      break;
    }

    if (isEveningStopTimeReached()) {
      console.log('🌙 22h00 atteint : arrêt nocturne automatique anti-ban.');
      break;
    }

    const taskResult = await findAndStartNextInstagramSubscriptionTask(prPage, state.ignoredSignatures || []);

    if (taskResult?.platformPaused) {
      const waitSec = taskResult.waitSeconds || 21 * 60;
      console.log(`⏸️ ${taskResult.reason} -> Attente automatique de ${Math.ceil(waitSec / 60)} min...`);
      await sleep(waitSec * 1000);
      await prPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(2000);
      continue;
    }

    if (taskResult?.noTask || !taskResult?.igUrl) {
      console.log('🔍 Aucune nouvelle tâche visible. Scroll & attente 8s...');
      await prPage.mouse.wheel(0, 500);
      await sleep(8000);
      continue;
    }

    console.log(`▶️ Tâche sélectionnée : ${taskResult.title}`);

    const igPage = await context.newPage();
    let followSuccess = false;
    let screenshotBuffer = null;

    try {
      await igPage.goto(taskResult.igUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(randomBetween(1800, 3200));
      await moveMouseHumanLike(igPage, randomBetween(450, 780), randomBetween(220, 420));
      await igPage.mouse.wheel(0, randomBetween(110, 230));
      await sleep(randomBetween(700, 1200));
      await igPage.mouse.wheel(0, -randomBetween(90, 170));
      await sleep(randomBetween(1200, 2200));

      const igOutcome = await igPage.evaluate(async () => {
        const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
        const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const bodyTxt = norm(document.body?.innerText || '');

        if (bodyTxt.includes('try again later') || bodyTxt.includes('reessayez plus tard') || bodyTxt.includes('action bloquee')) {
          return { status: 'IG_RATE_LIMIT' };
        }
        if (bodyTxt.includes("sorry, this page isn't available") || bodyTxt.includes("cette page n'est pas disponible")) {
          return { status: 'NOT_FOUND' };
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
          return { status: 'ALREADY_FOLLOWING' };
        }
        if (!followBtn) return { status: 'NOT_FOUND' };

        followBtn.click();
        const start = Date.now();
        while (Date.now() - start < 6500) {
          await sleepInPage(300);
          const currentButtons = Array.from((document.querySelector('header') || document.body).querySelectorAll('button, [role="button"]'));
          const confirmed = currentButtons.find((b) => followingLabels.includes(norm(b.innerText || b.getAttribute('aria-label') || '')));
          if (confirmed) {
            window.scrollTo({ top: 0 });
            await sleepInPage(300);
            return { status: 'FOLLOWED' };
          }
        }
        return { status: 'ERROR' };
      });

      if (igOutcome.status === 'IG_RATE_LIMIT') {
        console.log('🛡️ BOUCLIER ANTI-BAN : Pause sécurité de 60 min.');
        await igPage.close();
        await sleep(60 * 60 * 1000);
        continue;
      }

      if (igOutcome.status === 'FOLLOWED' || igOutcome.status === 'ALREADY_FOLLOWING') {
        screenshotBuffer = await igPage.screenshot({ type: 'png', fullPage: false });
        followSuccess = true;
        console.log(`📸 Capture Instagram prête (${igOutcome.status}) pour @${taskResult.username}`);
      }
    } catch (err) {
      console.log(`⚠️ Erreur Instagram (@${taskResult.username}) : ${err.message}`);
    } finally {
      if (!igPage.isClosed()) await igPage.close();
    }

    if (!followSuccess || !screenshotBuffer) {
      console.log(`🔄 Profil indisponible -> annulation propre de @${taskResult.username}`);
      await cancelActiveTaskOnPrSocial(prPage);
      state.failedCount = (state.failedCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);
      await sleep(randomBetween(2500, 4500));
      continue;
    }

    console.log(`📤 Envoi de la capture sur PR.SOCIAL pour @${taskResult.username}...`);
    const tempProof = path.join(DATA_DIR, `proof_${Date.now()}.png`);
    fs.writeFileSync(tempProof, screenshotBuffer);

    let uploadOutcome = { verified: false };
    try {
      uploadOutcome = await uploadProofToPrSocial(prPage, tempProof);
    } finally {
      if (fs.existsSync(tempProof)) fs.unlinkSync(tempProof);
    }

    if (uploadOutcome.verified) {
      state.completedCount = (state.completedCount || 0) + 1;
      state.cycleCount = (state.cycleCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);

      console.log(`✅ Tâche #${state.completedCount} validée (@${taskResult.username}) | Cycle : ${state.cycleCount % 50}/50`);

      if (state.cycleCount > 0 && state.cycleCount % 50 === 0) {
        console.log('⏸️ 50 tâches réalisées ! Pause automatique de 21 minutes avant reprise autonome...');
        await sleep(21 * 60 * 1000);
        await prPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(2000);
        continue;
      }

      if (state.cycleCount > 0 && state.cycleCount % 12 === 0) {
        const breatherSec = randomBetween(25, 45);
        console.log(`☕ Micro-pause humaine anti-ban (${breatherSec}s)...`);
        await sleep(breatherSec * 1000);
      } else {
        await sleep(randomBetween(5000, 11000));
      }
    } else {
      console.log(`❌ Échec envoi capture (@${taskResult.username}) : ${uploadOutcome.reason}. Annulation et passage à la suivante.`);
      await cancelActiveTaskOnPrSocial(prPage);
      state.failedCount = (state.failedCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);
      await sleep(3000);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error('❌ Erreur fatale Bot Cloud :', err);
  process.exit(1);
});
