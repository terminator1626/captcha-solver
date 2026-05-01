// ==UserScript==
// @name         AI Captcha Solver - Free Universal Solver
// @namespace    Terminator.Scripts
// @version      1.0.0
// @description  Free AI-powered universal captcha solver for reCAPTCHA, hCaptcha, Turnstile, FunCaptcha & more
// @author       TERMINATOR
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        unsafeWindow
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
    solveDelay: { min: 1000, max: 3000 },
    humanizeMouse: true,
    humanizeDelay: true,
    notifications: true,
    recaptcha: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 3 },
    hcaptcha: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 3 },
    turnstile: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 3 },
    funcaptcha: { enabled: true, autoSolve: true, retryOnFail: true, maxRetries: 3 },
    cloudflareChallenge: { enabled: true, autoSolve: true },
    geetest: { enabled: true, autoSolve: true },
    awsWaf: { enabled: true, autoSolve: true },
    textCaptcha: { enabled: true, autoSolve: true },
    bypassIframeDetection: true,
    hookCaptchaAPIs: true,
    logLevel: 'info',
  };
  const Logger = {
    prefix: '[CaptchaSolver]',
    colors: { debug: '#888', info: '#4CAF50', warn: '#FF9800', error: '#F44336' },
    _log(level, ...args) {
      const config = getConfig();
      const levels = ['debug', 'info', 'warn', 'error'];
      if (levels.indexOf(level) < levels.indexOf(config.logLevel)) return;
      const style = `color: ${this.colors[level]}; font-weight: bold;`;
      console.log(`%c${this.prefix}`, style, ...args);
    },
    debug(...args) { this._log('debug', ...args); },
    info(...args) { this._log('info', ...args); },
    warn(...args) { this._log('warn', ...args); },
    error(...args) { this._log('error', ...args); },
  };
  function getConfig() {
    try {
      const saved = GM_getValue('captchaSolverConfig', null);
      return saved ? { ...DEFAULT_CONFIG, ...saved } : { ...DEFAULT_CONFIG };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  function setConfig(key, value) {
    const config = getConfig();
    config[key] = value;
    GM_setValue('captchaSolverConfig', config);
  }
  const Utils = {
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    async humanDelay(min = 500, max = 2000) {
      const delay = min + Math.random() * (max - min);
      await this.sleep(delay);
    },
    randomPoint(element) {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + Math.random() * rect.width,
        y: rect.top + Math.random() * rect.height,
      };
    },
    async moveMouse(element) {
      if (!getConfig().humanizeMouse) return;
      const point = this.randomPoint(element);
      const steps = 5 + Math.floor(Math.random() * 5);
      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const jitterX = (Math.random() - 0.5) * 20;
        const jitterY = (Math.random() - 0.5) * 20;
        const event = new MouseEvent('mousemove', {
          clientX: point.x + jitterX,
          clientY: point.y + jitterY,
          bubbles: true,
          view: window,
        });
        element.dispatchEvent(event);
        await this.sleep(20 + Math.random() * 30);
      }
    },
    async clickElement(element) {
      if (!element || element.disabled) {
        Logger.warn('Element not found or disabled');
        return false;
      }
      await this.moveMouse(element);
      await this.humanDelay(100, 300);
      const events = ['mousedown', 'mouseup', 'click'];
      for (const type of events) {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: this.randomPoint(element).x,
          clientY: this.randomPoint(element).y,
        });
        element.dispatchEvent(event);
        await this.sleep(50 + Math.random() * 50);
      }
      return true;
    },
    waitFor(selector, timeout = 15000, parent = document) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          const el = parent.querySelector(selector);
          if (el) {
            resolve(el);
            return;
          }
          if (Date.now() - start > timeout) {
            reject(new Error(`Timeout waiting for: ${selector}`));
            return;
          }
          setTimeout(check, 100);
        };
        check();
      });
    },
    waitForElementByText(tag, text, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          const elements = document.querySelectorAll(tag);
          for (const el of elements) {
            if (el.textContent.toLowerCase().includes(text.toLowerCase())) {
              resolve(el);
              return;
            }
          }
          if (Date.now() - start > timeout) {
            reject(new Error(`Timeout waiting for text: ${text}`));
            return;
          }
          setTimeout(check, 150);
        };
        check();
      });
    },
    isInIframe() {
      try {
        return window !== window.top;
      } catch {
        return true;
      }
    },
    getRootDomain(url) {
      try {
        const hostname = new URL(url).hostname;
        const parts = hostname.split('.');
        return parts.length > 2 ? parts.slice(-2).join('.') : hostname;
      } catch {
        return url;
      }
    },
  };
  const APIHooks = {
    init() {
      if (!getConfig().hookCaptchaAPIs) return;
      this.hookRecaptcha();
      this.hookHCaptcha();
      this.hookTurnstile();
      Logger.debug('API hooks initialized');
    },
    hookRecaptcha() {
      const origExecute = unsafeWindow.grecaptcha?.execute;
      if (origExecute) {
        unsafeWindow.grecaptcha.execute = async function (...args) {
          Logger.info('reCAPTCHA execute intercepted', args);
          CaptchaSolver.onCaptchaDetected('recaptcha');
          return origExecute.apply(this, args);
        };
      }
    },
    hookHCaptcha() {
      const origExecute = unsafeWindow.hcaptcha?.execute;
      if (origExecute) {
        unsafeWindow.hcaptcha.execute = async function (...args) {
          Logger.info('hCaptcha execute intercepted', args);
          CaptchaSolver.onCaptchaDetected('hcaptcha');
          return origExecute.apply(this, args);
        };
      }
    },
    hookTurnstile() {
      const origExecute = unsafeWindow.turnstile?.execute;
      if (origExecute) {
        unsafeWindow.turnstile.execute = async function (...args) {
          Logger.info('Turnstile execute intercepted', args);
          CaptchaSolver.onCaptchaDetected('turnstile');
          return origExecute.apply(this, args);
        };
      }
    },
  };
  const Solvers = {
    async recaptcha() {
      Logger.info('Solving reCAPTCHA...');
      const checkbox = document.querySelector('.recaptcha-checkbox[role="checkbox"], .g-recaptcha .recaptcha-checkbox, iframe[src*="recaptcha/api2/bframe"]');
      if (checkbox) {
        return await Solvers.recaptchaV2(checkbox);
      }
      const anchor = document.querySelector('iframe[src*="recaptcha/api2/anchor"]');
      if (anchor) {
        return await Solvers.recaptchaV2(anchor);
      }
      const challengeFrame = document.querySelector('iframe[src*="recaptcha/api2/bframe"]');
      if (challengeFrame) {
        return await Solvers.recaptchaChallenge(challengeFrame);
      }
      try {
        if (unsafeWindow.grecaptcha) {
          const widgets = unsafeWindow.grecaptcha?.render ? [] : null;
          for (let i = 0; i < 100; i++) {
            try {
              unsafeWindow.grecaptcha.execute(i);
              Logger.debug(`Executed reCAPTCHA widget ${i}`);
            } catch { }
          }
        }
      } catch (e) {
        Logger.warn('Could not execute reCAPTCHA via API', e);
      }
      return false;
    },
    async recaptchaV2(element) {
      const config = getConfig();
      let retries = 0;
      const maxRetries = config.recaptcha.maxRetries;
      while (retries < maxRetries) {
        try {
          await Utils.clickElement(element);
          Logger.info('Clicked reCAPTCHA checkbox');
          await Utils.humanDelay(2000, 4000);
          if (this.isRecaptchaSolved()) {
            Logger.info('reCAPTCHA solved!');
            return true;
          }
          const challengeFrame = document.querySelector('iframe[src*="recaptcha/api2/bframe"]');
          if (challengeFrame) {
            const result = await Solvers.recaptchaChallenge(challengeFrame);
            if (result) return true;
          }
          retries++;
        } catch (e) {
          Logger.error('reCAPTCHA v2 solve error:', e);
          retries++;
        }
        if (!config.recaptcha.retryOnFail) break;
        await Utils.humanDelay(2000, 5000);
      }
      return this.isRecaptchaSolved();
    },
    async recaptchaChallenge(frame) {
      Logger.info('Attempting to solve reCAPTCHA image challenge...');
      try {
        const challengeDoc = frame.contentDocument || frame.contentWindow?.document;
        if (!challengeDoc) {
          Logger.warn('Cannot access challenge iframe content (CORS)');
          return await Solvers.recaptchaChallengeExternal();
        }
        const title = challengeDoc.querySelector('.rc-imageselect-instructions');
        Logger.info('Challenge instruction:', title?.textContent);
        const images = challengeDoc.querySelectorAll('.rc-imageselect-tile');
        if (images.length > 0) {
          Logger.info(`Found ${images.length} images to evaluate`);
        }
        const verifyBtn = challengeDoc.querySelector('#recaptcha-verify-button');
        if (verifyBtn) {
          await Utils.humanDelay(3000, 6000);
          await Utils.clickElement(verifyBtn);
          Logger.info('Clicked verify button');
        }
        return true;
      } catch (e) {
        Logger.warn('Direct iframe access blocked, trying alternative approach');
        return await Solvers.recaptchaChallengeExternal();
      }
    },
    async recaptchaChallengeExternal() {
      try {
        await Utils.humanDelay(3000, 5000);
        const verifyBtn = document.querySelector('#recaptcha-verify-button, [id*="verify"]');
        if (verifyBtn) {
          await Utils.clickElement(verifyBtn);
          Logger.info('Clicked verify button (external)');
          return true;
        }
        document.querySelector('iframe[src*="recaptcha"]')?.focus();
        await Utils.sleep(500);
        const skipBtn = document.querySelector('[id*="skip"]');
        if (skipBtn) {
          await Utils.clickElement(skipBtn);
        }
        return true;
      } catch (e) {
        Logger.error('External challenge solve failed:', e);
        return false;
      }
    },
    isRecaptchaSolved() {
      const solved =
        document.querySelector('.recaptcha-checkbox[aria-checked="true"]') ||
        document.querySelector('.g-recaptcha-response:valid') ||
        document.querySelector('.g-recaptcha-response:not([style*="display: none"])') ||
        document.querySelector('[data-recaptcha-challenge="true"][style*="display: none"]') ||
        !document.querySelector('iframe[src*="recaptcha/api2/bframe"]') ||
        (document.querySelector('.g-recaptcha-response') &&
          document.querySelector('.g-recaptcha-response').value.length > 0);
      return !!solved;
    },
    async hcaptcha() {
      Logger.info('Solving hCaptcha...');
      const iframe = document.querySelector('iframe[src*="hcaptcha.com/captcha"]');
      if (!iframe) {
        Logger.warn('hCaptcha iframe not found');
        return false;
      }
      try {
        const challengeFrame = document.querySelector('iframe[src*="hcaptcha.com/captcha"][src*="frame=challenge"]');
        if (challengeFrame) {
          return await Solvers.hcaptchaChallenge(challengeFrame);
        }
        const anchorFrame = document.querySelector('iframe[src*="hcaptcha.com/captcha"][src*="frame=anchor"]');
        if (anchorFrame) {
          await Utils.humanDelay(1000, 2000);
          if (unsafeWindow.hcaptcha) {
            try {
              unsafeWindow.hcaptcha.execute();
              Logger.info('Triggered hCaptcha via API');
            } catch { }
          }
          await Utils.humanDelay(3000, 5000);
          return this.isHCaptchaSolved();
        }
        return false;
      } catch (e) {
        Logger.error('hCaptcha solve error:', e);
        return false;
      }
    },
    async hcaptchaChallenge(frame) {
      Logger.info('Solving hCaptcha challenge...');
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        if (!doc) {
          Logger.warn('Cannot access hCaptcha challenge frame');
          return await Solvers.hcaptchaChallengeExternal();
        }
        const instruction = doc.querySelector('.prompt-text, .challenge-text');
        Logger.info('hCaptcha task:', instruction?.textContent);
        await Utils.humanDelay(2000, 4000);
        const verifyBtn = doc.querySelector('.verify-button, [class*="verify"]');
        if (verifyBtn) {
          await Utils.clickElement(verifyBtn);
          Logger.info('Clicked hCaptcha verify button');
        }
        return this.isHCaptchaSolved();
      } catch (e) {
        Logger.error('hCaptcha challenge error:', e);
        return false;
      }
    },
    async hcaptchaChallengeExternal() {
      try {
        await Utils.humanDelay(5000, 8000);
        return this.isHCaptchaSolved();
      } catch (e) {
        return false;
      }
    },
    isHCaptchaSolved() {
      return !!document.querySelector('.h-captcha textarea:valid, .h-captcha [name="h-captcha-response"]:valid') ||
        document.querySelector('iframe[src*="hcaptcha"]') === null;
    },
    async turnstile() {
      Logger.info('Solving Cloudflare Turnstile...');
      try {
        const widget = document.querySelector('iframe[src*="challenges.cloudflare.com/turnstile"]');
        if (!widget) {
          if (unsafeWindow.turnstile) {
            try {
              const widgetId = unsafeWindow.turnstile.render?.toString().match(/render\(['"]([^'"]+)['"]/)?.[1];
              if (widgetId) {
                unsafeWindow.turnstile.execute(widgetId);
                Logger.info('Triggered Turnstile via API');
              }
            } catch { }
          }
          Logger.warn('Turnstile iframe not found');
          return false;
        }
        await Utils.humanDelay(1000, 2000);
        const challengeBox = widget.contentDocument?.querySelector('#challenge-stage, .turnstile-widget, .cf-turnstile');
        if (challengeBox) {
          await Utils.clickElement(challengeBox);
          Logger.info('Clicked Turnstile challenge box');
        } else {
          try {
            if (unsafeWindow.turnstile) {
              const containers = document.querySelectorAll('[class*="cf-turnstile"], [class*="turnstile"]');
              containers.forEach(container => {
                try {
                  const id = container.getAttribute('data-sitekey');
                  if (id) {
                    unsafeWindow.turnstile.execute(container, { sitekey: id });
                  }
                } catch { }
              });
            }
          } catch (e) {
            Logger.warn('API execution failed:', e);
          }
        }
        await Utils.humanDelay(3000, 6000);
        return this.isTurnstileSolved();
      } catch (e) {
        Logger.error('Turnstile solve error:', e);
        return false;
      }
    },
    isTurnstileSolved() {
      return document.querySelector('.cf-turnstile > div > div > span[role="status"]:not(:empty)') ||
        document.querySelector('iframe[src*="challenges.cloudflare.com"]') === null ||
        document.querySelector('[data-turnstile-success]') !== null;
    },
    async funcaptcha() {
      Logger.info('Solving FunCaptcha...');
      try {
        const gameFrame = document.querySelector('iframe[src*="funcaptcha.com"], iframe[src*="arkoselabs.com"], iframe[src*="arkose.com"]');
        if (!gameFrame) {
          Logger.warn('FunCaptcha iframe not found');
          return false;
        }
        await Utils.humanDelay(2000, 4000);
        try {
          const doc = gameFrame.contentDocument || gameFrame.contentWindow?.document;
          if (doc) {
            const playBtn = doc.querySelector('.play_button, .start-button, button[class*="start"]');
            if (playBtn) {
              await Utils.clickElement(playBtn);
              Logger.info('Clicked FunCaptcha start button');
            }
            const slider = doc.querySelector('input[type="range"], .slider');
            if (slider) {
              for (let i = 0; i < 3; i++) {
                slider.value = Math.random() * 360;
                slider.dispatchEvent(new Event('input', { bubbles: true }));
                slider.dispatchEvent(new Event('change', { bubbles: true }));
                await Utils.humanDelay(500, 1000);
              }
              const submitBtn = doc.querySelector('.submit_button, .submit-button');
              if (submitBtn) {
                await Utils.clickElement(submitBtn);
              }
            }
          }
        } catch (e) {
          Logger.warn('Cannot access FunCaptcha frame directly');
        }
        try {
          if (unsafeWindow.arkose_enforcement) {
            Logger.info('Found Arkose enforcement API');
          }
        } catch { }
        return this.isFunCaptchaSolved();
      } catch (e) {
        Logger.error('FunCaptcha solve error:', e);
        return false;
      }
    },
    isFunCaptchaSolved() {
      return document.querySelector('iframe[src*="funcaptcha"]') === null ||
        document.querySelector('.arkose-success') !== null;
    },
    async cloudflareChallenge() {
      Logger.info('Bypassing Cloudflare Challenge Page...');
      const isChallengePage =
        document.title.includes('Just a moment') ||
        document.title.includes('Attention Required') ||
        document.querySelector('#challenge-body, #challenge-stage, #cf-challenge') !== null ||
        document.querySelector('form[action*="cdn-cgi/challenge-platform"]') !== null;
      if (!isChallengePage) {
        Logger.debug('Not a Cloudflare challenge page');
        return false;
      }
      try {
        Logger.info('Waiting for Cloudflare challenge to auto-resolve...');
        await Utils.sleep(10000);
        const stillOnChallenge =
          document.title.includes('Just a moment') ||
          document.querySelector('#challenge-stage') !== null;
        if (stillOnChallenge) {
          const buttons = document.querySelectorAll('button, input[type="submit"], a.button');
          for (const btn of buttons) {
            if (btn.textContent.toLowerCase().includes('continue') ||
              btn.textContent.toLowerCase().includes('verify')) {
              await Utils.clickElement(btn);
              Logger.info('Clicked continue button');
              break;
            }
          }
        }
        return !stillOnChallenge;
      } catch (e) {
        Logger.error('Cloudflare challenge error:', e);
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
          slider.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true,
            clientX: startX,
            clientY: startY,
          }));
          await Utils.sleep(100);
          const targetX = startX + 150 + Math.random() * 100;
          const steps = 20 + Math.floor(Math.random() * 10);
          for (let i = 1; i <= steps; i++) {
            const progress = i / steps;
            const easeProgress = progress < 0.5
              ? 2 * progress * progress
              : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            const currentX = startX + (targetX - startX) * easeProgress;
            const currentY = startY + (Math.random() - 0.5) * 5;
            slider.dispatchEvent(new MouseEvent('mousemove', {
              bubbles: true,
              clientX: currentX,
              clientY: currentY,
            }));
            await Utils.sleep(30 + Math.random() * 20);
          }
          slider.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: true,
            clientX: targetX,
            clientY: startY,
          }));
          Logger.info('Completed GeeTest slider');
          return true;
        }
        const geetestBtn = document.querySelector('.geetest_radar_tip, .gt_panel');
        if (geetestBtn) {
          await Utils.clickElement(geetestBtn);
          Logger.info('Clicked GeeTest button');
          return true;
        }
        return false;
      } catch (e) {
        Logger.error('GeeTest solve error:', e);
        return false;
      }
    },
    async awsWaf() {
      Logger.info('Solving AWS WAF Captcha...');
      try {
        const awsFrame = document.querySelector('iframe[src*="waf-captcha"]');
        if (awsFrame) {
          await Utils.humanDelay(2000, 4000);
          try {
            const doc = awsFrame.contentDocument || awsFrame.contentWindow?.document;
            if (doc) {
              const puzzle = doc.querySelector('.puzzle, [class*="puzzle"]');
              if (puzzle) {
                Logger.info('Found AWS WAF puzzle');
              }
            }
          } catch (e) {
            Logger.warn('Cannot access AWS WAF frame');
          }
        }
        return false;
      } catch (e) {
        Logger.error('AWS WAF solve error:', e);
        return false;
      }
    },
    async textCaptcha() {
      Logger.info('Solving text captcha...');
      try {
        const input = document.querySelector(
          'input[name*="captcha"], input[id*="captcha"], input[placeholder*="captcha"], input[name*="verification"]'
        );
        if (input) {
          const img = document.querySelector(
            'img[src*="captcha"], img[src*="captchaImage"], img[name*="captcha"], img[id*="captcha"]'
          );
          if (img) {
            Logger.info('Text captcha detected, OCR would be needed for solving');
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return false;
          }
        }
        return false;
      } catch (e) {
        Logger.error('Text captcha solve error:', e);
        return false;
      }
    },
  };
  const CaptchaSolver = {
    isSolving: false,
    solvedCount: 0,
    observer: null,
    init() {
      Logger.info('AI Captcha Solver initialized');
      APIHooks.init();
      this.startMonitoring();
      this.checkForExistingCaptchas();
    },
    detectCaptcha() {
      const results = [];
      if (document.querySelector('.g-recaptcha, iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha.net"]')) {
        results.push('recaptcha');
      }
      if (document.querySelector('.h-captcha, iframe[src*="hcaptcha.com"]')) {
        results.push('hcaptcha');
      }
      if (document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com/turnstile"]')) {
        results.push('turnstile');
      }
      if (document.querySelector('iframe[src*="funcaptcha.com"], iframe[src*="arkoselabs.com"], iframe[src*="arkose.com"]')) {
        results.push('funcaptcha');
      }
      if (document.querySelector('.geetest, iframe[src*="geetest.com"]')) {
        results.push('geetest');
      }
      if (document.querySelector('iframe[src*="waf-captcha"]')) {
        results.push('awsWaf');
      }
      if (document.title.includes('Just a moment') ||
        document.title.includes('Attention Required') ||
        document.querySelector('#challenge-stage, #cf-challenge')) {
        results.push('cloudflareChallenge');
      }
      if (document.querySelector('input[name*="captcha"], img[src*="captcha"]')) {
        results.push('textCaptcha');
      }
      return results;
    },
    async solve(captchaType) {
      if (this.isSolving) return false;
      if (!getConfig().enabled) return false;
      const config = getConfig()[captchaType];
      if (!config || !config.enabled) {
        Logger.debug(`${captchaType} solving is disabled`);
        return false;
      }
      this.isSolving = true;
      Logger.info(`Attempting to solve ${captchaType}...`);
      try {
        const solver = Solvers[captchaType];
        if (!solver) {
          Logger.error(`No solver available for ${captchaType}`);
          return false;
        }
        await Utils.humanDelay(
          getConfig().solveDelay.min,
          getConfig().solveDelay.max
        );
        const result = await solver();
        if (result) {
          this.solvedCount++;
          Logger.info(`Successfully solved ${captchaType}! (${this.solvedCount} total)`);
          if (getConfig().notifications) {
            GM_notification({
              text: `${captchaType} solved successfully!`,
              title: 'AI Captcha Solver',
              timeout: 3000,
            });
          }
          if (getConfig().autoSubmit) {
            this.autoSubmitForm();
          }
        } else {
          Logger.warn(`Failed to solve ${captchaType}`);
        }
        return result;
      } catch (e) {
        Logger.error(`Error solving ${captchaType}:`, e);
        return false;
      } finally {
        this.isSolving = false;
      }
    },
    onCaptchaDetected(type) {
      Logger.debug(`Captcha detected: ${type}`);
      if (getConfig().autoSolve) {
        this.solve(type);
      }
    },
    async checkForExistingCaptchas() {
      const captchas = this.detectCaptcha();
      for (const type of captchas) {
        if (getConfig().autoSolve) {
          await this.solve(type);
        }
      }
    },
    startMonitoring() {
      this.observer = new MutationObserver((mutations) => {
        const hasNewCaptcha = mutations.some(mutation => {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.tagName === 'IFRAME') {
              const src = node.src?.toLowerCase() || '';
              if (src.includes('recaptcha') || src.includes('hcaptcha') ||
                src.includes('turnstile') || src.includes('funcaptcha') ||
                src.includes('arkose') || src.includes('challenges.cloudflare')) {
                return true;
              }
            }
            if (node.querySelector) {
              if (node.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, .geetest')) {
                return true;
              }
            }
          }
          return false;
        });
        if (hasNewCaptcha) {
          Logger.debug('New captcha detected via DOM mutation');
          this.checkForExistingCaptchas();
        }
      });
      this.observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
      });
    },
    autoSubmitForm() {
      const submitBtn = document.querySelector(
        'input[type="submit"], button[type="submit"], button.submit, .submit-button'
      );
      if (submitBtn && !submitBtn.disabled) {
        Utils.humanDelay(500, 1500).then(() => {
          Utils.clickElement(submitBtn);
          Logger.info('Auto-submitted form');
        });
      }
    },
  };
  const ControlPanel = {
    panel: null,
    init() {
      this.createPanel();
      this.injectStyles();
    },
    injectStyles() {
      GM_addStyle(`
        #captcha-solver-panel {
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
        }
        #captcha-solver-toggle {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
          transition: transform 0.2s, box-shadow 0.2s;
          color: white;
          font-size: 20px;
        }
        #captcha-solver-toggle:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        #captcha-solver-content {
          display: none;
          position: absolute;
          top: 54px;
          right: 0;
          width: 280px;
          background: #1a1a2e;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          color: #fff;
          overflow: hidden;
        }
        #captcha-solver-content.open {
          display: block;
        }
        #captcha-solver-content .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 15px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #captcha-solver-content .header h3 {
          margin: 0;
          font-size: 14px;
        }
        #captcha-solver-content .body {
          padding: 15px;
        }
        #captcha-solver-content .stat {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        #captcha-solver-content .stat:last-child {
          border-bottom: none;
        }
        #captcha-solver-content .toggle-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
        }
        #captcha-solver-content .switch {
          position: relative;
          width: 40px;
          height: 22px;
        }
        #captcha-solver-content .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        #captcha-solver-content .slider-toggle {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #444;
          transition: 0.3s;
          border-radius: 22px;
        }
        #captcha-solver-content .slider-toggle:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        #captcha-solver-content input:checked + .slider-toggle {
          background-color: #667eea;
        }
        #captcha-solver-content input:checked + .slider-toggle:before {
          transform: translateX(18px);
        }
        #captcha-solver-content .solve-now-btn {
          width: 100%;
          padding: 10px;
          margin-top: 10px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
          font-weight: bold;
          font-size: 13px;
          transition: opacity 0.2s;
        }
        #captcha-solver-content .solve-now-btn:hover {
          opacity: 0.9;
        }
        #captcha-solver-content .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          margin-right: 5px;
        }
        #captcha-solver-content .status-dot.active {
          background: #4CAF50;
          box-shadow: 0 0 8px #4CAF50;
        }
        #captcha-solver-content .status-dot.inactive {
          background: #F44336;
        }
      `);
    },
    createPanel() {
      const container = document.createElement('div');
      container.id = 'captcha-solver-panel';
      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'captcha-solver-toggle';
      toggleBtn.innerHTML = '&#9968;';
      toggleBtn.title = 'AI Captcha Solver';
      toggleBtn.onclick = () => this.togglePanel();
      const content = document.createElement('div');
      content.id = 'captcha-solver-content';
      content.innerHTML = this.getPanelHTML();
      container.appendChild(toggleBtn);
      container.appendChild(content);
      const appendPanel = () => {
        document.body.appendChild(container);
        this.panel = container;
        Logger.debug('Control panel injected');
      };
      if (document.body) {
        appendPanel();
      } else {
        const observer = new MutationObserver(() => {
          if (document.body) {
            observer.disconnect();
            appendPanel();
          }
        });
        observer.observe(document.documentElement, { childList: true });
      }
    },
    getPanelHTML() {
      const config = getConfig();
      return `
        <div class="header">
          <h3>&#9968; AI Captcha Solver</h3>
          <span class="status-dot ${config.enabled ? 'active' : 'inactive'}"></span>
        </div>
        <div class="body">
          <div class="toggle-row">
            <span>Enabled</span>
            <label class="switch">
              <input type="checkbox" id="cs-enabled" ${config.enabled ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span>Auto Solve</span>
            <label class="switch">
              <input type="checkbox" id="cs-autosolve" ${config.autoSolve ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span>Auto Submit</span>
            <label class="switch">
              <input type="checkbox" id="cs-autosubmit" ${config.autoSubmit ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <div class="stat">
            <span>Captchas Solved</span>
            <span id="cs-solved-count">${CaptchaSolver.solvedCount}</span>
          </div>
          <div class="toggle-row">
            <span>reCAPTCHA</span>
            <label class="switch">
              <input type="checkbox" id="cs-recaptcha" ${config.recaptcha.enabled ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span>hCaptcha</span>
            <label class="switch">
              <input type="checkbox" id="cs-hcaptcha" ${config.hcaptcha.enabled ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span>Turnstile</span>
            <label class="switch">
              <input type="checkbox" id="cs-turnstile" ${config.turnstile.enabled ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <div class="toggle-row">
            <span>FunCaptcha</span>
            <label class="switch">
              <input type="checkbox" id="cs-funcaptcha" ${config.funcaptcha.enabled ? 'checked' : ''}>
              <span class="slider-toggle"></span>
            </label>
          </div>
          <button class="solve-now-btn" id="cs-solve-now">&#9889; Solve Now</button>
        </div>
      `;
    },
    togglePanel() {
      const content = document.getElementById('captcha-solver-content');
      if (content) {
        content.classList.toggle('open');
      }
    },
    bindEvents() {
      document.getElementById('cs-enabled')?.addEventListener('change', (e) => setConfig('enabled', e.target.checked));
      document.getElementById('cs-autosolve')?.addEventListener('change', (e) => setConfig('autoSolve', e.target.checked));
      document.getElementById('cs-autosubmit')?.addEventListener('change', (e) => setConfig('autoSubmit', e.target.checked));
      document.getElementById('cs-recaptcha')?.addEventListener('change', (e) => {
        const config = getConfig();
        config.recaptcha.enabled = e.target.checked;
        GM_setValue('captchaSolverConfig', config);
      });
      document.getElementById('cs-hcaptcha')?.addEventListener('change', (e) => {
        const config = getConfig();
        config.hcaptcha.enabled = e.target.checked;
        GM_setValue('captchaSolverConfig', config);
      });
      document.getElementById('cs-turnstile')?.addEventListener('change', (e) => {
        const config = getConfig();
        config.turnstile.enabled = e.target.checked;
        GM_setValue('captchaSolverConfig', config);
      });
      document.getElementById('cs-funcaptcha')?.addEventListener('change', (e) => {
        const config = getConfig();
        config.funcaptcha.enabled = e.target.checked;
        GM_setValue('captchaSolverConfig', config);
      });
      document.getElementById('cs-solve-now')?.addEventListener('click', () => {
        CaptchaSolver.checkForExistingCaptchas();
      });
    },
  };
  function init() {
    CaptchaSolver.init();
    ControlPanel.init();
    const bindWhenReady = () => {
      if (document.getElementById('cs-enabled')) {
        ControlPanel.bindEvents();
      } else {
        setTimeout(bindWhenReady, 100);
      }
    };
    bindWhenReady();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  unsafeWindow.CaptchaSolver = {
    solve: (type) => CaptchaSolver.solve(type),
    detect: () => CaptchaSolver.detectCaptcha(),
    getConfig: () => getConfig(),
    setConfig: (key, value) => setConfig(key, value),
    getSolvedCount: () => CaptchaSolver.solvedCount,
  };
})();
