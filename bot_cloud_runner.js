/**
 * bot_cloud_runner.js — Robot Cloud PR.SOCIAL (Version SANS capture d'écran : bouton "Confirmer")
 * - Filtre strict Abonnements Instagram uniquement
 * - Vérifie que le suivi passe à "Suivi(e)" / "Following" / "Demandé" sur Instagram
 * - Attend et clique sur "Confirmer" / "Vérifier" / "Valider" sur PR.SOCIAL puis sur "Tâche suivante →"
 * - Pause automatique de 35 min (ou plus si PR.SOCIAL affiche > 35 min) puis reprise autonome
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

const MAX_RUNTIME_MINUTES = parseInt(process.env.MAX_RUNTIME_MINUTES || '310', 10);
const MIN_PAUSE_MINUTES = 35;

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
  const steps = randomBetween(12, 20);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * targetX);
    const y = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * ctrlY + t * t * targetY);
    await page.mouse.move(x, y);
    await sleep(randomBetween(6, 14));
  }
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

async function ensureOnInstagramTasksTab(prPage) {
  try {
    if (!prPage.url().includes('/tasks')) {
      const tasksBtn = prPage.locator('a, button').filter({ hasText: /^Tâches/i }).first();
      if (await tasksBtn.count()) {
        await tasksBtn.click({ force: true }).catch(() => {});
        await sleep(1800);
      } else {
        await prPage.goto('https://pr.social/tasks', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await sleep(2000);
      }
    }

    await prPage.evaluate(async () => {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const simulateClick = (el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      };

      const candidates = Array.from(document.querySelectorAll('button, a, div, li')).filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < 140 || r.left > 430 || r.height < 22 || r.height > 72) return false;
        const t = norm(el.innerText || '');
        return t.startsWith('instagram') && !t.includes('abonnement');
      });

      if (candidates.length > 0) {
        const igEl = candidates[0];
        const bg = window.getComputedStyle(igEl).backgroundColor || '';
        if (!bg.includes('255, 255, 255')) {
          simulateClick(igEl);
        }
      }
    });
    await sleep(900);
  } catch (_) {}
}

async function cancelActiveTaskOnPrSocial(prPage) {
  try {
    await prPage.evaluate(async () => {
      const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const simulateClick = (el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      };
      const minRightX = Math.floor((window.innerWidth || 1366) * 0.52);
      const findRight = (lbl) =>
        Array.from(document.querySelectorAll('button, a, div, span'))
          .filter((el) => el.getBoundingClientRect().left >= minRightX && (el.innerText || '').length < 40)
          .sort((a, b) => (a.innerText?.length || 99) - (b.innerText?.length || 99))
          .find((el) => norm(el.innerText || '').includes(lbl));

      const cancelBtn = findRight('annuler la tache');
      if (cancelBtn) {
        simulateClick(cancelBtn);
        await sleepInPage(500);
        const confirmBtn = findRight('oui, annuler') || findRight('oui annuler');
        if (confirmBtn) {
          simulateClick(confirmBtn);
          await sleepInPage(600);
        }
      }
    });
  } catch (_) {}
}

async function findAndStartNextInstagramSubscriptionTask(page, ignoredSignatures) {
  try {
    await ensureOnInstagramTasksTab(page);

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

        const simulateRealisticClick = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const clientX = Math.round(r.left + Math.max(2, r.width / 2));
          const clientY = Math.round(r.top + Math.max(2, r.height / 2));
          const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          el.dispatchEvent(new PointerEvent('pointerover', opts));
          el.dispatchEvent(new MouseEvent('mouseover', opts));
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          if (typeof el.focus === 'function') el.focus({ preventScroll: true });
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          return true;
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
          all.sort((a, b) => {
            const aBtn = ['BUTTON', 'A'].includes(a.tagName) ? 0 : 1;
            const bBtn = ['BUTTON', 'A'].includes(b.tagName) ? 0 : 1;
            if (aBtn !== bBtn) return aBtn - bBtn;
            return (a.innerText?.length || 99) - (b.innerText?.length || 99);
          });
          return all[0] || null;
        };

        const getRightPanelText = (minRightX) => {
          const panels = Array.from(document.querySelectorAll('div, aside, section')).filter((el) => {
            if (!isVis(el)) return false;
            const r = el.getBoundingClientRect();
            return r.left >= minRightX && r.width > 200 && r.height > 200;
          });
          panels.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
          return panels[0] ? panels[0].innerText || '' : '';
        };

        const detectPlatformPause = (panelRaw) => {
          const raw = panelRaw || document.body?.innerText || '';
          const txt = norm(raw);
          const pauseWords = [
            'pause', 'faites une pause', 'limite atteinte', 'trop de taches',
            'attendez', 'patienter', 'reessayez dans', 'revenez dans', 'disponible dans', 'take a break'
          ];
          if (!pauseWords.some((w) => txt.includes(w))) return null;

          const minMatch = txt.match(/(\d{1,3})\s*(?:minute|minutes|min|mn)\b/i);
          if (minMatch) {
            const mins = parseInt(minMatch[1], 10);
            if (mins >= 1 && mins <= 240) {
              return { isPaused: true, minutes: mins, reason: `Pause PR.SOCIAL (${mins} min)` };
            }
          }

          const timerMatch = raw.match(/\b([0-5]?\d):([0-5]\d)\b/);
          if (timerMatch) {
            const mins = Math.max(1, parseInt(timerMatch[1], 10) || 1);
            return { isPaused: true, minutes: mins, reason: `Minuteur PR.SOCIAL (${timerMatch[0]})` };
          }

          return { isPaused: true, minutes: 35, reason: 'Pause demandée par PR.SOCIAL' };
        };

        const ignoredSet = new Set((ignoredList || []).map((s) => norm(s)));
        const minRightX = Math.floor((window.innerWidth || 1366) * 0.55);

        const clickNextNonIgnoredMiddleRow = async () => {
          const midRows = Array.from(document.querySelectorAll('div, li, a, button')).filter((el) => {
            if (!isVis(el)) return false;
            const r = el.getBoundingClientRect();
            if (r.left < 220 || r.left > minRightX - 10 || r.height < 38 || r.height > 125 || r.width < 160) return false;
            const t = norm(el.innerText || '');
            const isStrictSub = t.includes('abonnement sur instagram') && t.includes('@');
            const isForbidden = forbiddenWords.some((fw) => t.includes(fw));
            return isStrictSub && !isForbidden;
          });

          for (const row of midRows) {
            const m = (row.innerText || '').match(/@([a-zA-Z0-9_.]{2,35})/);
            if (m) {
              const handle = m[1].replace(/\.$/, '').toLowerCase();
              const url = `https://www.instagram.com/${handle}/`;
              if (!ignoredSet.has(norm(url))) {
                simulateRealisticClick(row);
                await sleepInPage(600);
                return true;
              }
            }
          }
          return false;
        };

        for (let cycle = 0; cycle < 6; cycle++) {
          const rightPanelNow = getRightPanelText(minRightX);
          const pauseInfo = detectPlatformPause(rightPanelNow);
          if (pauseInfo) return { platformPaused: true, ...pauseInfo };

          const openOtherBtn = findBtn(["ouvrir l'autre tache"], minRightX);
          if (openOtherBtn) {
            simulateRealisticClick(openOtherBtn);
            await sleepInPage(550);
            const cancelBtn = findBtn(['annuler la tache'], minRightX);
            if (cancelBtn) {
              simulateRealisticClick(cancelBtn);
              await sleepInPage(450);
              const confirmCancelBtn = findBtn(['oui, annuler', 'oui annuler'], minRightX);
              if (confirmCancelBtn) {
                simulateRealisticClick(confirmCancelBtn);
                await sleepInPage(550);
              }
            }
            continue;
          }

          const confirmCancelImmediate = findBtn(['oui, annuler', 'oui annuler'], minRightX);
          if (confirmCancelImmediate) {
            simulateRealisticClick(confirmCancelImmediate);
            await sleepInPage(450);
            continue;
          }

          const nextBtn = findBtn(['tache suivante', 'next task'], minRightX);
          if (nextBtn) {
            simulateRealisticClick(nextBtn);
            await sleepInPage(550);
          }

          let rightRaw = getRightPanelText(minRightX);
          let rightNorm = norm(rightRaw);

          const workerMatchRight = rightRaw.match(/COMPTE\s+@([a-zA-Z0-9_.]{2,35})/i);
          const workerHandle = workerMatchRight ? workerMatchRight[1].toLowerCase() : 'samitodyignacegatien';
          const currentTargetMatch = rightRaw.match(/Abonnement sur Instagram[\s\S]{0,120}?@([a-zA-Z0-9_.]{2,35})/i);
          const currentHandle = currentTargetMatch ? currentTargetMatch[1].replace(/\.$/, '').toLowerCase() : null;
          const currentUrl = currentHandle ? `https://www.instagram.com/${currentHandle}/` : null;

          const isRightPanelForbidden = forbiddenWords.some(
            (w) => rightNorm.includes(`${w} sur instagram`) || rightNorm.includes(`type ${w}`)
          );
          const isRightPanelIgnored = Boolean(currentUrl && ignoredSet.has(norm(currentUrl)));
          const isRightPanelEmpty = !rightNorm.includes('abonnement sur instagram') || !currentHandle;

          if (isRightPanelEmpty || isRightPanelForbidden || isRightPanelIgnored) {
            const clicked = await clickNextNonIgnoredMiddleRow();
            if (!clicked) break;
            rightRaw = getRightPanelText(minRightX);
            rightNorm = norm(rightRaw);
          }

          const startBtn = findBtn(['commencer', 'start task'], minRightX, true);
          if (startBtn) {
            simulateRealisticClick(startBtn);
            await sleepInPage(1100);
          }

          const postStartRaw = getRightPanelText(minRightX);
          const afterStartPause = detectPlatformPause(postStartRaw);
          if (afterStartPause) return { platformPaused: true, ...afterStartPause };

          const postStartNorm = norm(postStartRaw);

          if (postStartNorm.includes('toutes les places sont prises') || postStartNorm.includes('tout les taches sont prises')) {
            const nextAfterTaken = findBtn(['tache suivante'], minRightX);
            if (nextAfterTaken) {
              simulateRealisticClick(nextAfterTaken);
              await sleepInPage(450);
            } else {
              await clickNextNonIgnoredMiddleRow();
            }
            continue;
          }

          if (postStartNorm.includes('vous avez une autre tache en cours')) {
            continue;
          }

          const isTaskStarted =
            postStartNorm.includes('en cours') ||
            postStartNorm.includes('annuler la tache') ||
            postStartNorm.includes('www.instagr') ||
            postStartNorm.includes('confirmer');

          const finalMatch = postStartRaw.match(/Abonnement sur Instagram[\s\S]{0,120}?@([a-zA-Z0-9_.]{2,35})/i);
          if (isTaskStarted && finalMatch && finalMatch[1]) {
            const targetUser = finalMatch[1].replace(/\.$/, '');
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

        const preview = getRightPanelText(minRightX).replace(/\s+/g, ' ').trim().slice(0, 160);
        return { noTask: true, preview };
      },
      { ignoredList: ignoredSignatures, forbiddenWords: FORBIDDEN_TASK_KEYWORDS }
    );
  } catch (err) {
    if (String(err.message || '').includes('Execution context was destroyed') || String(err.message || '').includes('navigation')) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(2500);
      return { retry: true };
    }
    throw err;
  }
}

async function clickStep1OpenProfileBox(context, prPage) {
  let popupOpened = null;
  const onNewPage = (p) => { popupOpened = p; };
  context.on('page', onNewPage);

  try {
    const coords = await prPage.evaluate(() => {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const minRightX = Math.floor((window.innerWidth || 1366) * 0.55);
      const els = Array.from(document.querySelectorAll('a, button, [role="button"], div, span')).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= minRightX && r.width > 15 && r.height > 15 && (el.innerText || '').length < 80;
      });
      const target =
        els.find((el) => norm(el.innerText || '').includes('www.instagr')) ||
        els.find((el) => norm(el.innerText || '').includes('ouvrez le profil et suivez-le'));
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });

    if (coords) {
      await prPage.mouse.click(coords.x, coords.y);
      await sleep(600);
    }
  } catch (_) {}

  context.off('page', onNewPage);
  if (popupOpened && !popupOpened.isClosed()) {
    await popupOpened.close().catch(() => {});
  }
}

async function confirmTaskWithoutScreenshotOnPrSocial(prPage) {
  await prPage.bringToFront().catch(() => {});
  await sleep(400);

  let confirmCoords = null;
  const waitStart = Date.now();
  while (Date.now() - waitStart < 3500) {
    confirmCoords = await prPage.evaluate(() => {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const minRightX = Math.floor((window.innerWidth || 1366) * 0.55);
      const keywords = ['confirmer', 'confirm', 'verifier', 'valider', 'terminer', 'verify'];
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div')).filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < minRightX || r.width < 40 || r.height < 22 || r.height > 85) return false;
        const t = norm(el.innerText || '');
        if (!t || t.length > 45 || t.includes('annuler') || t.includes('suivante')) return false;
        return keywords.some((kw) => t === kw || t.startsWith(kw + ' ') || t.includes(kw));
      });
      candidates.sort((a, b) => {
        const aBtn = ['BUTTON', 'A'].includes(a.tagName) ? 0 : 1;
        const bBtn = ['BUTTON', 'A'].includes(b.tagName) ? 0 : 1;
        if (aBtn !== bBtn) return aBtn - bBtn;
        return (a.innerText?.length || 99) - (b.innerText?.length || 99);
      });
      const best = candidates[0];
      if (!best) return null;
      best.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = best.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: (best.innerText || '').trim() };
    });

    if (confirmCoords) break;
    await sleep(250);
  }

  if (!confirmCoords) {
    const rightBtns = await prPage.evaluate(() => {
      const minRightX = Math.floor((window.innerWidth || 1366) * 0.55);
      return Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter((el) => el.getBoundingClientRect().left >= minRightX)
        .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 8);
    });
    console.log(`📋 Boutons visibles à droite : ${JSON.stringify(rightBtns)}`);
    return { verified: false, reason: 'Bouton « Confirmer » introuvable dans le panneau droit' };
  }

  await prPage.mouse.click(confirmCoords.x, confirmCoords.y);

  return await prPage.evaluate(async () => {
    const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const minRightX = Math.floor((window.innerWidth || 1366) * 0.55);

    const simulateRealisticClick = (el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    };

    const start = Date.now();
    while (Date.now() - start < 8000) {
      const txt = norm(document.body?.innerText || '');
      const hasStatus =
        txt.includes('en verification') ||
        txt.includes('verifiee automatiquement') ||
        txt.includes('soumise');
      const nextBtn = Array.from(document.querySelectorAll('button, a, div')).find((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= minRightX && (el.innerText || '').length < 40 && norm(el.innerText || '').includes('tache suivante');
      });

      if (hasStatus || nextBtn) {
        if (nextBtn) {
          await sleepInPage(80);
          simulateRealisticClick(nextBtn);
        }
        return { verified: true };
      }
      await sleepInPage(150);
    }

    return { verified: false, reason: 'Pas de confirmation après le clic sur « Confirmer »' };
  });
}

async function main() {
  console.log('================================================================');
  console.log('🚀 Bot Cloud PR.SOCIAL (Mode Rapide « Confirmer » SANS capture)');
  console.log('🎯 Compte @samitodyignacegatien (public) | Abonnements IG uniquement');
  console.log('⏸️ Pause auto 35 min minimum dès que PR.SOCIAL le demande');
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
  await prPage.goto('https://pr.social/tasks', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  let emptyRetries = 0;

  while (true) {
    if ((Date.now() - startTime) / 60000 >= MAX_RUNTIME_MINUTES) {
      console.log('⏱️ Fin du relais de 5h10. Sauvegarde de l’état pour le relais suivant.');
      break;
    }

    const taskResult = await findAndStartNextInstagramSubscriptionTask(prPage, state.ignoredSignatures || []);

    if (taskResult?.retry) continue;

    if (taskResult?.platformPaused) {
      const waitMins = Math.max(MIN_PAUSE_MINUTES, taskResult.minutes || MIN_PAUSE_MINUTES);
      console.log(`⏸️ ${taskResult.reason} -> Pause automatique de ${waitMins} minutes en cours. Reprise automatique ensuite !`);
      await sleep(waitMins * 60 * 1000);
      console.log(`⚡ Fin des ${waitMins} minutes de pause ! Reprise automatique des tâches...`);
      await prPage.goto('https://pr.social/tasks', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await sleep(3000);
      continue;
    }

    if (taskResult?.noTask || !taskResult?.igUrl) {
      emptyRetries += 1;
      console.log(`🔍 Aucune tâche visible (${emptyRetries}/6)`);
      if (emptyRetries === 3) {
        console.log('🔄 Rechargement complet de la page PR.SOCIAL...');
        await prPage.reload({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
        await sleep(3000);
      } else if (emptyRetries >= 6) {
        console.log('⏳ Liste vide : attente 5 minutes puis nouvelle vérification automatique...');
        emptyRetries = 0;
        await sleep(5 * 60 * 1000);
        await prPage.reload({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
        await sleep(3000);
      } else {
        await prPage.mouse.move(600, 450);
        await prPage.mouse.wheel(0, 500);
        await sleep(3500);
      }
      continue;
    }

    emptyRetries = 0;
    console.log(`▶️ Tâche sélectionnée : ${taskResult.title}`);

    await clickStep1OpenProfileBox(context, prPage);

    const igPage = await context.newPage();
    let followConfirmed = false;

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
          return { status: 'ALREADY_FOLLOWING' };
        }
        if (!followBtn) return { status: 'NOT_FOUND' };

        followBtn.click();
        const start = Date.now();
        while (Date.now() - start < 7000) {
          await sleepInPage(300);
          const currentButtons = Array.from((document.querySelector('header') || document.body).querySelectorAll('button, [role="button"]'));
          const confirmed = currentButtons.find((b) => followingLabels.includes(norm(b.innerText || b.getAttribute('aria-label') || '')));
          if (confirmed) {
            return { status: 'FOLLOWED' };
          }
        }
        return { status: 'ERROR' };
      });

      if (igOutcome.status === 'IG_RATE_LIMIT') {
        console.log('🛡️ BOUCLIER ANTI-BAN : Instagram demande de ralentir -> Pause de 35 minutes puis reprise...');
        await igPage.close();
        await sleep(35 * 60 * 1000);
        continue;
      }

      if (igOutcome.status === 'FOLLOWED' || igOutcome.status === 'ALREADY_FOLLOWING') {
        followConfirmed = true;
      }
    } catch (err) {
      console.log(`⚠️ Erreur Instagram (@${taskResult.username}) : ${err.message}`);
    } finally {
      if (!igPage.isClosed()) await igPage.close();
    }

    if (!followConfirmed) {
      console.log(`🔄 Suivi non confirmé pour @${taskResult.username} -> annulation propre.`);
      await cancelActiveTaskOnPrSocial(prPage);
      state.failedCount = (state.failedCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);
      await sleep(randomBetween(2000, 3500));
      continue;
    }

    const confirmOutcome = await confirmTaskWithoutScreenshotOnPrSocial(prPage);

    if (confirmOutcome.verified) {
      state.completedCount = (state.completedCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);

      console.log(`✅ Tâche #${state.completedCount} confirmée sans capture (@${taskResult.username})`);

      if (state.completedCount > 0 && state.completedCount % 12 === 0) {
        const breatherSec = randomBetween(20, 35);
        console.log(`☕ Micro-pause humaine anti-ban (${breatherSec}s)...`);
        await sleep(breatherSec * 1000);
      } else {
        await sleep(randomBetween(4000, 8000));
      }
    } else {
      console.log(`❌ Échec confirmation (@${taskResult.username}) : ${confirmOutcome.reason}. Annulation et passage à la suivante.`);
      await cancelActiveTaskOnPrSocial(prPage);
      state.failedCount = (state.failedCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);
      await sleep(2500);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error('❌ Erreur fatale Bot Cloud :', err);
  process.exit(1);
});