/**
 * bot_cloud_runner.js — Robot Cloud PR.SOCIAL (Version Ultra-Stable SANS capture)
 * - Normalise automatiquement les cookies (même format brut Cookie-Editor)
 * - Filtre strict : Abonnements Instagram uniquement (aucun like/commentaire/signalement)
 * - Anti-ban : mouvements humains, suivi vérifié, micro-pauses, pause auto 35 min+ si demandé
 * - Résilient : aucune erreur réseau/DOM/navigation ne plante le script
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'bot_state.json');
const COOKIES_FILE = path.join(DATA_DIR, 'session_cookies.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MAX_RUNTIME_MINUTES = parseInt(process.env.MAX_RUNTIME_MINUTES || '310', 10);
const MIN_PAUSE_MINUTES = 35;

const FORBIDDEN_KEYWORDS = [
  'commentaire', 'commenter', 'comment', 'signaler', 'signalement',
  'report', 'bannir', 'bloquer', 'like', "j'aime", 'partager',
  'story', 'vue', 'twitter', 'linkedin', 'tiktok', 'youtube', 'facebook', 'surf'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (Math.max(min, max) - Math.min(min, max) + 1)) + Math.min(min, max);

async function moveMouseHumanLike(page, targetX, targetY) {
  const sx = rand(180, 950), sy = rand(140, 620);
  const cx = (sx + targetX) / 2 + rand(-90, 90);
  const cy = (sy + targetY) / 2 + rand(-70, 70);
  const steps = rand(10, 16);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round((1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * targetX);
    const y = Math.round((1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * targetY);
    await page.mouse.move(x, y).catch(() => {});
    await sleep(rand(6, 12));
  }
}

function loadBotState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {}
  return { completedCount: 0, failedCount: 0, ignoredSignatures: [], lastUpdated: Date.now() };
}

function saveBotState(state) {
  try {
    state.lastUpdated = Date.now();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

function normalizeCookies(rawCookies) {
  return rawCookies.map((c) => {
    const cookie = {
      name: String(c.name || ''),
      value: String(c.value || ''),
      domain: c.domain,
      path: c.path || '/',
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure)
    };
    const ss = String(c.sameSite || '').toLowerCase();
    if (ss === 'strict') cookie.sameSite = 'Strict';
    else if (ss === 'lax') cookie.sameSite = 'Lax';
    else cookie.sameSite = 'None';
    if (cookie.sameSite === 'None') cookie.secure = true;
    const exp = c.expires ?? c.expirationDate;
    if (typeof exp === 'number' && exp > 0) cookie.expires = Math.floor(exp);
    return cookie;
  }).filter((c) => c.name && c.domain);
}

function loadSessionCookies() {
  let raw = null;
  if (process.env.SESSION_COOKIES_JSON && process.env.SESSION_COOKIES_JSON.trim().startsWith('[')) {
    raw = JSON.parse(process.env.SESSION_COOKIES_JSON);
  } else if (fs.existsSync(COOKIES_FILE)) {
    raw = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  } else {
    throw new Error('Aucun cookie trouvé. Ajoutez le secret GitHub SESSION_COOKIES_JSON.');
  }
  return normalizeCookies(raw);
}

async function ensureOnInstagramTasksTab(prPage) {
  try {
    if (!prPage.url().includes('/tasks')) {
      const btn = prPage.locator('a, button').filter({ hasText: /^Tâches/i }).first();
      if (await btn.count()) {
        await btn.click({ force: true }).catch(() => {});
        await sleep(1500);
      } else {
        await prPage.goto('https://pr.social/tasks', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await sleep(2000);
      }
    }
    await prPage.evaluate(() => {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const el = Array.from(document.querySelectorAll('button, a, div, li')).find((e) => {
        const r = e.getBoundingClientRect();
        const t = norm(e.innerText || '');
        return r.left >= 140 && r.left <= 430 && r.height >= 22 && r.height <= 72 && t.startsWith('instagram') && !t.includes('abonnement');
      });
      if (el && !(window.getComputedStyle(el).backgroundColor || '').includes('255, 255, 255')) el.click();
    });
    await sleep(800);
  } catch (_) {}
}

async function cancelActiveTaskOnPrSocial(prPage) {
  try {
    await prPage.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const minX = Math.floor((window.innerWidth || 1366) * 0.48);
      const findRight = (lbl) => Array.from(document.querySelectorAll('button, a, div, span'))
        .filter((e) => e.getBoundingClientRect().left >= minX && (e.innerText || '').length < 40)
        .sort((a, b) => (a.innerText?.length || 99) - (b.innerText?.length || 99))
        .find((e) => norm(e.innerText || '').includes(lbl));
      const cancelBtn = findRight('annuler la tache');
      if (cancelBtn) {
        cancelBtn.click();
        await wait(500);
        const yesBtn = findRight('oui, annuler') || findRight('oui annuler');
        if (yesBtn) { yesBtn.click(); await wait(500); }
      }
    });
  } catch (_) {}
}

async function findAndStartNextTask(page, ignoredSignatures) {
  try {
    await ensureOnInstagramTasksTab(page);
    const workerUsername = (process.env.IG_WORKER_USERNAME || "").toLowerCase();
    return await page.evaluate(async ({ ignoredList, forbiddenWords, workerUsername }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`]/g, "'").replace(/\s+/g, ' ').trim();
      const isVis = (el) => {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) !== 0 && r.width > 4 && r.height > 4;
      };
      const clickEl = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2), button: 0, buttons: 1 };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((ev) =>
          el.dispatchEvent(ev.startsWith('pointer') ? new PointerEvent(ev, o) : new MouseEvent(ev, o))
        );
        return true;
      };
      const findBtn = (labels, minLeft = 0, exact = false) => {
        const targets = labels.map(norm);
        const all = Array.from(document.querySelectorAll('button, a, label, [role="button"], div, span')).filter((el) => {
          if (!isVis(el) || el.getBoundingClientRect().left < minLeft) return false;
          const txt = norm(`${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`);
          if (!txt || txt.length > 90) return false;
          return exact ? targets.some((t) => txt === t || txt.startsWith(t)) : targets.some((t) => txt.includes(t));
        });
        all.sort((a, b) => ((['BUTTON', 'A'].includes(a.tagName) ? 0 : 1) - (['BUTTON', 'A'].includes(b.tagName) ? 0 : 1)) || ((a.innerText?.length || 99) - (b.innerText?.length || 99)));
        return all[0] || null;
      };
      const getRightText = (minX) => {
        const panels = Array.from(document.querySelectorAll('div, aside, section')).filter((el) => isVis(el) && el.getBoundingClientRect().left >= minX && el.getBoundingClientRect().width > 200 && el.getBoundingClientRect().height > 200);
        panels.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
        return panels[0] ? panels[0].innerText || '' : '';
      };
      const detectPause = (raw) => {
        const txt = norm(raw || document.body?.innerText || '');
        const words = ['pause', 'faites une pause', 'limite atteinte', 'trop de taches', 'attendez', 'patienter', 'reessayez dans', 'revenez dans', 'disponible dans', 'take a break'];
        if (!words.some((w) => txt.includes(w))) return null;
        const m = txt.match(/(\d{1,3})\s*(?:minute|minutes|min|mn)\b/i);
        if (m && +m[1] >= 1 && +m[1] <= 240) return { isPaused: true, minutes: +m[1], reason: `Pause PR.SOCIAL (${m[1]} min)` };
        const t = (raw || '').match(/\b([0-5]?\d):([0-5]\d)\b/);
        if (t) return { isPaused: true, minutes: Math.max(1, +t[1] || 1), reason: `Minuteur PR.SOCIAL (${t[0]})` };
        return { isPaused: true, minutes: 35, reason: 'Pause demandée par PR.SOCIAL' };
      };

      const ignoredSet = new Set((ignoredList || []).map(norm));
      const minX = Math.floor((window.innerWidth || 1366) * 0.52);

      const clickMiddleRow = async () => {
        const rows = Array.from(document.querySelectorAll('div, li, a, button')).filter((el) => {
          if (!isVis(el)) return false;
          const r = el.getBoundingClientRect();
          if (r.left < 220 || r.left > minX - 10 || r.height < 38 || r.height > 125 || r.width < 160) return false;
          const t = norm(el.innerText || '');
          return t.includes('abonnement sur instagram') && t.includes('@') && !forbiddenWords.some((fw) => t.includes(fw));
        });
        for (const row of rows) {
          const m = (row.innerText || '').match(/@([a-zA-Z0-9_.]{2,35})/);
          if (m) {
            const url = `https://www.instagram.com/${m[1].replace(/\.$/, '').toLowerCase()}/`;
            if (!ignoredSet.has(norm(url))) { clickEl(row); await wait(550); return true; }
          }
        }
        return false;
      };

      for (let cycle = 0; cycle < 6; cycle++) {
        const pNow = detectPause(getRightText(minX));
        if (pNow) return { platformPaused: true, ...pNow };

        const openOther = findBtn(["ouvrir l'autre tache"], minX);
        if (openOther) {
          clickEl(openOther); await wait(500);
          const cb = findBtn(['annuler la tache'], minX);
          if (cb) {
            clickEl(cb); await wait(400);
            const yes = findBtn(['oui, annuler', 'oui annuler'], minX);
            if (yes) { clickEl(yes); await wait(500); }
          }
          continue;
        }

        const yesNow = findBtn(['oui, annuler', 'oui annuler'], minX);
        if (yesNow) { clickEl(yesNow); await wait(400); continue; }

        const nextBtn = findBtn(['tache suivante', 'next task'], minX);
        if (nextBtn) { clickEl(nextBtn); await wait(500); }

        let rightRaw = getRightText(minX), rightNorm = norm(rightRaw);
        const workerMatch = rightRaw.match(/COMPTE\s+@([a-zA-Z0-9_.]{2,35})/i);
        const workerHandle = workerMatch ? workerMatch[1].toLowerCase() : (workerUsername || "");
        const curMatch = rightRaw.match(/Abonnement sur Instagram[\s\S]{0,120}?@([a-zA-Z0-9_.]{2,35})/i);
        const curHandle = curMatch ? curMatch[1].replace(/\.$/, '').toLowerCase() : null;
        const curUrl = curHandle ? `https://www.instagram.com/${curHandle}/` : null;

        const badRight = !rightNorm.includes('abonnement sur instagram') || !curHandle ||
          forbiddenWords.some((w) => rightNorm.includes(`${w} sur instagram`) || rightNorm.includes(`type ${w}`)) ||
          Boolean(curUrl && ignoredSet.has(norm(curUrl)));

        if (badRight) {
          if (!(await clickMiddleRow())) break;
          rightRaw = getRightText(minX);
          rightNorm = norm(rightRaw);
        }

        const startBtn = findBtn(['commencer', 'start task'], minX, true);
        if (startBtn) { clickEl(startBtn); await wait(1000); }

        const postRaw = getRightText(minX);
        const pAfter = detectPause(postRaw);
        if (pAfter) return { platformPaused: true, ...pAfter };

        const postNorm = norm(postRaw);
        if (postNorm.includes('toutes les places sont prises') || postNorm.includes('tout les taches sont prises')) {
          const nb = findBtn(['tache suivante'], minX);
          if (nb) { clickEl(nb); await wait(450); } else await clickMiddleRow();
          continue;
        }
        if (postNorm.includes('vous avez une autre tache en cours')) continue;

        const started = postNorm.includes('en cours') || postNorm.includes('annuler la tache') || postNorm.includes('www.instagr') || postNorm.includes('confirmer');
        const finalMatch = postRaw.match(/Abonnement sur Instagram[\s\S]{0,120}?@([a-zA-Z0-9_.]{2,35})/i);
        if (started && finalMatch && finalMatch[1]) {
          const user = finalMatch[1].replace(/\.$/, '');
          if (user.toLowerCase() !== workerHandle) {
            const igUrl = `https://www.instagram.com/${user}/`;
            if (!ignoredSet.has(norm(igUrl))) {
              return { igUrl, username: user, signature: igUrl.toLowerCase(), title: `Abonnement sur Instagram (@${user})` };
            }
          }
        }
      }
      return { noTask: true };
    }, { ignoredList: ignoredSignatures, forbiddenWords: FORBIDDEN_KEYWORDS, workerUsername });
  } catch (err) {
    if (/Execution context|navigation|Target closed/i.test(String(err.message))) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(2000);
      return { retry: true };
    }
    throw err;
  }
}

async function openProfileStep(context, prPage) {
  let popup = null;
  const onPage = (p) => { popup = p; };
  context.on('page', onPage);
  try {
    const coords = await prPage.evaluate(() => {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const minX = Math.floor((window.innerWidth || 1366) * 0.48);
      const els = Array.from(document.querySelectorAll('a, button, [role="button"], div, span')).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left >= minX && r.width > 15 && r.height > 15 && (e.innerText || '').length < 80;
      });
      const target = els.find((e) => norm(e.innerText || '').includes('www.instagr')) || els.find((e) => norm(e.innerText || '').includes('ouvrez le profil'));
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (coords) { await prPage.mouse.click(coords.x, coords.y); await sleep(500); }
  } catch (_) {}
  context.off('page', onPage);
  if (popup && !popup.isClosed()) await popup.close().catch(() => {});
}

async function confirmWithoutScreenshot(prPage) {
  await prPage.bringToFront().catch(() => {});
  await sleep(400);

  let coords = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    coords = await prPage.evaluate(() => {
      const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const minX = Math.floor((window.innerWidth || 1366) * 0.48);
      const kw = ['confirmer', 'confirm', 'verifier', 'valider', 'terminer', 'soumettre', 'verify', 'submit', "j'ai suivi"];
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span')).filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < minX || r.width < 36 || r.height < 20 || r.height > 90) return false;
        const t = norm(el.innerText || el.getAttribute('aria-label') || '');
        if (!t || t.length > 50 || t.includes('annuler') || t.includes('suivante') || t.includes('signaler')) return false;
        return kw.some((k) => t === k || t.startsWith(k + ' ') || t.includes(k));
      });
      candidates.sort((a, b) => ((['BUTTON', 'A'].includes(a.tagName) ? 0 : 1) - (['BUTTON', 'A'].includes(b.tagName) ? 0 : 1)) || ((a.innerText?.length || 99) - (b.innerText?.length || 99)));
      const best = candidates[0];
      if (!best) return null;
      best.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = best.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }).catch(() => null);
    if (coords) break;
    await sleep(250);
  }

  if (!coords) {
    const btns = await prPage.evaluate(() => {
      const minX = Math.floor((window.innerWidth || 1366) * 0.48);
      return Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter((e) => e.getBoundingClientRect().left >= minX)
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
    }).catch(() => []);
    console.log(`📋 Boutons visibles à droite : ${JSON.stringify(btns)}`);
    return { verified: false, reason: 'Bouton « Confirmer » introuvable dans le panneau droit' };
  }

  await prPage.mouse.click(coords.x, coords.y).catch(() => {});

  return await prPage.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const minX = Math.floor((window.innerWidth || 1366) * 0.48);
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const txt = norm(document.body?.innerText || '');
      const ok = txt.includes('en verification') || txt.includes('verifiee automatiquement') || txt.includes('soumise');
      const nextBtn = Array.from(document.querySelectorAll('button, a, div')).find((e) => e.getBoundingClientRect().left >= minX && (e.innerText || '').length < 40 && norm(e.innerText || '').includes('tache suivante'));
      if (ok || nextBtn) {
        if (nextBtn) { await wait(100); nextBtn.click(); }
        return { verified: true };
      }
      await wait(150);
    }
    return { verified: false, reason: 'Pas de confirmation après le clic sur « Confirmer »' };
  }).catch(() => ({ verified: false, reason: 'Erreur DOM après clic Confirmer' }));
}

async function main() {
  console.log('================================================================');
  console.log('🚀 Bot Cloud PR.SOCIAL (Mode Ultra-Stable SANS capture)');
  console.log('🎯 Compte IG configuré (public) | Abonnements IG uniquement');
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

  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await context.addCookies(cookies);

  let prPage = await context.newPage();
  await prPage.goto('https://pr.social/tasks', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3000);

  if (prPage.url().includes('/login') || prPage.url().includes('/auth')) {
    throw new Error('🔑 Session PR.SOCIAL expirée ! Mets à jour le secret GitHub SESSION_COOKIES_JSON.');
  }

  let emptyRetries = 0;

  while (true) {
    if ((Date.now() - startTime) / 60000 >= MAX_RUNTIME_MINUTES) {
      console.log('⏱️ Fin du relais de 5h10. Sauvegarde de l’état pour le relais suivant.');
      break;
    }

    try {
      if (prPage.isClosed()) {
        prPage = await context.newPage();
        await prPage.goto('https://pr.social/tasks', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await sleep(2500);
      }

      const taskResult = await findAndStartNextTask(prPage, state.ignoredSignatures || []);
      if (taskResult?.retry) continue;

      if (taskResult?.platformPaused) {
        const waitMins = Math.max(MIN_PAUSE_MINUTES, taskResult.minutes || MIN_PAUSE_MINUTES);
        console.log(`⏸️ ${taskResult.reason} -> Pause auto de ${waitMins} min. Reprise automatique ensuite !`);
        await sleep(waitMins * 60 * 1000);
        console.log(`⚡ Fin des ${waitMins} min de pause ! Reprise automatique...`);
        await prPage.goto('https://pr.social/tasks', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await sleep(3000);
        continue;
      }

      if (taskResult?.noTask || !taskResult?.igUrl) {
        emptyRetries += 1;
        console.log(`🔍 Aucune tâche visible (${emptyRetries}/6)`);
        if (emptyRetries === 3) {
          await prPage.reload({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
          await sleep(3000);
        } else if (emptyRetries >= 6) {
          console.log('⏳ Liste vide : attente 5 min puis nouvelle vérification...');
          emptyRetries = 0;
          await sleep(5 * 60 * 1000);
          await prPage.reload({ waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
          await sleep(3000);
        } else {
          await prPage.mouse.move(600, 450).catch(() => {});
          await prPage.mouse.wheel(0, 500).catch(() => {});
          await sleep(3500);
        }
        continue;
      }

      emptyRetries = 0;
      console.log(`▶️ Tâche sélectionnée : ${taskResult.title}`);
      await openProfileStep(context, prPage);

      const igPage = await context.newPage();
      let followConfirmed = false;

      try {
        await igPage.goto(taskResult.igUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(rand(1800, 3000));
        await moveMouseHumanLike(igPage, rand(450, 780), rand(220, 420));
        await igPage.mouse.wheel(0, rand(110, 220)).catch(() => {});
        await sleep(rand(700, 1200));
        await igPage.mouse.wheel(0, -rand(90, 160)).catch(() => {});
        await sleep(rand(1000, 2000));

        // Fermer les popups Instagram fréquents (cookies ou avertissement "Ignorer / Dismiss")
        await igPage.evaluate(() => {
          const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const dismissWords = ['autoriser tous les cookies', 'allow all cookies', 'ignorer', 'dismiss', 'plus tard', 'not now'];
          const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
          const b = btns.find((el) => dismissWords.includes(norm(el.innerText || '')));
          if (b) b.click();
        }).catch(() => {});
        await sleep(600);

        const igUrlNow = igPage.url();
        if (igUrlNow.includes('/accounts/login') || igUrlNow.includes('/challenge') || igUrlNow.includes('/suspended')) {
          console.log(`🔑 Instagram bloque ou déconnecte la session (${igUrlNow}). Connecte-toi sur Instagram pour valider l'alerte puis mets à jour SESSION_COOKIES_JSON.`);
          await igPage.close().catch(() => {});
          await cancelActiveTaskOnPrSocial(prPage);
          await sleep(10 * 60 * 1000);
          continue;
        }

        const igInspect = await igPage.evaluate(() => {
          const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const bodyTxt = norm(document.body?.innerText || '');
          if (bodyTxt.includes('try again later') || bodyTxt.includes('reessayez plus tard') || bodyTxt.includes('action bloquee') || bodyTxt.includes('we restrict certain activity')) {
            return { status: 'IG_RATE_LIMIT' };
          }
          if (bodyTxt.includes("sorry, this page isn't available") || bodyTxt.includes("cette page n'est pas disponible")) {
            return { status: 'NOT_FOUND', detail: 'Page indisponible' };
          }
          if (bodyTxt.includes('log in') && bodyTxt.includes('sign up') && !document.querySelector('a[href*="/direct/"]')) {
            return { status: 'IG_LOGGED_OUT', detail: 'Non connecté sur Instagram' };
          }

          const followLbls = ['suivre', 'follow', "s'abonner", 'sabonner', 'suivre en retour', 'follow back'];
          const followingLbls = ['suivi(e)', 'suivi', 'following', 'demande', 'demandé', 'requested', 'abonné', 'abonne(e)'];
          const buttons = Array.from((document.querySelector('header') || document.body).querySelectorAll('button, [role="button"]'));

          let followBtn = null, alreadyBtn = null;
          const seen = [];
          for (const b of buttons) {
            const t = norm(b.innerText || b.getAttribute('aria-label') || '');
            if (t && seen.length < 6) seen.push(t);
            if (followLbls.includes(t) && !followBtn) followBtn = b;
            if (followingLbls.includes(t) && !alreadyBtn) alreadyBtn = b;
          }
          if (!followBtn && alreadyBtn) return { status: 'ALREADY_FOLLOWING' };
          if (!followBtn) return { status: 'NO_FOLLOW_BTN', detail: `Boutons vus: ${JSON.stringify(seen)}` };

          followBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = followBtn.getBoundingClientRect();
          return { status: 'READY', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });

        let igOutcome = igInspect;
        if (igInspect.status === 'READY') {
          await moveMouseHumanLike(igPage, igInspect.x, igInspect.y);
          await igPage.mouse.click(igInspect.x, igInspect.y);
          igOutcome = await igPage.evaluate(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const followingLbls = ['suivi(e)', 'suivi', 'following', 'demande', 'demandé', 'requested', 'abonné', 'abonne(e)'];
            const t0 = Date.now();
            while (Date.now() - t0 < 7500) {
              await wait(300);
              const bodyTxt = norm(document.body?.innerText || '');
              if (bodyTxt.includes('try again later') || bodyTxt.includes('reessayez plus tard') || bodyTxt.includes('action bloquee')) {
                return { status: 'IG_RATE_LIMIT' };
              }
              const cur = Array.from((document.querySelector('header') || document.body).querySelectorAll('button, [role="button"]'));
              if (cur.some((b) => followingLbls.includes(norm(b.innerText || b.getAttribute('aria-label') || '')))) {
                return { status: 'FOLLOWED' };
              }
            }
            return { status: 'CLICK_NOT_CONFIRMED', detail: 'Le bouton Suivre est resté inchangé après le clic' };
          });
        }

        if (igOutcome.status === 'IG_RATE_LIMIT') {
          console.log('🛡️ BOUCLIER ANTI-BAN : Instagram demande de ralentir -> Pause 35 min...');
          await igPage.close().catch(() => {});
          await sleep(35 * 60 * 1000);
          continue;
        }
        if (igOutcome.status === 'IG_LOGGED_OUT') {
          console.log('🔑 Session Instagram déconnectée ! Mets à jour les cookies Instagram dans SESSION_COOKIES_JSON.');
          await igPage.close().catch(() => {});
          await cancelActiveTaskOnPrSocial(prPage);
          await sleep(10 * 60 * 1000);
          continue;
        }
        if (igOutcome.status === 'FOLLOWED' || igOutcome.status === 'ALREADY_FOLLOWING') {
          followConfirmed = true;
        } else {
          console.log(`ℹ️ Détail Instagram (@${taskResult.username}) : ${igOutcome.status} ${igOutcome.detail || ''}`);
        }
      } catch (err) {
        console.log(`⚠️ Erreur Instagram (@${taskResult.username}) : ${err.message}`);
      } finally {
        if (!igPage.isClosed()) await igPage.close().catch(() => {});
      }

      if (!followConfirmed) {
        console.log(`🔄 Suivi non confirmé (@${taskResult.username}) -> annulation.`);
        await cancelActiveTaskOnPrSocial(prPage);
        state.failedCount = (state.failedCount || 0) + 1;
        state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
        saveBotState(state);
        await sleep(rand(2000, 3500));
        continue;
      }

      const confirmOutcome = await confirmWithoutScreenshot(prPage);
      if (confirmOutcome.verified) {
        state.completedCount = (state.completedCount || 0) + 1;
        state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
        saveBotState(state);
        console.log(`✅ Tâche #${state.completedCount} confirmée sans capture (@${taskResult.username})`);

        if (state.completedCount % 12 === 0) {
          const sec = rand(20, 35);
          console.log(`☕ Micro-pause humaine anti-ban (${sec}s)...`);
          await sleep(sec * 1000);
        } else {
          await sleep(rand(4000, 8000));
        }
      } else {
        console.log(`❌ Échec confirmation (@${taskResult.username}) : ${confirmOutcome.reason}`);
        await cancelActiveTaskOnPrSocial(prPage);
        state.failedCount = (state.failedCount || 0) + 1;
        state.ignoredSignatures = [...(state.ignoredSignatures || []), taskResult.signature].slice(-200);
        saveBotState(state);
        await sleep(2500);
      }
    } catch (loopErr) {
      console.log(`⚠️ Incident récupéré automatiquement : ${loopErr.message}`);
      await sleep(5000);
      await prPage.goto('https://pr.social/tasks', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    }
  }

  await browser.close().catch(() => {});
}

main().catch((err) => {
  console.error('❌ Erreur fatale Bot Cloud :', err.message || err);
  process.exit(1);
});
