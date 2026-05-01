// ==UserScript==
// @name         AI Captcha Solver
// @namespace    Terminator.Scripts
// @version      4.0.0
// @description  Auto-solve captchas with AI. Tesseract OCR + Hugging Face CLIP. Zero API key.
// @author       TERMINATOR
// @match        *://*/*
// @match        https://www.google.com/recaptcha/api2/*
// @match        https://www.recaptcha.net/recaptcha/api2/*
// @match        https://newassets.hcaptcha.com/captcha/v1/*
// @match        https://assets.hcaptcha.com/captcha/v1/*
// @match        https://challenges.cloudflare.com/cdn-cgi/challenge-platform/*
// @match        https://challenges.cloudflare.com/turnstile/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      huggingface.co
// @connect      api-inference.huggingface.co
// @connect      tesseract.projectnaptha.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CFG_KEY = 'cs_v4';
  const CFG = {
    enabled: true,
    autoSolve: true,
    autoSubmit: false,
    threshold: 0.40,
    hfRetries: 4,
    hfWait: 15,
    maxRounds: 8,
    ocrLang: 'eng',
    logLevel: 'info',
  };

  function loadCfg() {
    try { const s = GM_getValue(CFG_KEY); return s ? { ...CFG, ...s } : { ...CFG }; }
    catch { return { ...CFG }; }
  }

  const C = loadCfg();
  const LOG_C = { debug: '#888', info: '#4CAF50', warn: '#FF9800', error: '#F44336', ai: '#00E5FF', cap: '#E040FB' };
  const log = (lvl, ...a) => {
    const lvls = ['debug', 'info', 'warn', 'error'];
    if (lvls.indexOf(lvl) < lvls.indexOf(C.logLevel)) return;
    console.log(`%c[CS]`, `color:${LOG_C[lvl]};font-weight:bold;`, ...a);
  };
  const L = {
    d: (...a) => log('debug', ...a), i: (...a) => log('info', ...a),
    w: (...a) => log('warn', ...a), e: (...a) => log('error', ...a),
    a: (...a) => log('ai', ...a), c: (...a) => log('cap', ...a),
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hDelay = async (min = 200, max = 600) => await sleep(min + Math.random() * (max - min));

  async function click(el) {
    if (!el || el.disabled || el.offsetParent === null) return false;
    await hDelay(30, 100);
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window }));
    await sleep(30);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window }));
    await sleep(30);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
    return true;
  }

  function inIframe() { try { return window.location !== window.parent.location; } catch { return true; } }

  function whatAmI() {
    try {
      const h = window.location.href;
      if (/google\.com\/recaptcha|recaptcha\.net\/recaptcha/i.test(h)) return 'recaptcha';
      if (/hcaptcha\.com/i.test(h)) return 'hcaptcha';
      if (/challenges\.cloudflare\.com/i.test(h)) return 'turnstile';
      if (/funcaptcha\.com|arkoselabs\.com|arkose\.com/i.test(h)) return 'funcaptcha';
    } catch {}
    // Main page detection
    if (document.querySelector('.g-recaptcha, iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net"]')) return 'recaptcha';
    if (document.querySelector('.h-captcha, iframe[src*="hcaptcha.com"]')) return 'hcaptcha';
    if (document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]')) return 'turnstile';
    if (document.querySelector('.geetest')) return 'geetest';
    if (document.querySelector('input[name*="captcha" i]') && document.querySelector('img[src*="captcha" i]')) return 'textCaptcha';
    return null;
  }

  // ====== IMAGE FETCH ======
  async function fetchImg(src) {
    return new Promise((resolve) => {
      if (src.startsWith('data:')) {
        const idx = src.indexOf('base64,');
        resolve(idx >= 0 ? src.slice(idx + 7) : src.split(',')[1] || '');
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET', url: src, responseType: 'arraybuffer', timeout: 10000,
        onload(r) {
          const bytes = new Uint8Array(r.response);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          resolve(btoa(binary));
        },
        onerror: () => resolve(null), ontimeout: () => resolve(null),
      });
    });
  }

  // ====== HF AI ======
  async function hfClassify(rawBase64, labels) {
    if (!rawBase64) return {};

    const labelsStr = labels.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
    if (labelsStr.length === 0) return {};

    const models = [
      'openai/clip-vit-large-patch14',
      'openai/clip-vit-base-patch32',
      'openai/clip-vit-large-patch14-336',
    ];

    for (const model of models) {
      for (let attempt = 0; attempt < C.hfRetries; attempt++) {
        try {
          const body = JSON.stringify({
            inputs: rawBase64,
            parameters: { candidate_labels: labelsStr },
          });

          const resp = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
              method: 'POST',
              url: `https://api-inference.huggingface.co/models/${model}`,
              headers: { 'Content-Type': 'application/json' },
              data: body,
              responseType: 'text',
              timeout: 45000,
              onload(r) { try { resolve(JSON.parse(r.responseText)); } catch { reject(new Error('parse')); } },
              onerror: reject,
              ontimeout: () => reject(new Error('timeout')),
            });
          });

          if (resp.error) {
            L.d(`HF ${model}: ${resp.error}`);
            if (resp.error.includes('loading') && resp.estimated_time) {
              const w = Math.min(Math.ceil(resp.estimated_time) * 1000, C.hfWait * 1000);
              L.a(`Model loading, waiting ${Math.round(w / 1000)}s`);
              await sleep(w);
              continue;
            }
            if (resp.error.includes('rate') || resp.error.includes('overloaded')) {
              L.w('Rate limited, wait 5s'); await sleep(5000); continue;
            }
            if (resp.error.includes('image input') || resp.error.includes('text input')) break;
            break;
          }

          if (Array.isArray(resp)) {
            const s = {}; for (const i of resp) s[i.label] = i.score;
            L.a(`HF:`, s);
            return s;
          }
          if (resp.scores && resp.labels) {
            const s = {}; for (let i = 0; i < resp.labels.length; i++) s[resp.labels[i]] = resp.scores[i];
            L.a(`HF:`, s);
            return s;
          }
          if (resp.score) { L.a(`HF:`, resp); return { [resp.label]: resp.score }; }

          L.d('Unexpected:', JSON.stringify(resp).slice(0, 150));
          break;
        } catch (e) {
          L.d(`Attempt ${attempt + 1}: ${e.message}`);
          if (attempt < C.hfRetries - 1) await sleep(1000);
        }
      }
    }
    return {};
  }

  // ====== CATEGORY PARSING ======
  function parseChallengeText(text) {
    if (!text || text.length < 3) return '';
    const t = text.toLowerCase().replace(/[.!?,;:]/g, ' ').replace(/\s+/g, ' ').trim();

    const map = {
      'traffic light': /traffic\s*light|traffic\s*signal/i,
      'crosswalk': /crosswalk|pedestrian\s*crossing|zebra\s*crossing/i,
      'bicycle': /bicyc|bike/i,
      'bus': /\bbus\b|buses/i,
      'car': /\bcar\b|\bcars\b|vehicle|vehicles/i,
      'motorcycle': /motorcyc|motorbike/i,
      'fire hydrant': /fire\s*hydrant|fireplug|hydrant/i,
      'stairs': /stair|steps|staircase/i,
      'bridge': /\bbridge\b|overpass/i,
      'mountain': /\bmountain\b|mountains|hill/i,
      'parking meter': /parking\s*meter/i,
      'palm tree': /palm\s*tree|palm\s*trees/i,
      'taxi': /\btaxi\b|taxis|\bcab\b|cabs/i,
      'tractor': /tractor/i,
      'sidewalk': /sidewalk|pavement/i,
      'truck': /\btruck\b|trucks|lorry/i,
      'van': /\bvan\b|vans/i,
      'train': /\btrain\b|trains|subway|metro|tram/i,
      'boat': /\bboat\b|boats|ship|ships/i,
      'airplane': /airplane|airplanes|plane|aircraft/i,
      'dog': /\bdog\b|dogs|puppy|puppies/i,
      'cat': /\bcat\b|cats|kitten|kittens/i,
      'horse': /\bhorse\b|horses|pony/i,
      'bird': /\bbird\b|birds/i,
      'bear': /\bbear\b|bears|grizzly/i,
      'elephant': /elephant/i,
      'zebra': /zebra/i,
      'giraffe': /giraffe/i,
      'stop sign': /stop\s*sign/i,
      'bench': /\bben\b|benches/i,
      'mailbox': /mail\s*box|mailboxes|postbox|post\s*box/i,
      'storefront': /storefront|store\s*front|shop|shops/i,
      'chimney': /chimney|chimneys/i,
      'playground': /playground/i,
      'tower': /\btower\b|towers/i,
      'fountain': /fountain/i,
      'swimming pool': /swimming\s*pool|\bpool\b/i,
      'building': /building|buildings|house|houses|apartment/i,
      'road': /\broad\b|roads|street|streets/i,
      'water': /water|ocean|sea|lake|river|pond/i,
      'snow': /snow|snowy/i,
      'tree': /tree|trees|forest/i,
      'person': /person|people|pedestrian|pedestrians|human/i,
      'road sign': /road\s*sign|traffic\s*sign|sign\s*post|stop\s*sign/i,
      'motorway': /motorway|freeway|highway/i,
      'animal': /animal|animals/i,
      'garden': /garden|garden\s*area/i,
      'beach': /beach|shore/i,
    };

    for (const [cat, re] of Object.entries(map)) { if (re.test(t)) return cat; }

    const m = t.match(/(?:select|click|tap|choose)\s+(?:all\s+)?(?:images?\s+)?(?:with|of|containing|that\s+(?:show|have|contain|depict))\s+(.+?)(?:\.|$|,|;|\s+if\s+)/i);
    return m ? m[1].trim() : '';
  }

  // ====== TILE DETECTION ======
  function getTiles(type) {
    const tiles = [];

    if (type === 'recaptcha') {
      const tileEls = document.querySelectorAll('.rc-imageselect-tile');
      for (let i = 0; i < tileEls.length; i++) {
        const tile = tileEls[i];
        let img = tile.querySelector('img');

        if (!img || !img.src) {
          const imgs = tile.querySelectorAll('img');
          for (const im of imgs) {
            if (im.src && im.src.length > 10) { img = im; break; }
          }
        }

        if (!img) {
          const bg = getComputedStyle(tile).backgroundImage;
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (m) tiles.push({ el: tile, i, src: m[1], isBg: true });
          continue;
        }

        let src = img.src;
        if (src.includes('base64') || src.startsWith('data:')) {
          tiles.push({ el: tile, i, src, isBg: false });
        } else if (src) {
          tiles.push({ el: tile, i, src, isBg: false });
        }
      }
    }

    if (type === 'hcaptcha') {
      const taskEls = document.querySelectorAll('.task-image');
      for (let i = 0; i < taskEls.length; i++) {
        const tile = taskEls[i];
        let img = tile.querySelector('img');

        if (!img || !img.src) {
          const bg = getComputedStyle(tile).backgroundImage || getComputedStyle(tile.querySelector('[class*="image"]') || tile).backgroundImage;
          const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (m) { tiles.push({ el: tile, i, src: m[1], isBg: true }); continue; }
        }

        if (img && img.src) {
          tiles.push({ el: tile, i, src: img.src, isBg: false });
        }
      }

      if (tiles.length === 0) {
        const allImgs = document.querySelectorAll('[class*="task"] img');
        allImgs.forEach((img, i) => {
          if (img.src) tiles.push({ el: img.closest('[class*="task"]') || img.parentElement || img, i, src: img.src, isBg: false });
        });
      }
    }

    return tiles;
  }

  function getChallengeText() {
    const sels = [
      '#rc-imageselect-target', '.rc-imageselect-instructions', '.rc-imageselect-dynamic-selector',
      '#prompt', '.prompt-text', '.challenge-text', '.instruction-text',
      '[class*="instruction"]', '[class*="prompt"]', '[class*="challenge"]',
      '#challenge-text', '.task-text', '.task-label', '.header-text',
      '#task-text', '[data-test="challenge-text"]',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.textContent.trim().length > 5) return el.textContent.trim();
    }
    // Scan body text
    const body = document.body?.textContent || '';
    const m = body.match(/select\s+all\s+(?:images?\s+)?(?:with|of|containing)\s+([^.!?]{3,50})/i);
    if (m) return 'Select all images with ' + m[1].trim();
    return '';
  }

  function findVerify(type) {
    if (type === 'recaptcha') {
      return document.querySelector('#recaptcha-verify-button') ||
        document.querySelector('[id*="verify"]') ||
        [...document.querySelectorAll('button')].find(b => /verify/i.test(b.textContent));
    }
    if (type === 'hcaptcha') {
      return document.querySelector('.verify-button') ||
        document.querySelector('.submit-button') ||
        [...document.querySelectorAll('button')].find(b => /verify|submit/i.test(b.textContent || '')) ||
        [...document.querySelectorAll('[class*="verify"]')]?.[0] ||
        document.querySelector('[data-test="verify-button"]');
    }
    return document.querySelector('#recaptcha-verify-button, .verify-button, [class*="verify"], .submit-button');
  }

  function findCheckbox(type) {
    if (type === 'recaptcha') {
      return document.querySelector('.recaptcha-checkbox') ||
        document.querySelector('.recaptcha-checkbox-holder') ||
        document.querySelector('[role="checkbox"]') ||
        document.querySelector('.rc-anchor-checkbox');
    }
    if (type === 'hcaptcha') {
      return document.querySelector('.check') ||
        document.querySelector('.checkbox') ||
        document.querySelector('.captcha-checkbox') ||
        document.querySelector('[class*="check"]');
    }
    return null;
  }

  // ====== SOLVE ======
  async function solveImageChallenge(type) {
    const text = getChallengeText();
    if (!text) { L.w('No challenge text'); return false; }

    const category = parseChallengeText(text);
    if (!category) { L.w('No category from:', text); return false; }
    L.c(`"${text}" => "${category}"`);

    const tiles = getTiles(type);
    if (tiles.length === 0) { L.w('No tiles found'); return false; }
    L.c(`${tiles.length} tiles`);

    const labels = [category, 'traffic light', 'crosswalk', 'bicycle', 'bus', 'car', 'motorcycle',
      'fire hydrant', 'stairs', 'bridge', 'mountain', 'parking meter', 'palm tree',
      'taxi', 'tractor', 'sidewalk', 'truck', 'van', 'train', 'boat', 'airplane',
      'dog', 'cat', 'horse', 'bear', 'stop sign', 'bench', 'mailbox', 'storefront',
      'chimney', 'playground', 'tower', 'fountain', 'swimming pool', 'building',
      'road', 'water', 'snow', 'tree', 'person', 'road sign', 'animal'];

    const clicked = [];

    for (const t of tiles) {
      const b64 = await fetchImg(t.src);
      if (!b64) { L.d(`Tile ${t.i}: fetch fail`); continue; }

      const scores = await hfClassify(b64, labels);
      const score = scores[category] || 0;
      L.a(`Tile ${t.i}: "${category}" = ${score.toFixed(3)} (min: ${C.threshold})`);

      if (score >= C.threshold) {
        L.a(`=> CLICK ${t.i}`);
        await hDelay(150, 400);
        await click(t.el);
        clicked.push(t.i);
        await hDelay(100, 250);
      }
    }

    L.c(`Clicked [${clicked.join(',')}]`);

    if (clicked.length > 0) {
      await hDelay(600, 1200);
      const btn = findVerify(type);
      if (btn) { L.c('Click Verify'); await hDelay(200, 400); await click(btn); return true; }
    }

    return false;
  }

  // ====== IFRAME SOLVERS ======
  async function solveRecaptchaFrame() {
    for (let round = 0; round < C.maxRounds; round++) {
      await sleep(1000);
      const text = getChallengeText();

      if (!text) {
        const cb = findCheckbox('recaptcha');
        if (cb) { L.c('Click checkbox'); await click(cb); await sleep(4000); continue; }
        L.c('No text, no checkbox - done'); notify('recaptcha'); return;
      }

      L.c(`Round ${round + 1}: ${text}`);

      if (/skip|no\s+images|none|don't\s*see|there\s+are\s+no/i.test(text.toLowerCase())) {
        L.a('Skip, click Verify');
        const btn = findVerify('recaptcha');
        if (btn) await click(btn);
        await sleep(3000);
        if (!getChallengeText()) { L.c('Done'); notify('recaptcha'); return; }
        continue;
      }

      await solveImageChallenge('recaptcha');
      await sleep(2500);

      if (!getChallengeText()) { L.c('Done'); notify('recaptcha'); return; }
    }
    L.w('Max rounds');
  }

  async function solveHCaptchaFrame() {
    for (let round = 0; round < C.maxRounds; round++) {
      await sleep(1000);
      const text = getChallengeText();

      if (!text) {
        const cb = findCheckbox('hcaptcha');
        if (cb) { L.c('Click checkbox'); await click(cb); await sleep(4000); continue; }
        L.c('No text, no checkbox - done'); notify('hcaptcha'); return;
      }

      L.c(`hCaptcha: ${text}`);

      if (/skip|no\s+images|none|don't\s*see/i.test(text.toLowerCase())) {
        const btn = findVerify('hcaptcha');
        if (btn) await click(btn);
        await sleep(3000);
        if (!getChallengeText()) { L.c('Done'); notify('hcaptcha'); return; }
        continue;
      }

      await solveImageChallenge('hcaptcha');
      await sleep(2500);

      if (!getChallengeText()) { L.c('Done'); notify('hcaptcha'); return; }
    }
    L.w('Max rounds');
  }

  async function solveTurnstileFrame() {
    L.c('Turnstile'); await sleep(2000);
    const cb = document.querySelector('input[type="checkbox"], [class*="checkbox"]');
    if (cb) { L.c('Click'); await click(cb); }
    await sleep(5000); notify('turnstile');
  }

  async function solveFunCaptchaFrame() {
    L.c('FunCaptcha'); await sleep(2000);
    const btn = document.querySelector('.play_button, [class*="start"]');
    if (btn) { await click(btn); await sleep(2000); }
    const slider = document.querySelector('input[type="range"]');
    if (slider) {
      for (let i = 0; i < 3; i++) { slider.value = String(Math.random() * 360); slider.dispatchEvent(new Event('input', { bubbles: true })); await sleep(400); }
      const sub = document.querySelector('[class*="submit"]'); if (sub) await click(sub);
    }
    notify('funcaptcha');
  }

  function notify(type) {
    try { window.parent.postMessage({ src: 'cs-v4', type: 'solved', captcha: type }, '*'); } catch {}
    if (C.notifications) GM_notification({ text: `${type} solved!`, title: 'CS', timeout: 2000 });
  }

  // ====== MAIN PAGE ======
  let solvedN = 0, failedN = 0;

  async function solveMain(type) {
    if (!C.enabled || !C.autoSolve) return;

    if (type === 'recaptcha' && unsafeWindow.grecaptcha) {
      for (let i = 0; i < 100; i++) try { unsafeWindow.grecaptcha.execute(i); } catch {}
    }
    if (type === 'hcaptcha' && unsafeWindow.hcaptcha) {
      try { unsafeWindow.hcaptcha.execute(); } catch {}
    }
    if (type === 'turnstile' && unsafeWindow.turnstile) {
      document.querySelectorAll('.cf-turnstile').forEach(el => { try { unsafeWindow.turnstile.execute(el); } catch {} });
    }
    if (type === 'textCaptcha') return await solveTextCaptcha();
    if (type === 'geetest') return await solveGeetest();

    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      if (isSolved(type)) { solvedN++; L.c(`${type} solved`); if (C.autoSubmit) autoSubmit(); return true; }
    }
    failedN++; return false;
  }

  function isSolved(type) {
    if (type === 'recaptcha') return !!document.querySelector('.recaptcha-checkbox[aria-checked="true"]') || !!document.querySelector('.g-recaptcha-response')?.value;
    if (type === 'hcaptcha') return !!document.querySelector('.h-captcha textarea')?.value;
    if (type === 'turnstile') return !document.querySelector('iframe[src*="challenges.cloudflare.com"]');
    return false;
  }

  async function solveTextCaptcha() {
    await loadTesseract();
    if (typeof Tesseract === 'undefined') return false;
    const input = document.querySelector('input[name*="captcha" i], input[id*="captcha" i]');
    const img = document.querySelector('img[src*="captcha" i], img[src*="code" i]');
    if (!input || !img) return false;
    try {
      const { data: { text } } = await Tesseract.recognize(img, C.ocrLang);
      const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
      if (cleaned.length >= 2) {
        input.value = cleaned;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        L.c(`OCR: "${cleaned}"`); solvedN++; return true;
      }
    } catch { }
    failedN++; return false;
  }

  async function solveGeetest() {
    const s = document.querySelector('.geetest_slider_button, .gt_slider_knob');
    if (!s) return false;
    const r = s.getBoundingClientRect();
    const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
    s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: sx, clientY: sy }));
    await sleep(80);
    const tx = sx + 150 + Math.random() * 100;
    for (let i = 1; i <= 25; i++) {
      const p = i / 25, e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      s.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: sx + (tx - sx) * e, clientY: sy }));
      await sleep(25);
    }
    s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: tx, clientY: sy }));
    L.c('GeeTest done'); solvedN++; return true;
  }

  function autoSubmit() {
    const btn = document.querySelector('input[type="submit"], button[type="submit"]');
    if (btn && !btn.disabled) setTimeout(() => click(btn), 500);
  }

  // ====== TESSERACT ======
  async function loadTesseract() {
    if (typeof Tesseract !== 'undefined') return;
    await new Promise(r => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = r; s.onerror = r;
      (document.head || document.documentElement).appendChild(s);
    });
  }

  // ====== MONITOR ======
  function startMonitor() {
    let timer = null;
    const mo = new MutationObserver(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const type = whatAmI();
        if (type) { L.c(`Detected: ${type}`); solveMain(type); }
      }, 1500);
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
  }

  // ====== INIT ======
  function init() {
    const iframeType = inIframe() ? whatAmI() : null;

    if (iframeType) {
      L.c(`=== ${iframeType} iframe ===`);
      if (iframeType === 'recaptcha') solveRecaptchaFrame();
      else if (iframeType === 'hcaptcha') solveHCaptchaFrame();
      else if (iframeType === 'turnstile') solveTurnstileFrame();
      else if (iframeType === 'funcaptcha') solveFunCaptchaFrame();
    } else {
      const pageType = whatAmI();
      if (pageType) {
        L.c(`=== Main: ${pageType} ===`);
        startMonitor();
        solveMain(pageType);
      } else {
        startMonitor();
      }
    }

    window.addEventListener('message', e => {
      if (e.data?.src === 'cs-v4' && e.data.type === 'solved') {
        solvedN++; L.c(`${e.data.captcha} solved!`);
        if (C.autoSubmit) autoSubmit();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  unsafeWindow.CS = {
    solve: solveMain, detect: whatAmI,
    stats: () => ({ solved: solvedN, failed: failedN }),
    runOCR: (img) => typeof Tesseract !== 'undefined' ? Tesseract.recognize(img, C.ocrLang) : null,
  };

})();
