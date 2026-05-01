// ==UserScript==
// @name         AI Captcha Solver - Free Universal Solver v3
// @namespace    Terminator.Scripts
// @version      3.1.0
// @description  AI captcha solver running inside captcha iframes. Tesseract.js OCR + Hugging Face CLIP AI. Zero API key, zero limits.
// @author       TERMINATOR
// @match        *://*/*
// @match        https://www.google.com/recaptcha/api2/*
// @match        https://www.recaptcha.net/recaptcha/api2/*
// @match        https://newassets.hcaptcha.com/captcha/v1/*
// @match        https://assets.hcaptcha.com/captcha/v1/*
// @match        https://challenges.cloudflare.com/cdn-cgi/challenge-platform/*
// @match        https://challenges.cloudflare.com/turnstile/*
// @match        https://*.funcaptcha.com/*
// @match        https://*.arkoselabs.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      huggingface.co
// @connect      api-inference.huggingface.co
// @connect      cdn.jsdelivr.net
// @connect      tesseract.projectnaptha.com
// @run-at       document-start
// @downloadURL  https://github.com/terminator1626/captcha-solver/blob/main/ai-captcha-solver.user.js
// @updateURL    https://github.com/terminator1626/captcha-solver/blob/main/ai-captcha-solver.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    enabled: true,
    autoSolve: true,
    autoSubmit: false,
    humanizeDelay: true,
    notifications: true,
    recaptcha: { enabled: true, maxRetries: 5 },
    hcaptcha: { enabled: true, maxRetries: 5 },
    turnstile: { enabled: true, maxRetries: 3 },
    funcaptcha: { enabled: true, maxRetries: 3 },
    geetest: { enabled: true },
    textCaptcha: { enabled: true },
    ai: {
      useHuggingFace: true,
      ocrLanguage: 'eng',
      confidenceThreshold: 0.35,
      hfRetries: 3,
      hfTimeout: 45000,
      hfWaitOnLoading: 20,
    },
    logLevel: 'info',
  };

  const LOG_COLORS = { debug: '#888', info: '#4CAF50', warn: '#FF9800', error: '#F44336', ai: '#00E5FF', captcha: '#E040FB' };

  function getConfig() {
    try { const s = GM_getValue('cs_config'); return s ? deepMerge(DEFAULT_CONFIG, s) : JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
    catch { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  }

  function deepMerge(base, ov) {
    const out = { ...base };
    for (const k of Object.keys(ov)) {
      if (ov[k] && typeof ov[k] === 'object' && !Array.isArray(ov[k])) out[k] = deepMerge(base[k] || {}, ov[k]);
      else out[k] = ov[k];
    }
    return out;
  }

  function setConfig(key, val) {
    const c = getConfig(); const p = key.split('.'); let o = c;
    for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = val; GM_setValue('cs_config', c);
  }

  const L = {
    _log(lvl, ...a) {
      const cfg = getConfig(); const lvls = ['debug', 'info', 'warn', 'error'];
      if (lvls.indexOf(lvl) < lvls.indexOf(cfg.logLevel)) return;
      console.log(`%c[CS]`, `color:${LOG_COLORS[lvl]};font-weight:bold;background:#000;padding:2px 6px;border-radius:3px;`, ...a);
    },
    d(...a) { this._log('debug', ...a); }, i(...a) { this._log('info', ...a); },
    w(...a) { this._log('warn', ...a); }, e(...a) { this._log('error', ...a); },
    a(...a) { this._log('ai', ...a); }, c(...a) { this._log('captcha', ...a); },
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hDelay = async (min = 300, max = 900) => {
    const d = getConfig().humanizeDelay ? min + Math.random() * (max - min) : min;
    await sleep(d);
  };

  async function click(el) {
    if (!el || el.disabled || el.offsetParent === null) return false;
    await hDelay(50, 150);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
    await sleep(40);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
    await sleep(40);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
    return true;
  }

  function isInIframe() {
    try { return window.location !== window.parent.location; } catch { return true; }
  }

  function getIframeType() {
    try {
      const h = window.location.href;
      if (/recaptcha\.net|google\.com\/recaptcha/i.test(h)) return 'recaptcha';
      if (/hcaptcha\.com/i.test(h)) return 'hcaptcha';
      if (/challenges\.cloudflare\.com/i.test(h)) return 'turnstile';
      if (/funcaptcha\.com|arkoselabs\.com|arkose\.com/i.test(h)) return 'funcaptcha';
    } catch {}
    return null;
  }

  function getPageType() {
    if (document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]')) return 'recaptcha';
    if (document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')) return 'hcaptcha';
    if (document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]')) return 'turnstile';
    if (document.querySelector('.geetest, iframe[src*="geetest"]')) return 'geetest';
    if (document.querySelector('input[name*="captcha" i], input[id*="captcha" i]')) return 'textCaptcha';
    return null;
  }

  // ===== TESSERACT.JS LOADER =====
  let TesseractLoaded = false;
  async function loadTesseract() {
    if (TesseractLoaded || (typeof Tesseract !== 'undefined')) { TesseractLoaded = true; return; }
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => { TesseractLoaded = true; resolve(); };
      s.onerror = () => { L.w('Failed to load Tesseract.js'); resolve(); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  async function runOCR(img) {
    await loadTesseract();
    if (typeof Tesseract === 'undefined') { L.w('Tesseract not available'); return ''; }
    try {
      L.a('Running OCR...');
      const { data: { text } } = await Tesseract.recognize(img, getConfig().ai.ocrLanguage);
      L.a('OCR result:', text.trim());
      return text.trim();
    } catch (e) { L.e('OCR failed:', e); return ''; }
  }

  // ===== HF AI =====
  async function fetchImage(src) {
    return new Promise((resolve) => {
      if (src.startsWith('data:')) { resolve(src); return; }
      GM_xmlhttpRequest({
        method: 'GET', url: src, responseType: 'blob', timeout: 10000,
        onload(r) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(r.response);
        },
        onerror: () => resolve(null), ontimeout: () => resolve(null),
      });
    });
  }

  async function hfClassify(b64Image, labels) {
    const ai = getConfig().ai;
    if (!ai.useHuggingFace) return {};

    const reqs = [
      { url: 'https://api-inference.huggingface.co/models/openai/clip-vit-large-patch14', zeroShot: true },
      { url: 'https://api-inference.huggingface.co/models/openai/clip-vit-base-patch32', zeroShot: true },
    ];

    for (const { url, zeroShot } of reqs) {
      for (let attempt = 0; attempt < ai.hfRetries; attempt++) {
        try {
          const body = JSON.stringify({
            inputs: b64Image,
            parameters: { candidate_labels: labels },
          });

          const result = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
              method: 'POST', url, headers: { 'Content-Type': 'application/json' },
              data: body, responseType: 'text', timeout: ai.hfTimeout,
              onload(r) { try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error('parse')); } },
              onerror: reject, ontimeout: () => reject(new Error('timeout')),
            });
          });

          if (result.error) {
            L.d(`HF ${url.split('/').pop()}: ${result.error}`);
            if (result.error.includes('loading') && result.estimated_time) {
              const wait = Math.min(Math.ceil(result.estimated_time) * 1000, ai.hfWaitOnLoading * 1000);
              L.a(`Model loading, waiting ${(wait / 1000).toFixed(0)}s`);
              await sleep(wait);
              continue;
            }
            if (result.error.includes('rate') || result.error.includes('overloaded')) {
              L.w('HF rate limited, waiting 5s');
              await sleep(5000);
              continue;
            }
            break;
          }

          if (Array.isArray(result)) {
            const s = {}; for (const i of result) s[i.label] = i.score;
            L.a('HF scores:', s);
            return s;
          }
          if (result.scores && result.labels) {
            const s = {}; for (let i = 0; i < result.labels.length; i++) s[result.labels[i]] = result.scores[i];
            L.a('HF scores:', s);
            return s;
          }
          if (result.score) { L.a('HF:', result); return { [result.label]: result.score }; }

          L.d('Unexpected HF response:', JSON.stringify(result).slice(0, 150));
          break;
        } catch (e) {
          L.d(`HF attempt ${attempt + 1} failed:`, e.message);
          if (attempt < ai.hfRetries - 1) await sleep(1500);
        }
      }
    }
    L.w('All HF models failed');
    return {};
  }

  // ===== CHALLENGE PARSING =====
  function getChallengeText() {
    const sels = [
      '#rc-imageselect-target', '.rc-imageselect-instructions', '.rc-imageselect-dynamic-selector',
      '#prompt', '.prompt-text', '.challenge-text', '.instruction-text',
      '[class*="instruction"]', '[class*="prompt"]', '[class*="challenge"]',
      '#challenge-text', '.task-text', '.task-label', '.header-text',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.textContent.trim().length > 3) return el.textContent.trim();
    }
    return '';
  }

  function parseCategory(text) {
    if (!text) return '';
    const t = text.toLowerCase().replace(/[.!?,]/g, ' ');
    const map = {
      'traffic light': /traffic\s*light/i, crosswalk: /crosswalk|pedestrian\s*cross/i,
      bicycle: /bicyc|bike/i, bus: /bus(es)?/i, car: /car|vehicle/i,
      motorcycle: /motorcyc|motorbike/i, 'fire hydrant': /fire\s*hydrant|fireplug/i,
      stairs: /stair|step/i, bridge: /bridge/i, mountain: /mountain|hill/i,
      'parking meter': /parking\s*meter/i, 'palm tree': /palm\s*tree/i,
      taxi: /taxi|cab/i, tractor: /tractor/i, sidewalk: /sidewalk|pavement/i,
      truck: /truck/i, van: /van/i, train: /train|subway|metro|tram/i,
      boat: /boat|ship/i, airplane: /airplane|plane|aircraft/i,
      dog: /dog|puppy/i, cat: /cat|kitten/i, horse: /horse|pony/i,
      bird: /bird/i, bear: /bear/i, elephant: /elephant/i, zebra: /zebra/i,
      'stop sign': /stop\s*sign/i, bench: /bench/i, mailbox: /mail\s*box|post\s*box/i,
      storefront: /storefront|shop/i, chimney: /chimney/i, playground: /playground/i,
      tower: /tower/i, fountain: /fountain/i, 'swimming pool': /swimming\s*pool|pool/i,
      building: /building|house|apartment/i, road: /road|street/i,
      water: /water|ocean|sea|lake|river/i, snow: /snow/i, cloud: /cloud/i,
      tree: /tree|forest/i, person: /person|people|pedestrian|human/i,
      'road sign': /road\s*sign|traffic\s*sign|sign/i, motorway: /motorway|freeway|highway/i,
      animal: /animal|creature/i,
    };
    for (const [cat, re] of Object.entries(map)) { if (re.test(t)) return cat; }
    const m = t.match(/(?:select|click|tap|choose)\s+(?:all\s+)?(?:images?\s+)?(?:with|of|containing|that\s+show)\s+(.+?)(?:\.|$|,|if|and)/i);
    return m ? m[1].trim() : '';
  }

  function getTiles(gridType) {
    const tiles = [];
    if (gridType === 'recaptcha') {
      document.querySelectorAll('.rc-imageselect-tile').forEach((tile, i) => {
        const img = tile.querySelector('img');
        if (img && img.src) tiles.push({ tile, img, i, src: img.src });
      });
    } else if (gridType === 'hcaptcha') {
      document.querySelectorAll('.task-image').forEach((tile, i) => {
        const img = tile.querySelector('img');
        if (img && img.src) { tiles.push({ tile, img, i, src: img.src }); return; }
        const bg = getComputedStyle(tile).backgroundImage;
        const m = bg?.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) tiles.push({ tile, img: tile, i, src: m[1] });
      });
    }
    return tiles;
  }

  // ===== SOLVE CHALLENGE =====
  async function solveChallenge(gridType) {
    const text = getChallengeText();
    if (!text) { L.w('No challenge text'); return null; }

    const category = parseCategory(text);
    if (!category) { L.w('Cannot parse category from:', text); return null; }

    L.c(`"${text}" => "${category}"`);

    const tiles = getTiles(gridType);
    if (tiles.length === 0) { L.w('No tiles'); return null; }

    L.a(`${tiles.length} tiles, classifying "${category}"`);

    const allLabels = [category, 'traffic light', 'crosswalk', 'bicycle', 'bus', 'car', 'motorcycle',
      'fire hydrant', 'stairs', 'bridge', 'mountain', 'parking meter', 'palm tree',
      'taxi', 'tractor', 'sidewalk', 'truck', 'van', 'train', 'boat', 'airplane',
      'dog', 'cat', 'horse', 'bear', 'stop sign', 'bench', 'mailbox', 'storefront',
      'chimney', 'playground', 'tower', 'fountain', 'swimming pool', 'building',
      'road', 'water', 'snow', 'tree', 'person', 'road sign', 'animal'];

    const clicked = [];
    const threshold = getConfig().ai.confidenceThreshold;

    for (const t of tiles) {
      const b64 = await fetchImage(t.src);
      if (!b64) { L.d(`Tile ${t.i}: fetch failed`); continue; }

      const scores = await hfClassify(b64, allLabels);
      const score = scores[category] || 0;
      L.a(`Tile ${t.i}: "${category}" = ${score.toFixed(3)} (min: ${threshold})`);

      if (score >= threshold) {
        L.a(`=> CLICK tile ${t.i}`);
        await hDelay(200, 500);
        await click(t.tile);
        clicked.push(t.i);
        await hDelay(150, 300);
      }
    }

    L.c(`Clicked ${clicked.length} tiles: [${clicked.join(',')}]`);
    if (clicked.length === 0) return false;

    await hDelay(800, 1500);
    const btn = document.querySelector('#recaptcha-verify-button, .verify-button, [class*="verify"], .submit-button, [class*="submit"]');
    if (btn) { L.i('Click Verify'); await hDelay(300, 600); await click(btn); return true; }
    return true;
  }

  // ===== IFRAME SOLVERS =====
  async function solveRecaptchaFrame() {
    const cfg = getConfig().recaptcha;
    for (let round = 0; round < cfg.maxRetries; round++) {
      await sleep(1500);
      const text = getChallengeText();

      if (text) {
        L.c(`Round ${round + 1}: ${text}`);

        const t = text.toLowerCase();
        if (/skip|no\s+images|none|don't\s*see|there\s+are\s+no/i.test(t)) {
          L.a('No matching, click Verify');
          const btn = document.querySelector('#recaptcha-verify-button, .verify-button');
          if (btn) await click(btn);
          await sleep(3000);
          if (!getChallengeText()) { L.c('Solved!'); notify('recaptcha'); return; }
          continue;
        }

        const ok = await solveChallenge('recaptcha');
        if (!ok) {
          L.w('Could not classify tiles, clicking Verify anyway');
          const btn = document.querySelector('#recaptcha-verify-button, .verify-button');
          if (btn) await click(btn);
        }

        await sleep(3000);
        const nextText = getChallengeText();
        if (!nextText) { L.c('Solved!'); notify('recaptcha'); return; }
        if (nextText === text) { L.i('Same text, trying Verify again'); const btn = document.querySelector('#recaptcha-verify-button'); if (btn) await click(btn); await sleep(3000); if (!getChallengeText()) { L.c('Solved!'); notify('recaptcha'); return; } }
      } else {
        const cb = document.querySelector('.recaptcha-checkbox, [role="checkbox"], .recaptcha-checkbox-holder');
        if (cb) { L.c('Clicking checkbox'); await click(cb); await sleep(5000); }
        if (!getChallengeText()) { L.c('No challenge - solved!'); notify('recaptcha'); return; }
      }
    }
    L.w('Max retries reCAPTCHA');
  }

  async function solveHCaptchaFrame() {
    const cfg = getConfig().hcaptcha;
    for (let round = 0; round < cfg.maxRetries; round++) {
      await sleep(1500);
      const text = getChallengeText();

      if (text) {
        L.c(`hCaptcha: ${text}`);
        const t = text.toLowerCase();
        if (/skip|no\s+images|none|don't\s*see/i.test(t)) {
          const btn = document.querySelector('.verify-button, .submit-button, [class*="verify"]');
          if (btn) await click(btn);
          await sleep(3000);
          if (!getChallengeText()) { L.c('Solved!'); notify('hcaptcha'); return; }
          continue;
        }

        const ok = await solveChallenge('hcaptcha');
        if (!ok) {
          const btn = document.querySelector('.verify-button, .submit-button, [class*="verify"]');
          if (btn) await click(btn);
        }
        await sleep(3000);
        if (!getChallengeText()) { L.c('Solved!'); notify('hcaptcha'); return; }
      } else {
        const cb = document.querySelector('.check, .checkbox, [class*="check"]');
        if (cb) { L.c('Clicking hCaptcha checkbox'); await click(cb); await sleep(5000); }
        if (!getChallengeText()) { L.c('Solved!'); notify('hcaptcha'); return; }
      }
    }
    L.w('Max retries hCaptcha');
  }

  async function solveTurnstileFrame() {
    L.c('Turnstile frame');
    await sleep(2000);
    const cb = document.querySelector('input[type="checkbox"], .turnstile-checkbox, [class*="checkbox"]');
    if (cb) { L.c('Clicking Turnstile checkbox'); await click(cb); }
    await sleep(5000);
    notify('turnstile');
  }

  async function solveFunCaptchaFrame() {
    L.c('FunCaptcha frame');
    await sleep(2000);
    const btn = document.querySelector('.play_button, .start-button, [class*="start"]');
    if (btn) await click(btn);
    await sleep(2000);
    const slider = document.querySelector('input[type="range"]');
    if (slider) {
      for (let i = 0; i < 3; i++) {
        slider.value = String(Math.random() * 360);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(500);
      }
      const sub = document.querySelector('.submit_button, .submit-button');
      if (sub) await click(sub);
    }
    notify('funcaptcha');
  }

  function notify(type) {
    try { window.parent.postMessage({ source: 'captcha-solver-v3', type: 'solved', captcha: type }, '*'); } catch {}
  }

  // ===== MAIN PAGE =====
  let solvedN = 0, failedN = 0, monObserver = null;

  async function solveMainPage(type) {
    const cfg = getConfig()[type];
    if (!cfg?.enabled) return false;

    L.c(`Solving ${type}...`);

    if (type === 'textCaptcha') return await solveTextCaptchaMain();
    if (type === 'geetest') return await solveGeetestMain();

    // Try to trigger captcha
    if (type === 'recaptcha' && unsafeWindow.grecaptcha) {
      for (let i = 0; i < 100; i++) try { unsafeWindow.grecaptcha.execute(i); } catch {}
    }
    if (type === 'hcaptcha' && unsafeWindow.hcaptcha) {
      try { unsafeWindow.hcaptcha.execute(); } catch {}
    }
    if (type === 'turnstile' && unsafeWindow.turnstile) {
      document.querySelectorAll('.cf-turnstile, [class*="turnstile"]').forEach(el => { try { unsafeWindow.turnstile.execute(el); } catch {} });
    }

    // Wait for iframe to solve itself (if iframe script is running)
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      if (isSolved(type)) { solvedN++; updPanel(); L.c(`${type} solved!`); if (getConfig().autoSubmit) autoSubmit(); return true; }
    }

    failedN++; updPanel();
    return false;
  }

  function isSolved(type) {
    if (type === 'recaptcha') return !!document.querySelector('.recaptcha-checkbox[aria-checked="true"]') || !!document.querySelector('.g-recaptcha-response')?.value;
    if (type === 'hcaptcha') return !!document.querySelector('.h-captcha textarea')?.value;
    if (type === 'turnstile') return !document.querySelector('iframe[src*="challenges.cloudflare.com"]') || !!document.querySelector('[data-turnstile-success]');
    return false;
  }

  async function solveTextCaptchaMain() {
    const input = document.querySelector('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[name*="verification" i]');
    if (!input) return false;
    const img = document.querySelector('img[src*="captcha" i], img[src*="captchaImage" i], img[src*="code" i]');
    if (!img) return false;
    const text = await runOCR(img);
    const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    if (cleaned.length >= 2) {
      input.value = cleaned;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      L.c(`OCR filled: "${cleaned}"`);
      solvedN++; updPanel();
      return true;
    }
    failedN++; updPanel();
    return false;
  }

  async function solveGeetestMain() {
    const slider = document.querySelector('.geetest_slider_button, .gt_slider_knob, [class*="slider"]');
    if (!slider) return false;
    await hDelay(500, 1000);
    const r = slider.getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: sx, clientY: sy }));
    await sleep(80);
    const tx = sx + 150 + Math.random() * 100;
    for (let i = 1; i <= 25; i++) {
      const p = i / 25, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      slider.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: sx + (tx - sx) * e, clientY: sy + (Math.random() - 0.5) * 5 }));
      await sleep(20 + Math.random() * 15);
    }
    slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: tx, clientY: sy }));
    L.c('GeeTest done'); solvedN++; updPanel(); return true;
  }

  function autoSubmit() {
    const btn = document.querySelector('input[type="submit"], button[type="submit"], .submit-button');
    if (btn && !btn.disabled) hDelay(300, 800).then(() => { click(btn); L.i('Form submitted'); });
  }

  function checkExisting() {
    const type = isInIframe() ? getIframeType() : getPageType();
    if (type && getConfig().autoSolve && getConfig().enabled) solveMainOrFrame(type);
  }

  async function solveMainOrFrame(type) {
    if (isInIframe()) {
      L.c(`=== In ${type} iframe ===`);
      if (type === 'recaptcha') await solveRecaptchaFrame();
      else if (type === 'hcaptcha') await solveHCaptchaFrame();
      else if (type === 'turnstile') await solveTurnstileFrame();
      else if (type === 'funcaptcha') await solveFunCaptchaFrame();
    } else {
      await solveMainPage(type);
    }
  }

  function startMonitor() {
    monObserver = new MutationObserver(mutations => {
      let found = false;
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'IFRAME' && /recaptcha|hcaptcha|turnstile|funcaptcha|arkose|geetest|captcha/i.test(n.src || '')) { found = true; break; }
          if (n.querySelector?.('.g-recaptcha, .h-captcha, .cf-turnstile, .geetest')) { found = true; break; }
        }
        if (found) break;
      }
      if (found && getConfig().autoSolve && getConfig().enabled) {
        L.i('Captcha detected');
        setTimeout(() => checkExisting(), 1000);
      }
    });
    monObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  // ===== PANEL =====
  function createPanel() {
    GM_addStyle(`
      #cs-v3{position:fixed;top:10px;right:10px;z-index:2147483647;font:12px -apple-system,sans-serif}
      #cs-v3 button{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);border:none;cursor:pointer;color:#fff;font-size:16px;box-shadow:0 3px 12px rgba(102,126,234,.4)}
      #cs-v3 button:hover{transform:scale(1.1)}
      #cs-v3-p{display:none;position:absolute;top:48px;right:0;width:240px;background:#1a1a2e;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);color:#fff}
      #cs-v3-p.open{display:block}
      #cs-v3-p .hd{background:linear-gradient(135deg,#667eea,#764ba2);padding:8px 12px;display:flex;justify-content:space-between;align-items:center}
      #cs-v3-p .hd h3{margin:0;font-size:11px}
      #cs-v3-p .bd{padding:8px;max-height:320px;overflow-y:auto}
      #cs-v3-p .r{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px}
      #cs-v3-p .sw{position:relative;width:30px;height:16px}
      #cs-v3-p .sw input{opacity:0;width:0;height:0}
      #cs-v3-p .sw label{position:absolute;inset:0;background:#444;border-radius:16px;cursor:pointer;transition:.3s}
      #cs-v3-p .sw label::before{position:absolute;content:"";height:10px;width:10px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.3s}
      #cs-v3-p .sw input:checked+label{background:#667eea}
      #cs-v3-p .sw input:checked+label::before{transform:translateX(14px)}
      #cs-v3-p .btn{width:100%;padding:6px;margin-top:5px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:700;font-size:10px}
      #cs-v3-p .st{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:10px}
      #cs-v3-p .dot{width:6px;height:6px;border-radius:50%;display:inline-block}
      #cs-v3-p .dot.g{background:#4CAF50;box-shadow:0 0 4px #4CAF50}
      #cs-v3-p .dot.r{background:#F44336}
    `);

    const p = document.createElement('div');
    p.id = 'cs-v3';
    p.innerHTML = `<button id="cs-v3-b">&#9968;</button><div id="cs-v3-p">${panelHTML()}</div>`;
    p.querySelector('#cs-v3-b').onclick = () => p.querySelector('#cs-v3-p').classList.toggle('open');

    const add = () => { document.body.appendChild(p); bindPanel(); };
    document.body ? add() : new MutationObserver((_, o) => { if (document.body) { o.disconnect(); add(); } }).observe(document.documentElement, { childList: true });
  }

  function panelHTML() {
    const c = getConfig();
    const sw = (id, label, on) => `<div class="r"><span>${label}</span><div class="sw"><input type="checkbox" id="cs-${id}" ${on ? 'checked' : ''}><label for="cs-${id}"></label></div></div>`;
    return `<div class="hd"><h3>&#9968; AI Captcha v3</h3><span class="dot ${c.enabled ? 'g' : 'r'}"></span></div>
      <div class="bd">
        ${sw('enabled', 'Enabled', c.enabled)}${sw('autosolve', 'Auto Solve', c.autoSolve)}${sw('autosubmit', 'Auto Submit', c.autoSubmit)}
        <div class="st"><span>Solved</span><span id="cs-ok">0</span></div>
        <div class="st"><span>Failed</span><span id="cs-fail">0</span></div>
        ${sw('recaptcha', 'reCAPTCHA', c.recaptcha.enabled)}${sw('hcaptcha', 'hCaptcha', c.hcaptcha.enabled)}
        ${sw('turnstile', 'Turnstile', c.turnstile.enabled)}${sw('funcaptcha', 'FunCaptcha', c.funcaptcha.enabled)}
        ${sw('geetest', 'GeeTest', c.geetest.enabled)}${sw('textcaptcha', 'Text OCR', c.textCaptcha.enabled)}
        <div style="font-size:9px;color:#666;margin-top:3px">AI: ${c.ai.useHuggingFace ? 'HF CLIP + Tesseract' : 'Off'} | Threshold: ${c.ai.confidenceThreshold}</div>
        <button class="btn" id="cs-go">&#9889; Solve Now</button>
      </div>`;
  }

  function bindPanel() {
    const b = (id, fn) => document.getElementById(id)?.addEventListener('change', fn);
    b('cs-enabled', e => setConfig('enabled', e.target.checked));
    b('cs-autosolve', e => setConfig('autoSolve', e.target.checked));
    b('cs-autosubmit', e => setConfig('autoSubmit', e.target.checked));
    b('cs-recaptcha', e => { const c = getConfig(); c.recaptcha.enabled = e.target.checked; GM_setValue('cs_config', c); });
    b('cs-hcaptcha', e => { const c = getConfig(); c.hcaptcha.enabled = e.target.checked; GM_setValue('cs_config', c); });
    b('cs-turnstile', e => { const c = getConfig(); c.turnstile.enabled = e.target.checked; GM_setValue('cs_config', c); });
    b('cs-funcaptcha', e => { const c = getConfig(); c.funcaptcha.enabled = e.target.checked; GM_setValue('cs_config', c); });
    b('cs-geetest', e => { const c = getConfig(); c.geetest.enabled = e.target.checked; GM_setValue('cs_config', c); });
    b('cs-textcaptcha', e => { const c = getConfig(); c.textCaptcha.enabled = e.target.checked; GM_setValue('cs_config', c); });
    document.getElementById('cs-go')?.addEventListener('click', () => checkExisting());
  }

  function updPanel() {
    const o = document.getElementById('cs-ok'), f = document.getElementById('cs-fail');
    if (o) o.textContent = solvedN; if (f) f.textContent = failedN;
  }

  // ===== INIT =====
  function init() {
    const iframeType = getIframeType();
    const pageType = getPageType();

    if (isInIframe() && iframeType) {
      L.c(`=== Running in ${iframeType} iframe ===`);
      sleep(800).then(() => solveMainOrFrame(iframeType));
    } else if (pageType) {
      L.c(`=== Main page: ${pageType} ===`);
      createPanel();
      startMonitor();
      sleep(500).then(() => checkExisting());
    } else {
      L.d('No captcha detected on load');
      createPanel();
      startMonitor();
    }

    window.addEventListener('message', e => {
      if (e.data?.source === 'captcha-solver-v3' && e.data.type === 'solved') {
        solvedN++; updPanel();
        L.c(`${e.data.captcha} solved via iframe!`);
        if (getConfig().autoSubmit) autoSubmit();
        if (getConfig().notifications) GM_notification({ text: `${e.data.captcha} solved!`, title: 'AI Captcha Solver', timeout: 3000 });
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  unsafeWindow.CaptchaSolver = {
    solve: solveMainOrFrame, detect: () => isInIframe() ? getIframeType() : getPageType(),
    getConfig, setConfig, stats: () => ({ solved: solvedN, failed: failedN }),
    runOCR, classifyImage: hfClassify,
  };

})();
