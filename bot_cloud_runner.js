/**
 * bot_cloud_runner.js — Robot Cloud 24h/24 Eco-Quota (Sans sommeil nocturne)
 * S'éteint immédiatement après 50 tâches ou sur pause PR.SOCIAL pour économiser le quota GitHub,
 * puis le cron GitHub le rallume automatiquement une fois la pause terminée.
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

const MAX_RUNTIME_MINUTES = parseInt(process.env.MAX_RUNTIME_MINUTES || '40', 10);

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

        const detectForcedPause = () => {
          const raw = document.body?.innerText || '';
          const txt = norm(raw);
          const pauseWords = ['pause', 'limite atteinte', 'trop de taches', 'attendez', 'patienter', 'reessayez dans'];
          if (!pauseWords.some((w) => txt.includes(w))) return null;

          const minMatch = txt.match(/(\d{1,3})\s*(?:minute|minutes|min|mn)\b/i);
          if (minMatch) {
            const mins = parseInt(minMatch[1], 10);
            if (mins >= 1 && mins <= 240) {
              return { isPaused: true, reason: `Pause PR.SOCIAL détectée (${mins} min)` };
            }
          }
          return null;
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
          const pauseInfo = detectForcedPause();
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

          const afterStartPause = detectForcedPause();
          if (afterStartPause) return { platformPaused: true, ...afterStartPause };

          const postStartRaw = getRightPanelText(minRightX);
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
            postStartNorm.includes('www.instagr');

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
      await sleep(700);
    }
  } catch (_) {}

  context.off('page', onNewPage);
  if (popupOpened && !popupOpened.isClosed()) {
    await popupOpened.close().catch(() => {});
  }
}

async function uploadProofToPrSocial(prPage, screenshotBuffer, tempProofPath) {
  await prPage.bringToFront().catch(() => {});
  await sleep(400);

  let fileUploadedViaChooser = false;

  const directInputs = await prPage.$$('input[type="file"]');
  if (directInputs.length > 0) {
    for (const inp of directInputs) {
      await inp.setInputFiles(tempProofPath).catch(() => {});
    }
    fileUploadedViaChooser = true;
  }

  const uploadBtnCoords = await prPage.evaluate(() => {
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, "'").trim();
    const minRightX = Math.floor((window.innerWidth || 1366) * 0.55);
    const candidates = Array.from(document.querySelectorAll('button, label, [role="button"], div, span')).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < minRightX || r.width < 30 || r.height < 20) return false;
      const t = norm(el.innerText || '');
      return (t.includes("ajouter une capture d'ecran") || t.includes("ajoutez une capture d'ecran")) && t.length < 60;
    });
    candidates.sort((a, b) => {
      const aBtn = ['BUTTON', 'LABEL'].includes(a.tagName) ? 0 : 1;
      const bBtn = ['BUTTON', 'LABEL'].includes(b.tagName) ? 0 : 1;
      if (aBtn !== bBtn) return aBtn - bBtn;
      return (a.innerText?.length || 99) - (b.innerText?.length || 99);
    });
    const best = candidates[0];
    if (!best) return null;
    const r = best.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });

  if (uploadBtnCoords && !fileUploadedViaChooser) {
    try {
      const [fileChooser] = await Promise.all([
        prPage.waitForEvent('filechooser', { timeout: 4000 }),
        prPage.mouse.click(uploadBtnCoords.x, uploadBtnCoords.y)
      ]);
      await fileChooser.setFiles(tempProofPath);
      fileUploadedViaChooser = true;
    } catch (_) {
      const newInputs = await prPage.$$('input[type="file"]');
      if (newInputs.length > 0) {
        for (const inp of newInputs) {
          await inp.setInputFiles(tempProofPath).catch(() => {});
        }
        fileUploadedViaChooser = true;
      }
    }
  }

  const base64DataUrl = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
  await prPage.evaluate(async (dataUrl) => {
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, "'").trim();
    const minRightX = Math.floor((window.innerWidth || 1366) * 0.52);

    const parts = dataUrl.split(',');
    const bstr = atob(parts[1]);
    const u8 = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
    const file = new File([new Blob([u8], { type: 'image/png' })], `capture_ig_${Date.now()}.png`, {
      type: 'image/png',
      lastModified: Date.now()
    });

    const dt = new DataTransfer();
    dt.items.add(file);

    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    for (const inp of inputs) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
      if (setter) setter.call(inp, dt.files);
      else inp.files = dt.files;
      inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    const zones = Array.from(document.querySelectorAll('button, label, div')).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < minRightX || r.width < 30 || r.height < 20) return false;
      const t = norm(el.innerText || '');
      return t.includes("capture d'ecran") && t.length < 120;
    });

    for (const z of zones) {
      const r = z.getBoundingClientRect();
      for (const type of ['dragenter', 'dragover', 'drop']) {
        z.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: Math.round(r.left + r.width / 2),
            clientY: Math.round(r.top + r.height / 2),
            dataTransfer: dt
          })
        );
      }
    }
  }, base64DataUrl);

  const verifyResult = await prPage.evaluate(async () => {
    const sleepInPage = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, "'").trim();
    const minRightX = Math.floor((window.innerWidth || 1366) * 0.52);

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
    while (Date.now() - start < 9000) {
      const submitBtn = Array.from(document.querySelectorAll('button, a, [role="button"]')).find((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < minRightX || r.width < 20) return false;
        const t = norm(el.innerText || '');
        return ['envoyer', 'valider', 'soumettre', 'confirmer', 'verifier'].some((w) => t === w || t.startsWith(w));
      });
      if (submitBtn) simulateRealisticClick(submitBtn);

      const txt = norm(document.body?.innerText || '');
      const hasSent =
        txt.includes("capture d'ecran envoyee") ||
        txt.includes('nous verifions votre capture') ||
        txt.includes('en verification');
      const nextBtn = Array.from(document.querySelectorAll('button, a, div')).find((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= minRightX && (el.innerText || '').length < 40 && norm(el.innerText || '').includes('tache suivante');
      });

      if (hasSent || nextBtn) {
        if (nextBtn) {
          await sleepInPage(80);
          simulateRealisticClick(nextBtn);
        }
        return { verified: true };
      }
      await sleepInPage(200);
    }

    return { verified: false };
  });

  return {
    verified: verifyResult.verified,
    reason: verifyResult.verified ? 'OK' : 'Confirmation non détectée'
  };
}

async function main() {
  console.log('================================================================');
  console.log('🚀 Bot Cloud PR.SOCIAL 24h/24 (Mode Éco-Quota sans sommeil)');
  console.log('🎯 Compte @samitodyignacegatien | Abonnements IG uniquement');
  console.log('⏸️ Arrêt automatique dès la pause de 50 tâches (reprise par cron)');
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
      console.log('⏱️ Fin de session (40 min). Arrêt propre pour économiser le quota.');
      break;
    }

    const taskResult = await findAndStartNextInstagramSubscriptionTask(prPage, state.ignoredSignatures || []);

    if (taskResult?.retry) continue;

    // ÉCONOMIE DE QUOTA : Si PR.SOCIAL impose la pause, on éteint immédiatement le bot !
    if (taskResult?.platformPaused) {
      console.log(`⏸️ ${taskResult.reason} -> Extinction immédiate pour économiser le quota GitHub. Le cron rallumera le bot automatiquement !`);
      break;
    }

    if (taskResult?.noTask || !taskResult?.igUrl) {
      emptyRetries += 1;
      console.log(`🔍 Aucune tâche (${emptyRetries}/3)`);
      await prPage.mouse.wheel(0, 500);
      await sleep(4000);
      if (emptyRetries >= 3) {
        console.log('🛑 Liste vide après 3 essais -> Extinction pour économiser le quota jusqu’au prochain réveil.');
        break;
      }
      continue;
    }

    emptyRetries = 0;
    console.log(`▶️ Tâche sélectionnée : ${taskResult.title}`);

    await clickStep1OpenProfileBox(context, prPage);

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
        console.log('🛡️ BOUCLIER ANTI-BAN : Instagram demande de ralentir -> Extinction immédiate jusqu’au prochain réveil.');
        await igPage.close();
        break;
      }

      if (igOutcome.status === 'FOLLOWED' || igOutcome.status === 'ALREADY_FOLLOWING') {
        screenshotBuffer = await igPage.screenshot({ type: 'png', fullPage: false });
        followSuccess = true;
      }
    } catch (err) {
      console.log(`⚠️ Erreur Instagram (@${taskResult.username}) : ${err.message}`);
    } finally {
      if (!igPage.isClosed()) await igPage.close();
    }

    if (!followSuccess || !screenshotBuffer) {
      await cancelActiveTaskOnPrSocial(prPage);
      state.failedCount = (state.failedCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);
      await sleep(randomBetween(2000, 3500));
      continue;
    }

    const tempProof = path.join(DATA_DIR, `proof_${Date.now()}.png`);
    fs.writeFileSync(tempProof, screenshotBuffer);

    let uploadOutcome = { verified: false };
    try {
      uploadOutcome = await uploadProofToPrSocial(prPage, screenshotBuffer, tempProof);
    } finally {
      if (fs.existsSync(tempProof)) fs.unlinkSync(tempProof);
    }

    if (uploadOutcome.verified) {
      state.completedCount = (state.completedCount || 0) + 1;
      state.cycleCount = (state.cycleCount || 0) + 1;
      state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
      saveBotState(state);

      console.log(`✅ Tâche #${state.completedCount} validée (@${taskResult.username}) | Cycle : ${state.cycleCount % 50}/50`);

      // ÉCONOMIE DE QUOTA : À 50 tâches, on s'éteint tout de suite au lieu de dormir 21 min sur GitHub !
      if (state.cycleCount > 0 && state.cycleCount % 50 === 0) {
        console.log('⏸️ 50 tâches réalisées ! Extinction du bot pendant la pause PR.SOCIAL (le cron le rallumera tout seul).');
        break;
      }

      if (state.cycleCount > 0 && state.cycleCount % 12 === 0) {
        const breatherSec = randomBetween(22, 38);
        console.log(`☕ Micro-pause humaine anti-ban (${breatherSec}s)...`);
        await sleep(breatherSec * 1000);
      } else {
        await sleep(randomBetween(4000, 9000));
      }
    } else {
      console.log(`❌ Échec envoi (@${taskResult.username}). Annulation et passage à la suivante.`);
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
