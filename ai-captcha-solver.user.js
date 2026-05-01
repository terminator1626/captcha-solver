// ==UserScript==
// @name         AI Captcha Solver - Free Universal Solver
// @namespace    Terminator.Scripts
// @version      1.0.0
// @description  Free AI captcha solver using Tesseract.js (OCR) + Hugging Face (vision). No API key needed.
// @author       TERMINATOR
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_addElement
// @grant        GM_getResourceText
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      huggingface.co
// @connect      api-inference.huggingface.co
// @connect      cdn.jsdelivr.net
// @run-at       document-start
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @downloadURL  https://github.com/terminator1626/captcha-solver/blob/main/ai-captcha-solver.user.js
// @updateURL    https://github.com/terminator1626/captcha-solver/blob/main/ai-captcha-solver.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    enabled: true,
    autoSolve: true,
    autoSubmit: false,
    solveDelay: { min: 800, max: 2500 },
    humanizeMouse: true,
    humanizeDelay: true,
    notifications: true,
    recaptcha: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 5 },
    hcaptcha: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 5 },
    turnstile: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 3 },
    funcaptcha: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 3 },
    cloudflareChallenge: { enabled: true, autoSolve: true },
    geetest: { enabled: true, autoSolve: true },
    textCaptcha: { enabled: true, autoSolve: true },
    ai: {
      useHuggingFace: true,
      hfModel: 'google/vit-base-patch16-224',
      hfZeroShot: true,
      ocrLanguage: 'eng',
      confidenceThreshold: 0.6,
    },
    bypassIframeDetection: true,
    hookCaptchaAPIs: true,
    logLevel: 'info',
  };

  const Logger = {
    prefix: '[CaptchaSolver]',
    colors: { debug: '#888', info: '#4CAF50', warn: '#FF9800', error: '#F44336', ai: '#00BCD4' },
    _log(level, ...args) {
      const config = getConfig();
      const levels = ['debug', 'info', 'warn', 'error'];
      if (levels.indexOf(level) < levels.indexOf(config.logLevel)) return;
      const style = `color: ${this.colors[level] || '#fff'}; font-weight: bold;`;
      console.log(`%c${this.prefix}`, style, ...args);
    },
    debug(...args) { this._log('debug', ...args); },
    info(...args) { this._log('info', ...args); },
    warn(...args) { this._log('warn', ...args); },
    error(...args) { this._log('error', ...args); },
    ai(...args) { this._log('ai', ...args); },
  };

  function getConfig() {
    try {
      const saved = GM_getValue('captchaSolverConfig', null);
      return saved ? mergeConfig(DEFAULT_CONFIG, saved) : { ...DEFAULT_CONFIG };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function mergeConfig(defaults, overrides) {
    const result = { ...defaults };
    for (const key of Object.keys(overrides)) {
      if (typeof overrides[key] === 'object' && overrides[key] !== null && !Array.isArray(overrides[key])) {
        result[key] = mergeConfig(defaults[key] || {}, overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }

  function setConfig(key, value) {
    const config = getConfig();
    if (key.includes('.')) {
      const parts = key.split('.');
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    } else {
      config[key] = value;
    }
    GM_setValue('captchaSolverConfig', config);
  }

  const Utils = {
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

    async humanDelay(min = 500, max = 2000) {
      if (!getConfig().humanizeDelay) { await this.sleep(min); return; }
      await this.sleep(min + Math.random() * (max - min));
    },

    randomPoint(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * (0.2 + Math.random() * 0.6), y: r.top + r.height * (0.2 + Math.random() * 0.6) };
    },

    async moveMouse(el) {
      if (!getConfig().humanizeMouse) return;
      const pt = this.randomPoint(el);
      for (let i = 0; i < 8; i++) {
        el.dispatchEvent(new MouseEvent('mousemove', {
          clientX: pt.x + (Math.random() - 0.5) * 30,
          clientY: pt.y + (Math.random() - 0.5) * 30,
          bubbles: true, view: window,
        }));
        await this.sleep(15 + Math.random() * 25);
      }
    },

    async clickElement(el) {
      if (!el || el.disabled) { Logger.warn('Element not found or disabled'); return false; }
      await this.moveMouse(el);
      await this.humanDelay(80, 200);
      const pt = this.randomPoint(el);
      for (const type of ['mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window, clientX: pt.x, clientY: pt.y,
        }));
        await this.sleep(30 + Math.random() * 40);
      }
      return true;
    },

    async clickIframe(iframe, selector) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return false;
        const el = doc.querySelector(selector);
        if (!el) return false;
        el.click();
        return true;
      } catch { return false; }
    },

    getIframeDoc(iframe) {
      try { return iframe.contentDocument || iframe.contentWindow?.document; } catch { return null; }
    },

    async runOCR(imageElement) {
      try {
        Logger.ai('Running OCR with Tesseract.js...');
        const config = getConfig();
        const { data: { text } } = await Tesseract.recognize(imageElement, config.ai.ocrLanguage, {
          logger: m => Logger.debug('OCR progress:', m),
        });
        Logger.ai('OCR result:', text.trim());
        return text.trim();
      } catch (e) {
        Logger.error('OCR failed:', e);
        return '';
      }
    },

    async classifyImage(imageSrc, labels) {
      const config = getConfig();
      if (!config.ai.useHuggingFace) return {};

      try {
        Logger.ai('Classifying image with HF:', labels.join(', '));

        const imageBlob = await this.imageSrcToBlob(imageSrc);
        if (!imageBlob) return {};

        if (config.ai.hfZeroShot && labels.length > 0) {
          return await this.hfZeroShotImageClassification(imageBlob, labels);
        }

        return await this.hfImageClassification(imageBlob);
      } catch (e) {
        Logger.error('HF classification failed:', e);
        return {};
      }
    },

    async hfZeroShotImageClassification(imageBlob, candidateLabels) {
      try {
        const response = await this.hfRequest({
          url: `https://api-inference.huggingface.co/models/openai/clip-vit-large-patch14`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputs: { image: await this.blobToBase64(imageBlob) },
            parameters: { candidate_labels: candidateLabels },
          }),
          timeout: 30000,
        });

        if (response.error) {
          Logger.debug('HF error (trying fallback):', response.error);
          return await this.hfFallback(imageBlob, candidateLabels);
        }

        const scores = {};
        if (Array.isArray(response)) {
          for (const item of response) {
            scores[item.label] = item.score;
          }
        } else if (response.scores) {
          for (const s of response.scores) {
            scores[s.label] = s.score;
          }
        }
        Logger.ai('HF scores:', scores);
        return scores;
      } catch (e) {
        Logger.debug('HF zero-shot failed, trying fallback:', e.message);
        return await this.hfFallback(imageBlob, candidateLabels);
      }
    },

    async hfImageClassification(imageBlob) {
      const config = getConfig();
      const response = await this.hfRequest({
        url: `https://api-inference.huggingface.co/models/${config.ai.hfModel}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: imageBlob,
        timeout: 30000,
      });

      if (response.error) return {};

      const scores = {};
      if (Array.isArray(response)) {
        for (const item of response) {
          scores[item.label] = item.score;
        }
      }
      return scores;
    },

    async hfFallback(imageBlob, candidateLabels) {
      try {
        Logger.ai('Using HF fallback model...');
        const response = await this.hfRequest({
          url: 'https://api-inference.huggingface.co/models/google/vit-base-patch16-224',
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: imageBlob,
          timeout: 30000,
        });

        const scores = {};
        if (Array.isArray(response)) {
          for (const item of response) {
            for (const label of candidateLabels) {
              if (item.label.toLowerCase().includes(label.toLowerCase())) {
                scores[label] = item.score;
              }
            }
          }
        }
        return scores;
      } catch {
        return {};
      }
    },

    async hfRequest(options) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          ...options,
          responseType: 'json',
          onload: (res) => {
            try {
              resolve(typeof res.response === 'object' ? res.response : JSON.parse(res.responseText));
            } catch {
              resolve({ error: 'parse_error' });
            }
          },
          onerror: reject,
          ontimeout: () => reject(new Error('HF request timeout')),
        });
      });
    },

    async imageSrcToBlob(src) {
      try {
        if (src.startsWith('data:')) {
          const byteString = atob(src.split(',')[1]);
          const mime = src.split(',')[0].split(':')[1].split(';')[0];
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          return new Blob([ab], { type: mime });
        }

        if (src.startsWith('blob:')) {
          const res = await fetch(src);
          return await res.blob();
        }

        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: src,
            responseType: 'blob',
            onload: (res) => resolve(res.response),
            onerror: reject,
          });
        });
      } catch { return null; }
    },

    async blobToBase64(blob) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    },

    async imageToBase64(img) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 300;
      canvas.height = img.naturalHeight || img.height || 300;
      const ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
      } catch {
        return img.src || null;
      }
    },

    parseChallengeText(text) {
      const textLower = text.toLowerCase();
      const categoryMap = {
        'traffic light': ['traffic lights', 'traffic signal', 'stoplight'],
        'crosswalk': ['crosswalk', 'pedestrian crossing', 'zebra crossing'],
        'bicycle': ['bicycles', 'bike', 'bikes', 'bicycle'],
        'bus': ['buses', 'bus'],
        'car': ['cars', 'car', 'vehicle', 'vehicles'],
        'motorcycle': ['motorcycles', 'motorcycle', 'motorbike', 'motorbikes'],
        'fire hydrant': ['fire hydrant', 'hydrant'],
        'stairs': ['stairs', 'steps', 'staircase'],
        'bridge': ['bridges', 'bridge'],
        'mountain': ['mountains', 'mountain', 'hill'],
        'parking meter': ['parking meter'],
        'fireplug': ['fireplug', 'fire hydrant'],
        'palm tree': ['palm trees', 'palm tree'],
        'taxi': ['taxis', 'taxi', 'cab', 'cabs'],
        'tractor': ['tractors', 'tractor'],
        'bus station': ['bus station'],
        'sidewalk': ['sidewalk', 'pavement'],
        'truck': ['trucks', 'truck'],
        'van': ['vans', 'van'],
        'train': ['trains', 'train', 'subway', 'metro'],
        'boat': ['boats', 'boat', 'ship', 'ships'],
        'airplane': ['airplanes', 'airplane', 'plane', 'planes'],
        'dog': ['dogs', 'dog'],
        'cat': ['cats', 'cat'],
        'horse': ['horses', 'horse'],
        'bird': ['birds', 'bird'],
        'bear': ['bears', 'bear'],
        'elephant': ['elephants', 'elephant'],
        'zebra': ['zebras', 'zebra'],
        'giraffe': ['giraffes', 'giraffe'],
        'stop sign': ['stop sign', 'stop signs'],
        'bench': ['benches', 'bench'],
        'mailbox': ['mailboxes', 'mailbox'],
        'storefront': ['storefronts', 'storefront', 'shop', 'shops'],
        'chimney': ['chimneys', 'chimney'],
        'playground': ['playgrounds', 'playground'],
        'tower': ['towers', 'tower'],
        'fountain': ['fountains', 'fountain'],
        'swimming pool': ['swimming pool', 'pool', 'pools'],
        'garden': ['gardens', 'garden'],
        'beach': ['beaches', 'beach'],
        'desert': ['desert'],
        'snow': ['snow'],
        'water': ['water'],
        'cloud': ['clouds', 'cloud'],
        'building': ['buildings', 'building', 'architecture'],
        'road': ['roads', 'road', 'street', 'streets'],
      };

      for (const [key, aliases] of Object.entries(categoryMap)) {
        if (aliases.some(a => textLower.includes(a))) return key;
      }

      const match = textLower.match(/(?:select|click|tap|choose)\s+(?:all\s+)?(?:the\s+)?(?:images?\s+)?(?:with|of|containing|that\s+(?:show|have|contain))?\s+(.+?)(?:\.|$|,|;|if)/);
      if (match) return match[1].trim().toLowerCase();

      return textLower;
    },

    getCaptchaLabels() {
      return [
        'traffic light', 'crosswalk', 'bicycle', 'bus', 'car', 'motorcycle',
        'fire hydrant', 'stairs', 'bridge', 'mountain', 'parking meter',
        'palm tree', 'taxi', 'tractor', 'sidewalk', 'truck', 'van', 'train',
        'boat', 'airplane', 'dog', 'cat', 'stop sign', 'bench', 'mailbox',
        'storefront', 'chimney', 'playground', 'tower', 'fountain',
        'swimming pool', 'building', 'road', 'water', 'snow',
        'animal', 'vehicle', 'tree', 'person', 'road sign', 'motorway',
      ];
    },

    isSameOriginIframe(iframe) {
      try {
        return !!iframe.contentDocument;
      } catch { return false; }
    },
  };

  const APIHooks = {
    init() {
      if (!getConfig().hookCaptchaAPIs) return;
      const hook = (obj, method, type) => {
        if (!unsafeWindow[obj]) return;
        const orig = unsafeWindow[obj][method];
        if (typeof orig !== 'function') return;
        unsafeWindow[obj][method] = async function (...args) {
          Logger.info(`${type} API call intercepted:`, method, args);
          CaptchaSolver.onCaptchaDetected(type.toLowerCase());
          return orig.apply(this, args);
        };
      };
      hook('grecaptcha', 'execute', 'recaptcha');
      hook('grecaptcha', 'render', 'recaptcha');
      hook('hcaptcha', 'execute', 'hcaptcha');
      hook('hcaptcha', 'render', 'hcaptcha');
      hook('turnstile', 'execute', 'turnstile');
      hook('turnstile', 'render', 'turnstile');
      Logger.debug('API hooks initialized');
    },
  };

  const AICaptchaSolver = {
    async solveImageChallenge(images, challengeText, gridType) {
      Logger.ai('AI solving image challenge:', challengeText);
      const category = Utils.parseChallengeText(challengeText);
      Logger.ai('Detected category:', category);
      const clicked = [];

      if (gridType === 'recaptcha') {
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          try {
            const tile = img.closest('.rc-imageselect-tile') || img.parentElement;
            const tileNum = parseInt(tile?.getAttribute('data-tile-index') || tile?.getAttribute('data-row') || '0');

            let imgSrc = null;
            if (img.src) imgSrc = img.src;
            else {
              const bg = img.style.backgroundImage || getComputedStyle(img).backgroundImage;
              const match = bg?.match(/url\(["']?([^"')]+)["']?\)/);
              if (match) imgSrc = match[1];
            }

            if (!imgSrc) {
              Logger.debug('No image source for tile', i);
              continue;
            }

            const scores = await Utils.classifyImage(imgSrc, [category, ...Utils.getCaptchaLabels()]);
            const score = scores[category] || 0;
            const threshold = getConfig().ai.confidenceThreshold;

            Logger.ai(`Tile ${i}: "${category}" score = ${score.toFixed(3)} (threshold: ${threshold})`);

            if (score >= threshold) {
              Logger.ai('-> CLICKING tile', i);
              await Utils.humanDelay(300, 800);
              await Utils.clickElement(tile || img);
              clicked.push(i);
            }
          } catch (e) {
            Logger.error('Error processing tile', i, e);
          }
        }
      } else if (gridType === 'hcaptcha') {
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          try {
            const taskItem = img.closest('.task-image') || img.closest('[class*="task"]') || img.parentElement;
            let imgSrc = img.src || img.getAttribute('data-src');

            if (!imgSrc && img.style.backgroundImage) {
              const match = img.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
              if (match) imgSrc = match[1];
            }

            if (!imgSrc) continue;

            const scores = await Utils.classifyImage(imgSrc, [category, ...Utils.getCaptchaLabels()]);
            const score = scores[category] || 0;
            const threshold = getConfig().ai.confidenceThreshold;

            Logger.ai(`HCaptcha tile ${i}: "${category}" score = ${score.toFixed(3)}`);

            if (score >= threshold) {
              Logger.ai('-> CLICKING hCaptcha tile', i);
              await Utils.humanDelay(300, 800);
              await Utils.clickElement(taskItem || img);
              clicked.push(i);
            }
          } catch (e) {
            Logger.error('Error processing hCaptcha tile', i, e);
          }
        }
      }

      Logger.ai(`AI clicked ${clicked.length} tiles for "${category}"`);
      return clicked.length > 0;
    },
  };

  const Solvers = {
    async recaptcha() {
      Logger.info('Solving reCAPTCHA...');

      const checkboxFrame = document.querySelector('iframe[src*="recaptcha/api2/anchor"]');
      const challengeFrame = document.querySelector('iframe[src*="recaptcha/api2/bframe"]');

      if (!checkboxFrame && !challengeFrame) {
        Logger.warn('No reCAPTCHA frames found');
        if (unsafeWindow.grecaptcha) {
          for (let i = 0; i < 100; i++) {
            try { unsafeWindow.grecaptcha.execute(i); } catch { }
          }
        }
        return false;
      }

      const config = getConfig();
      let retries = 0;

      while (retries < config.recaptcha.maxRetries) {
        try {
          if (checkboxFrame && !challengeFrame) {
            Logger.info('Clicking reCAPTCHA checkbox...');
            await Utils.humanDelay(1000, 2000);
            await Utils.clickIframe(checkboxFrame, '.recaptcha-checkbox, .recaptcha-checkbox-holder, .recaptcha-checkbox-checked');
            await Utils.humanDelay(2000, 4000);

            if (this.isRecaptchaSolved()) return true;

            await Utils.sleep(2000);
          }

          const currentChallenge = document.querySelector('iframe[src*="recaptcha/api2/bframe"]');
          if (currentChallenge) {
            const solved = await this.solveRecaptchaChallenge(currentChallenge);
            if (solved) return true;
          }

          retries++;
          if (!config.recaptcha.retryOnFail) break;
          await Utils.humanDelay(2000, 4000);
        } catch (e) {
          Logger.error('reCAPTCHA error:', e);
          retries++;
          await Utils.humanDelay(3000, 5000);
        }
      }

      return this.isRecaptchaSolved();
    },

    async solveRecaptchaChallenge(frame) {
      try {
        const doc = Utils.getIframeDoc(frame);
        if (!doc) {
          Logger.warn('Cannot access reCAPTCHA challenge frame (cross-origin)');
          return await this.solveRecaptchaExternal();
        }

        const instructions = doc.querySelector('.rc-imageselect-instructions, .rc-imageselect-dynamic-selector, #rc-imageselect-target');
        if (instructions) {
          Logger.info('Challenge:', instructions.textContent.trim());

          const images = doc.querySelectorAll('.rc-imageselect-tile img, .rc-imageselect-table img');
          if (images.length > 0) {
            Logger.info(`Found ${images.length} tiles, using AI to solve...`);
            const success = await AICaptchaSolver.solveImageChallenge(Array.from(images), instructions.textContent, 'recaptcha');

            if (success) {
              await Utils.humanDelay(1500, 3000);

              const verifyBtn = doc.querySelector('#recaptcha-verify-button');
              if (verifyBtn && !verifyBtn.disabled) {
                Logger.info('Clicking Verify...');
                await Utils.humanDelay(500, 1000);
                verifyBtn.click();
              }

              await Utils.humanDelay(2000, 4000);
              return true;
            }
          }
        }

        if (this.isRecaptchaSolved()) return true;
        return false;
      } catch (e) {
        Logger.error('reCAPTCHA challenge error:', e);
        return false;
      }
    },

    async solveRecaptchaExternal() {
      Logger.info('Trying external reCAPTCHA approach...');
      try {
        const frames = document.querySelectorAll('iframe[src*="recaptcha"]');
        for (const frame of frames) {
          try {
            const doc = Utils.getIframeDoc(frame);
            if (doc) {
              const checkbox = doc.querySelector('.recaptcha-checkbox');
              if (checkbox) { checkbox.click(); return true; }
              const verify = doc.querySelector('#recaptcha-verify-button');
              if (verify) { verify.click(); return true; }
            }
          } catch { }
        }

        if (unsafeWindow.grecaptcha) {
          for (let i = 0; i < 100; i++) {
            try { unsafeWindow.grecaptcha.execute(i); } catch { }
          }
        }
        return false;
      } catch (e) {
        Logger.error('External approach failed:', e);
        return false;
      }
    },

    isRecaptchaSolved() {
      return !!document.querySelector('.recaptcha-checkbox[aria-checked="true"]') ||
        !!document.querySelector('.g-recaptcha-response')?.value ||
        !document.querySelector('iframe[src*="recaptcha/api2/bframe"]') ||
        document.querySelectorAll('iframe[src*="recaptcha/api2/bframe"]').length === 0;
    },

    async hcaptcha() {
      Logger.info('Solving hCaptcha...');

      const anchorFrame = document.querySelector('iframe[src*="hcaptcha.com/captcha"][src*="frame=anchor"]');
      const challengeFrame = document.querySelector('iframe[src*="hcaptcha.com/captcha"][src*="frame=challenge"]');

      if (!anchorFrame && !challengeFrame) {
        Logger.warn('No hCaptcha frames found');
        if (unsafeWindow.hcaptcha) {
          try { unsafeWindow.hcaptcha.execute(); } catch { }
        }
        return false;
      }

      const config = getConfig();
      let retries = 0;

      while (retries < config.hcaptcha.maxRetries) {
        try {
          if (challengeFrame) {
            const solved = await this.solveHCaptchaChallenge(challengeFrame);
            if (solved) return true;
          }

          if (anchorFrame && !challengeFrame) {
            Logger.info('Triggering hCaptcha via checkbox...');
            await Utils.humanDelay(1000, 2000);
            await Utils.clickIframe(anchorFrame, '.check, .checkbox, [class*="check"]');

            if (unsafeWindow.hcaptcha) {
              try { unsafeWindow.hcaptcha.execute(); } catch { }
            }

            await Utils.humanDelay(3000, 5000);

            const newChallenge = document.querySelector('iframe[src*="hcaptcha.com/captcha"][src*="frame=challenge"]');
            if (newChallenge) {
              const solved = await this.solveHCaptchaChallenge(newChallenge);
              if (solved) return true;
            }
          }

          retries++;
          if (!config.hcaptcha.retryOnFail) break;
          await Utils.humanDelay(2000, 4000);
        } catch (e) {
          Logger.error('hCaptcha error:', e);
          retries++;
          await Utils.humanDelay(3000, 5000);
        }
      }

      return this.isHCaptchaSolved();
    },

    async solveHCaptchaChallenge(frame) {
      try {
        const doc = Utils.getIframeDoc(frame);
        if (!doc) {
          Logger.warn('Cannot access hCaptcha challenge frame');
          return false;
        }

        const instruction = doc.querySelector('.prompt-text, .challenge-text, [class*="prompt"], [class*="instruction"], #prompt');
        if (instruction) {
          Logger.info('hCaptcha task:', instruction.textContent.trim());

          const images = doc.querySelectorAll('.task-image img, .task-image [class*="image"], [class*="task"] img');
          if (images.length > 0) {
            Logger.info(`Found ${images.length} hCaptcha tiles, using AI...`);
            const success = await AICaptchaSolver.solveImageChallenge(Array.from(images), instruction.textContent, 'hcaptcha');

            if (success) {
              await Utils.humanDelay(1500, 3000);

              const verifyBtn = doc.querySelector('.verify-button, .submit-button, [class*="verify"], [class*="submit"]');
              if (verifyBtn) {
                Logger.info('Clicking hCaptcha Verify...');
                await Utils.humanDelay(500, 1000);
                verifyBtn.click();
              }

              await Utils.humanDelay(2000, 4000);
              return true;
            }
          }
        }

        if (this.isHCaptchaSolved()) return true;
        return false;
      } catch (e) {
        Logger.error('hCaptcha challenge error:', e);
        return false;
      }
    },

    isHCaptchaSolved() {
      return !!document.querySelector('.h-captcha textarea:valid, .h-captcha [name="h-captcha-response"]:valid')?.value ||
        document.querySelector('iframe[src*="hcaptcha"]') === null;
    },

    async turnstile() {
      Logger.info('Solving Cloudflare Turnstile...');
      try {
        const widget = document.querySelector('iframe[src*="challenges.cloudflare.com/turnstile"]');
        if (!widget) {
          if (unsafeWindow.turnstile) {
            const containers = document.querySelectorAll('.cf-turnstile, [class*="turnstile"]');
            containers.forEach(c => {
              try {
                const key = c.getAttribute('data-sitekey');
                if (key) unsafeWindow.turnstile.execute(c, { sitekey: key });
              } catch { }
            });
          }
          return false;
        }

        await Utils.humanDelay(1500, 3000);

        try {
          const doc = Utils.getIframeDoc(widget);
          if (doc) {
            const clickTarget = doc.querySelector('#challenge-stage, .turnstile-checkbox, input[type="checkbox"]');
            if (clickTarget) {
              Logger.info('Clicking Turnstile checkbox...');
              clickTarget.click();
              await Utils.humanDelay(3000, 6000);
              return this.isTurnstileSolved();
            }
          }
        } catch { }

        if (unsafeWindow.turnstile) {
          try {
            for (const el of document.querySelectorAll('[class*="cf-turnstile"], [class*="turnstile"]')) {
              unsafeWindow.turnstile.execute(el);
            }
          } catch { }
        }

        await Utils.humanDelay(4000, 8000);
        return this.isTurnstileSolved();
      } catch (e) {
        Logger.error('Turnstile error:', e);
        return false;
      }
    },

    isTurnstileSolved() {
      return document.querySelector('.cf-turnstile > div > div > span[role="status"]:not(:empty)') ||
        document.querySelector('iframe[src*="challenges.cloudflare.com"]') === null ||
        document.querySelector('[data-turnstile-success]') !== null ||
        document.querySelector('.cf-turnstile iframe') === null;
    },

    async funcaptcha() {
      Logger.info('Solving FunCaptcha...');
      try {
        const gameFrame = document.querySelector('iframe[src*="funcaptcha.com"], iframe[src*="arkoselabs.com"], iframe[src*="arkose.com"]');
        if (!gameFrame) return false;

        await Utils.humanDelay(2000, 4000);

        try {
          const doc = Utils.getIframeDoc(gameFrame);
          if (doc) {
            const playBtn = doc.querySelector('.play_button, .start-button, button[class*="start"], #start');
            if (playBtn) { playBtn.click(); Logger.info('Clicked FunCaptcha start'); }

            const slider = doc.querySelector('input[type="range"], .slider');
            if (slider) {
              for (let i = 0; i < 3; i++) {
                slider.value = Math.random() * 360;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
                await Utils.humanDelay(500, 1000);
              }
              const submit = doc.querySelector('.submit_button, .submit-button');
              if (submit) submit.click();
            }
          }
        } catch { }

        return this.isFunCaptchaSolved();
      } catch (e) {
        Logger.error('FunCaptcha error:', e);
        return false;
      }
    },

    isFunCaptchaSolved() {
      return document.querySelector('iframe[src*="funcaptcha"]') === null;
    },

    async cloudflareChallenge() {
      Logger.info('Bypassing Cloudflare Challenge...');
      const isChallenge = document.title.includes('Just a moment') ||
        document.title.includes('Attention Required') ||
        document.querySelector('#challenge-body, #challenge-stage, #cf-challenge') !== null ||
        document.querySelector('form[action*="cdn-cgi/challenge-platform"]') !== null;

      if (!isChallenge) return false;

      try {
        await Utils.sleep(8000);
        const stillOnChallenge = document.title.includes('Just a moment') ||
          document.querySelector('#challenge-stage') !== null;

        if (stillOnChallenge) {
          for (const btn of document.querySelectorAll('button, input[type="submit"], a.button')) {
            if (/continue|verify|proceed/i.test(btn.textContent)) {
              await Utils.clickElement(btn);
              Logger.info('Clicked continue');
              break;
            }
          }
        }
        return !stillOnChallenge;
      } catch (e) {
        Logger.error('Cloudflare error:', e);
        return false;
      }
    },

    async geetest() {
      Logger.info('Solving GeeTest...');
      try {
        const slider = document.querySelector('.geetest_slider_button, .gt_slider_knob, [class*="slider"]');
        if (slider) {
          await Utils.humanDelay(1000, 2000);
          const rect = slider.getBoundingClientRect();
          const startX = rect.left + rect.width / 2;
          const startY = rect.top + rect.height / 2;

          slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }));
          await Utils.sleep(100);

          const targetX = startX + 150 + Math.random() * 100;
          for (let i = 1; i <= 25; i++) {
            const p = i / 25;
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            slider.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true, clientX: startX + (targetX - startX) * ease,
              clientY: startY + (Math.random() - 0.5) * 5,
            }));
            await Utils.sleep(25 + Math.random() * 15);
          }

          slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: targetX, clientY: startY }));
          Logger.info('GeeTest slider completed');
          return true;
        }

        const btn = document.querySelector('.geetest_radar_tip, .gt_panel');
        if (btn) { await Utils.clickElement(btn); return true; }
        return false;
      } catch (e) {
        Logger.error('GeeTest error:', e);
        return false;
      }
    },

    async textCaptcha() {
      Logger.info('Solving text captcha with OCR...');
      try {
        const input = document.querySelector('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[name*="verification" i], input[name*="security_code" i]');
        if (!input) return false;

        const img = document.querySelector('img[src*="captcha" i], img[src*="captchaImage" i], img[src*="code" i], img[src*="verify" i], img[id*="captcha" i], img[name*="captcha" i]');
        if (!img) return false;

        Logger.ai('Found text captcha, running OCR...');
        const text = await Utils.runOCR(img);
        if (!text) return false;

        const cleaned = text.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
        Logger.ai('Cleaned OCR text:', cleaned);

        if (cleaned.length > 0) {
          input.value = cleaned;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          Logger.info('Filled captcha with:', cleaned);
          return true;
        }
        return false;
      } catch (e) {
        Logger.error('Text captcha error:', e);
        return false;
      }
    },
  };

  const CaptchaSolver = {
    isSolving: false,
    solvedCount: 0,
    failedCount: 0,
    observer: null,

    init() {
      Logger.info('AI Captcha Solver v2.0 initialized');
      Logger.info('Tesseract.js OCR: loaded');
      Logger.info('Hugging Face AI:', getConfig().ai.useHuggingFace ? 'enabled' : 'disabled');
      APIHooks.init();
      this.startMonitoring();
      this.checkForExistingCaptchas();
    },

    detectCaptcha() {
      const results = [];
      if (document.querySelector('.g-recaptcha, iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net"], iframe[src*="recaptcha/api2"]')) results.push('recaptcha');
      if (document.querySelector('.h-captcha, iframe[src*="hcaptcha.com"]')) results.push('hcaptcha');
      if (document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com/turnstile"]')) results.push('turnstile');
      if (document.querySelector('iframe[src*="funcaptcha.com"], iframe[src*="arkoselabs.com"], iframe[src*="arkose.com"]')) results.push('funcaptcha');
      if (document.querySelector('.geetest, iframe[src*="geetest.com"]')) results.push('geetest');
      if (document.title.includes('Just a moment') || document.title.includes('Attention Required') || document.querySelector('#challenge-stage, #cf-challenge')) results.push('cloudflareChallenge');
      if (document.querySelector('input[name*="captcha" i], input[id*="captcha" i]') && document.querySelector('img[src*="captcha" i], img[src*="code" i]')) results.push('textCaptcha');
      return results;
    },

    async solve(captchaType) {
      if (this.isSolving || !getConfig().enabled) return false;
      const config = getConfig()[captchaType];
      if (!config?.enabled) { Logger.debug(`${captchaType} disabled`); return false; }

      this.isSolving = true;
      Logger.info(`Solving ${captchaType}...`);

      try {
        await Utils.humanDelay(getConfig().solveDelay.min, getConfig().solveDelay.max);
        const result = await Solvers[captchaType]?.();

        if (result) {
          this.solvedCount++;
          Logger.info(`${captchaType} solved! (${this.solvedCount} total)`);
          if (getConfig().notifications) {
            GM_notification({ text: `${captchaType} solved!`, title: 'AI Captcha Solver', timeout: 3000 });
          }
          if (getConfig().autoSubmit) this.autoSubmitForm();
        } else {
          this.failedCount++;
          Logger.warn(`${captchaType} not solved`);
        }
        this.updatePanelStats();
        return result;
      } catch (e) {
        this.failedCount++;
        Logger.error(`${captchaType} error:`, e);
        return false;
      } finally {
        this.isSolving = false;
      }
    },

    onCaptchaDetected(type) {
      if (getConfig().autoSolve) this.solve(type);
    },

    async checkForExistingCaptchas() {
      for (const type of this.detectCaptcha()) {
        if (getConfig().autoSolve) await this.solve(type);
      }
    },

    startMonitoring() {
      this.observer = new MutationObserver((mutations) => {
        let changed = false;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'IFRAME' && /recaptcha|hcaptcha|turnstile|funcaptcha|arkose|geetest|captcha/i.test(node.src || '')) {
              changed = true; break;
            }
            if (node.querySelector?.('.g-recaptcha, .h-captcha, .cf-turnstile, .geetest, [class*="captcha"]')) {
              changed = true; break;
            }
          }
          if (changed) break;
        }
        if (changed) {
          Logger.debug('New captcha detected via DOM');
          Utils.humanDelay(500, 1500).then(() => this.checkForExistingCaptchas());
        }
      });
      this.observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    },

    autoSubmitForm() {
      const btn = document.querySelector('input[type="submit"], button[type="submit"], .submit-button, button.submit');
      if (btn && !btn.disabled) {
        Utils.humanDelay(500, 1500).then(() => { Utils.clickElement(btn); Logger.info('Form auto-submitted'); });
      }
    },

    updatePanelStats() {
      const solvedEl = document.getElementById('cs-solved-count');
      const failedEl = document.getElementById('cs-failed-count');
      if (solvedEl) solvedEl.textContent = this.solvedCount;
      if (failedEl) failedEl.textContent = this.failedCount;
    },
  };

  const ControlPanel = {
    init() {
      this.injectStyles();
      this.createPanel();
    },

    injectStyles() {
      GM_addStyle(`
        #cs-panel { position:fixed; top:10px; right:10px; z-index:2147483647; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12px; }
        #cs-toggle { width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,#667eea,#764ba2); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 15px rgba(102,126,234,.4); color:#fff; font-size:18px; transition:transform .2s; }
        #cs-toggle:hover { transform:scale(1.1); }
        #cs-content { display:none; position:absolute; top:50px; right:0; width:260px; background:#1a1a2e; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.5); color:#fff; overflow:hidden; }
        #cs-content.open { display:block; }
        #cs-content .hdr { background:linear-gradient(135deg,#667eea,#764ba2); padding:12px 15px; display:flex; justify-content:space-between; align-items:center; }
        #cs-content .hdr h3 { margin:0; font-size:13px; }
        #cs-content .body { padding:12px; max-height:400px; overflow-y:auto; }
        #cs-content .stat { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.1); }
        #cs-content .row { display:flex; justify-content:space-between; align-items:center; padding:5px 0; }
        #cs-content .sw { position:relative; width:36px; height:20px; flex-shrink:0; }
        #cs-content .sw input { opacity:0; width:0; height:0; }
        #cs-content .sw .sl { position:absolute; inset:0; background:#444; border-radius:20px; cursor:pointer; transition:.3s; }
        #cs-content .sw .sl::before { position:absolute; content:""; height:14px; width:14px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.3s; }
        #cs-content .sw input:checked+.sl { background:#667eea; }
        #cs-content .sw input:checked+.sl::before { transform:translateX(16px); }
        #cs-content .btn { width:100%; padding:8px; margin-top:8px; background:linear-gradient(135deg,#667eea,#764ba2); border:none; border-radius:6px; color:#fff; cursor:pointer; font-weight:700; font-size:12px; }
        #cs-content .btn:hover { opacity:.9; }
        #cs-content .dot { width:8px; height:8px; border-radius:50%; display:inline-block; }
        #cs-content .dot.on { background:#4CAF50; box-shadow:0 0 8px #4CAF50; }
        #cs-content .dot.off { background:#F44336; }
        #cs-content .label { font-size:11px; color:#aaa; margin-top:6px; }
      `);
    },

    createPanel() {
      const c = document.createElement('div');
      c.id = 'cs-panel';
      c.innerHTML = `
        <button id="cs-toggle" title="AI Captcha Solver">&#9968;</button>
        <div id="cs-content">${this.html()}</div>`;
      c.querySelector('#cs-toggle').onclick = () => c.querySelector('#cs-content').classList.toggle('open');

      const add = () => { document.body.appendChild(c); this.bind(); };
      document.body ? add() : new MutationObserver((_, obs) => { if (document.body) { obs.disconnect(); add(); } }).observe(document.documentElement, { childList: true });
    },

    html() {
      const cfg = getConfig();
      const t = (id, label, checked) => `<div class="row"><span>${label}</span><label class="sw"><input type="checkbox" id="cs-${id}" ${checked ? 'checked' : ''}><span class="sl"></span></label></div>`;
      return `
        <div class="hdr"><h3>&#9968; AI Captcha Solver v2</h3><span class="dot ${cfg.enabled ? 'on' : 'off'}"></span></div>
        <div class="body">
          ${t('enabled', 'Enabled', cfg.enabled)}
          ${t('autosolve', 'Auto Solve', cfg.autoSolve)}
          ${t('autosubmit', 'Auto Submit', cfg.autoSubmit)}
          <div class="stat"><span>Solved</span><span id="cs-solved-count">0</span></div>
          <div class="stat"><span>Failed</span><span id="cs-failed-count">0</span></div>
          ${t('recaptcha', 'reCAPTCHA', cfg.recaptcha.enabled)}
          ${t('hcaptcha', 'hCaptcha', cfg.hcaptcha.enabled)}
          ${t('turnstile', 'Turnstile', cfg.turnstile.enabled)}
          ${t('funcaptcha', 'FunCaptcha', cfg.funcaptcha.enabled)}
          ${t('geetest', 'GeeTest', cfg.geetest.enabled)}
          ${t('textcaptcha', 'Text OCR', cfg.textCaptcha.enabled)}
          <div class="label">AI: ${cfg.ai.useHuggingFace ? 'Hugging Face + Tesseract' : 'Disabled'}</div>
          <button class="btn" id="cs-solve-now">&#9889; Solve Now</button>
        </div>`;
    },

    bind() {
      const b = (id, fn) => document.getElementById(id)?.addEventListener('change', fn);
      b('cs-enabled', e => setConfig('enabled', e.target.checked));
      b('cs-autosolve', e => setConfig('autoSolve', e.target.checked));
      b('cs-autosubmit', e => setConfig('autoSubmit', e.target.checked));
      b('cs-recaptcha', e => { const c = getConfig(); c.recaptcha.enabled = e.target.checked; GM_setValue('captchaSolverConfig', c); });
      b('cs-hcaptcha', e => { const c = getConfig(); c.hcaptcha.enabled = e.target.checked; GM_setValue('captchaSolverConfig', c); });
      b('cs-turnstile', e => { const c = getConfig(); c.turnstile.enabled = e.target.checked; GM_setValue('captchaSolverConfig', c); });
      b('cs-funcaptcha', e => { const c = getConfig(); c.funcaptcha.enabled = e.target.checked; GM_setValue('captchaSolverConfig', c); });
      b('cs-geetest', e => { const c = getConfig(); c.geetest.enabled = e.target.checked; GM_setValue('captchaSolverConfig', c); });
      b('cs-textcaptcha', e => { const c = getConfig(); c.textCaptcha.enabled = e.target.checked; GM_setValue('captchaSolverConfig', c); });
      document.getElementById('cs-solve-now')?.addEventListener('click', () => CaptchaSolver.checkForExistingCaptchas());
    },
  };

  function init() {
    CaptchaSolver.init();
    ControlPanel.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  unsafeWindow.CaptchaSolver = {
    solve: (t) => CaptchaSolver.solve(t),
    detect: () => CaptchaSolver.detectCaptcha(),
    getConfig: () => getConfig(),
    setConfig: (k, v) => setConfig(k, v),
    stats: () => ({ solved: CaptchaSolver.solvedCount, failed: CaptchaSolver.failedCount }),
    runOCR: (img) => Utils.runOCR(img),
    classifyImage: (src, labels) => Utils.classifyImage(src, labels),
  };

})();
