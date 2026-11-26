// The page in a real browser: headless Chrome, driven over its debugging socket
// with nothing but Node (no dependency).   node tests/browser.mjs
//
// One whole contribution is run at 390, 820 and 1440 px wide, each in a clean
// browser profile, WITH THE NETWORK OFF once the page has loaded.
// Set SHOTS=<folder> to keep screenshots. Set CHROME=<path> if Chrome is elsewhere.
// CHROME_FLAGS="..." adds flags to Chrome.
// Set LIVE=<address> to run against a copy that is already being served, for example
//   LIVE=https://mchango.tov.co.tz/ HEADERS=1 node tests/browser.mjs
// It checks that every served file is byte for byte the one in this folder, runs the
// whole contribution at the three widths with the network off, the share text, the
// copies and the home-screen hints. HEADERS=1 also asks for the five security
// headers and the caching rules (a plain file host such as GitHub Pages has none).

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
import { checkBackup } from '../backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS ?? null;
const LIVE = process.env.LIVE ? new URL(process.env.LIVE).href : null;
const CHROME =
  process.env.CHROME ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => existsSync(p));

const samples = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sms.json'), 'utf8')).samples;
const smsText = (id) => samples.find((s) => s.id === id).text;
const XSS_NAME = '<img src=x onerror="window.__xss=1">';

// ---------- a very small Chrome driver ----------

async function launch() {
  if (!CHROME) throw new Error('Chrome was not found. Set CHROME=/path/to/chrome');
  const profile = mkdtempSync(join(tmpdir(), 'mchango-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    ...(process.env.CHROME_FLAGS ?? '').split(' ').filter(Boolean), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, fail) => {
    let seen = '';
    const timer = setTimeout(() => fail(new Error('Chrome did not start: ' + seen)), 20000);
    proc.stderr.on('data', (chunk) => {
      seen += chunk;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (m) {
        clearTimeout(timer);
        ok(m[1]);
      }
    });
    proc.on('exit', () => fail(new Error('Chrome exited: ' + seen)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () => fail(new Error('cannot reach Chrome'));
  });
  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      const { ok, fail } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message));
      else ok(msg.result);
    } else for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const id = ++nextId;
      waiting.set(id, { ok, fail });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const close = async () => {
    try {
      await send('Browser.close');
    } catch {}
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  };
  return { send, listeners, close };
}

/** A tab in its own clean profile (own storage), at a given width. */
async function openTab(browser, width) {
  const { browserContextId } = await browser.send('Target.createBrowserContext');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => browser.send(method, params, sessionId);
  const requests = [];
  const failures = [];
  const errors = [];
  browser.listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Network.requestWillBeSent') {
      const { url, method, hasPostData } = msg.params.request;
      if (!url.startsWith('data:') && url !== 'about:blank') requests.push({ url, method, hasPostData: !!hasPostData });
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      failures.push(`${msg.params.response.status} ${msg.params.response.url}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
  });
  for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await cdp(domain + '.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {
    width, height: width < 800 ? 844 : 900, deviceScaleFactor: width < 800 ? 2 : 1, mobile: width < 800,
  });

  const js = async (expression) => {
    const got = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (got.exceptionDetails) {
      throw new Error(got.exceptionDetails.exception?.description ?? got.exceptionDetails.text);
    }
    return got.result.value;
  };
  const until = async (expression, what = expression, tries = 100) => {
    for (let i = 0; i < tries; i++) {
      if (await js(`!!(${expression})`)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for: ${what}\n  page says: ${await js('document.body.innerText.slice(0, 400)')}`);
  };
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  const tab = {
    cdp, js, until, requests, failures, errors, width, browserContextId,
    goto: async (url) => {
      await cdp('Page.navigate', { url });
      // A copy served over the internet may be on a slow line: a page load gets 60 s there, 5 s here.
      await until(`document.readyState === 'complete' && ${q('#app main')}`, 'page loaded: ' + url, LIVE ? 1200 : 100);
    },
    /** Tap the first link or button whose text is exactly `text`. */
    tap: async (text) => {
      const found = await js(`(() => {
        const el = [...document.querySelectorAll('a, button, summary, label.btn')].find((e) => !e.closest('[hidden], [inert]') && e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      assert.equal(found, true, `nothing to tap called "${text}"`);
    },
    /** Type into the field whose label is exactly `label`. */
    type: async (label, value) => {
      const found = await js(`(() => {
        const lab = [...document.querySelectorAll('label')].find((e) => !e.closest('[hidden], [inert]') && e.textContent.trim() === ${JSON.stringify(label)});
        const el = lab && document.getElementById(lab.htmlFor);
        if (!el) return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      assert.equal(found, true, `no field labelled "${label}"`);
    },
    text: () => js('document.body.innerText'),
    hash: async (h) => {
      await js(`location.hash = ${JSON.stringify(h)}`);
    },
    shot: async (name) => {
      if (!SHOTS) return;
      mkdirSync(SHOTS, { recursive: true });
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, `${width}-${name}.png`), Buffer.from(data, 'base64'));
    },
    close: () => browser.send('Target.disposeBrowserContext', { browserContextId }),
  };
  return tab;
}

// ---------- checks used on several screens ----------

/** No sideways scroll; every control big enough; text big enough and readable (contrast 4.5:1). */
async function checkScreen(tab, name) {
  await tab.until('document.getAnimations().length === 0', 'the panel has come to rest');
  const report = await tab.js(`(() => {
    const out = { wide: document.documentElement.scrollWidth - document.documentElement.clientWidth, small: [], tiny: [], faint: [] };
    const rgb = (text) => { const m = text.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const backOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a > 0.99) return c; } return { r: 255, g: 255, b: 255 }; };
    for (const el of document.querySelectorAll("#app *")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
      if (!own || el.getClientRects().length === 0 || el.closest("[hidden]") || el.disabled) continue;
      const style = getComputedStyle(el);
      const a = lum(rgb(style.color)), b = lum(backOf(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(style.fontSize);
      const need = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < need) out.faint.push(el.textContent.trim().slice(0, 30) + " " + ratio.toFixed(2));
    }
    const seen = (el) => el.getClientRects().length > 0 && !el.closest('[hidden]');
    for (const el of document.querySelectorAll('a, button, summary, input, select, textarea, label.choice, label.btn')) {
      if (!seen(el) || el.type === 'radio' || el.type === 'checkbox') continue; // their label is the target
      const r = el.getBoundingClientRect();
      const need = el.classList.contains('primary') ? 52 : 48;
      if (r.height < need - 0.5 || r.width < 48 - 0.5) out.small.push(el.tagName + ' "' + (el.textContent || el.id).trim().slice(0, 30) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height));
      if (/INPUT|SELECT|TEXTAREA/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 16) out.tiny.push(el.id);
    }
    if (parseFloat(getComputedStyle(document.body).fontSize) < 16) out.tiny.push('body');
    for (const el of document.querySelectorAll('.num')) {
      if (seen(el) && parseFloat(getComputedStyle(el).fontSize) < 17) out.tiny.push('number: ' + el.textContent.slice(0, 30));
      if (seen(el) && !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums')) out.tiny.push('not tabular: ' + el.textContent.slice(0, 30));
    }
    return out;
  })()`);
  assert.equal(report.wide <= 0, true, `${name} @${tab.width}: sideways scroll of ${report.wide}px`);
  assert.deepEqual(report.small, [], `${name} @${tab.width}: controls too small`);
  assert.deepEqual(report.tiny, [], `${name} @${tab.width}: text too small`);
  assert.deepEqual(report.faint, [], `${name} @${tab.width}: text contrast below 4.5:1`);
  await tab.shot(name);
}

/** The contribution's own page, with no panel open over it. */
const LIST = "(document.querySelector('.page.event') && !document.querySelector('.sheet'))";
/** A panel is open over the page, and the page under it cannot be used. */
const PANEL = "(document.querySelector('.sheet[role=dialog]') && document.querySelector('#app > main[inert]'))";

const totals = (tab) =>
  tab.js(`Object.fromEntries([...document.querySelectorAll('.totals .fig')].map((f) => [f.children[0].textContent, f.children[1].textContent]))`);

// ---------- one whole contribution ----------

async function wholeEvent(browser, base, width) {
  const tab = await openTab(browser, width);
  const step = (text) => console.log(`  [${width}] ${text}`);
  await tab.goto(base);

  step('first visit: says what it does and that the list stays on the phone');
  const first = await tab.text();
  assert.match(first, /Mchango ya tov/);
  assert.match(first, /Orodha inakaa kwenye simu yako tu/);
  await checkScreen(tab, '1-first-visit');

  // The first visit puts the page's files on the phone. From here on the network is OFF.
  await tab.until('navigator.serviceWorker.controller', 'the files are kept on the phone');
  await tab.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });

  step('start a list');
  await tab.tap('Anza mchango mpya');
  await tab.until(`document.querySelector('form') && ${PANEL}`);
  assert.equal(await tab.js(`document.querySelector('.page.home') !== null`), true, 'the first page is no longer under the form');
  await checkScreen(tab, '2-new-list');
  await tab.type('Jina la mchango', 'Harusi ya Zawadi na Tumaini');
  await tab.type('Lengo, TZS (si lazima)', '5,000,000');
  await tab.tap('Hifadhi');
  await tab.until(LIST);
  assert.match(await tab.text(), /Bado hakuna mtu/);
  assert.deepEqual(await tab.js(`[...document.querySelectorAll('.tabs a')].map((a) => a.textContent + (a.getAttribute('aria-current') ? ' *' : ''))`), ['Watu *', 'Sambaza', 'Nakala']);
  await checkScreen(tab, '3-empty-list');
  const eventHash = await tab.js('location.hash');

  step('add one person with a phone number');
  await tab.tap('Ongeza mtu');
  await tab.until(`document.querySelector('.quick')`);
  await tab.type('Jina', 'Furaha Amani');
  await tab.type('Namba ya simu (si lazima)', '0700 000 901');
  await tab.type('Ahadi, TZS', '100,000');
  await checkScreen(tab, '4-add-person');
  await tab.tap('Hifadhi');
  await tab.until(`${LIST} && document.querySelector('.people')`);

  step('add many at once; the unreadable line is handed back');
  await tab.tap('Ongeza mtu');
  await tab.until(`document.querySelector('.quick')`);
  await tab.js(`document.querySelector('.quick').open = true`);
  await tab.type('Mstari mmoja kwa kila mtu: jina, kisha ahadi', 'Upendo Faraja 100,000\nAmani Tumaini - 200k\nZawadi\nFaraja Zawadi 50 000');
  await tab.tap('Ongeza wote');
  await tab.until(`document.querySelector('.unread')`);
  const quick = await tab.text();
  assert.match(quick, /Wameongezwa: 3/);
  assert.match(quick, /Haikusomeka\s+Zawadi/);
  await checkScreen(tab, '5-quick-add');

  step('a name that looks like HTML stays text');
  await tab.type('Jina', XSS_NAME);
  await tab.type('Ahadi, TZS', '1000');
  await tab.tap('Hifadhi');
  await tab.until(LIST);
  assert.equal(await tab.js(`document.querySelector('main img')`), null, 'a typed name became an <img> element');
  assert.equal(await tab.js('window.__xss'), undefined);
  assert.equal(await tab.js(`[...document.querySelectorAll('.row-name')].some((e) => e.textContent === ${JSON.stringify(XSS_NAME)})`), true);
  assert.deepEqual(await totals(tab), { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 451,000', Zimelipwa: 'TZS 0', Bado: 'TZS 451,000' });
  await checkScreen(tab, '6-list');

  step('paste a payment SMS: the phone number picks the person, nothing is saved before the tap');
  const sms = smsText('till_in_other_network_payer').replace('255700000902', '255700000901');
  await tab.tap('Weka malipo');
  await tab.until(`document.querySelector('#who')`);
  await tab.type('Bandika SMS ya malipo hapa', sms);
  await tab.tap('Soma SMS');
  const read = await tab.text();
  assert.match(read, /SMS imesomeka: TZS 500, FURAHA AMANI, 30\/9\/26 18:16/);
  assert.match(read, /Namba ya simu inalingana na Furaha Amani/);
  assert.match(read, /Mchango haiwezi kuthibitisha/);
  assert.equal(await tab.js(`document.querySelector('#who').selectedOptions[0].textContent`), 'Furaha Amani');
  assert.equal(/Salio|369,601/.test(await tab.js('document.querySelector("form").innerText')), false);
  await checkScreen(tab, '7-sms-read');
  await tab.tap('Thibitisha malipo');
  await tab.until(LIST);
  assert.equal((await totals(tab)).Zimelipwa, 'TZS 500');

  step('the same SMS again is refused as already recorded');
  await tab.tap('Weka malipo');
  await tab.until(`document.querySelector('#who')`);
  await tab.type('Bandika SMS ya malipo hapa', sms);
  await tab.tap('Soma SMS');
  assert.match(await tab.text(), /Malipo haya yameshaandikwa: Furaha Amani, 30\/9\/26 18:16\. Hakuna kilichohifadhiwa/);
  await checkScreen(tab, '8-duplicate');

  step('an SMS about money going out is refused');
  await tab.type('Bandika SMS ya malipo hapa', smsText('till_out_to_lipa'));
  await tab.tap('Soma SMS');
  assert.match(await tab.text(), /SMS hii ni ya pesa iliyotoka/);

  step('cash, tapped twice in a hurry, is recorded once');
  await tab.type('Kiasi, TZS', '60,000');
  await tab.js(`(() => { const s = document.querySelector('#who'); s.value = [...s.options].find((o) => o.textContent === 'Upendo Faraja').value; s.dispatchEvent(new Event('change')); })()`);
  await tab.js(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.textContent === 'Thibitisha malipo'); b.click(); b.click(); b.form.requestSubmit(); })()`);
  await tab.until(LIST);
  assert.deepEqual(await totals(tab), { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 451,000', Zimelipwa: 'TZS 60,500', Bado: 'TZS 390,500' });

  step('a payer who is not on the list is added on the spot with pledge 0');
  await tab.tap('Weka malipo');
  await tab.until(`document.querySelector('#who')`);
  await tab.type('Kiasi, TZS', '5000');
  await tab.js(`(() => { const s = document.querySelector('#who'); s.value = 'new'; s.dispatchEvent(new Event('change')); })()`);
  await tab.type('Jina la mtu mpya', 'Tumaini Upendo');
  await tab.tap('Thibitisha malipo');
  await tab.until(LIST);
  assert.deepEqual(await totals(tab), { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 451,000', Zimelipwa: 'TZS 65,500', Bado: 'TZS 390,500' });

  step('people are listed bado, then sehemu, then amemaliza, each with its word');
  const rows = await tab.js(`[...document.querySelectorAll('.col-people > .people .row')].map((r) => r.querySelector('.row-name').textContent + ' | ' + r.querySelector('.row-sum').textContent + ' | ' + r.querySelector('.chip').textContent)`);
  assert.deepEqual(rows, [
    `${XSS_NAME} | 0 / 1,000 | bado`,
    'Amani Tumaini | 0 / 200,000 | bado',
    'Faraja Zawadi | 0 / 50,000 | bado',
    'Furaha Amani | 500 / 100,000 | sehemu',
    'Upendo Faraja | 60,000 / 100,000 | sehemu',
    'Tumaini Upendo | 5,000 / 0 +5,000 zaidi | amemaliza',
  ]);
  await checkScreen(tab, '9-list-with-payments');

  step('search narrows the list; no match offers to add');
  await tab.type('Tafuta jina', 'faraja');
  assert.equal(await tab.js(`[...document.querySelectorAll('.col-people > .people li')].filter((l) => !l.hidden).length`), 2);
  await tab.type('Tafuta jina', 'hayupo');
  assert.match(await tab.text(), /Hakuna jina hilo/);
  await tab.type('Tafuta jina', '');

  step('undo a payment, then restore it');
  await tab.js(`[...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-name').textContent === 'Upendo Faraja').click()`);
  await tab.until(`document.querySelector('.pays')`);
  await checkScreen(tab, '10-person');
  await tab.tap('Tengua');
  await tab.until(`document.querySelector('.pays .greyed')`);
  assert.match(await tab.text(), /imetenguliwa/);
  await tab.tap('Funga');
  await tab.until(LIST);
  assert.equal((await totals(tab)).Zimelipwa, 'TZS 5,500');
  await tab.js(`[...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-name').textContent === 'Upendo Faraja').click()`);
  await tab.until(`document.querySelector('.pays')`);
  await tab.tap('Rudisha');
  await tab.until(`document.querySelector('.pays li:not(.greyed)')`);

  step('raise a pledge; remove a person, then put them back');
  await tab.type('Ahadi, TZS', '150,000');
  await tab.tap('Hifadhi');
  await tab.until(`${LIST} && document.querySelector('.note.ok')`); // Hifadhi always closes the panel
  await tab.js(`[...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-name').textContent === 'Upendo Faraja').click()`);
  await tab.until(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Ondoa kwenye orodha')`);
  await tab.tap('Ondoa kwenye orodha');
  await tab.until(LIST);
  assert.deepEqual(await totals(tab), { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 351,000', Zimelipwa: 'TZS 5,500', Bado: 'TZS 350,500' });
  assert.match(await tab.text(), /Walioondolewa \(1\)/);
  await tab.js(`document.querySelector('.gone').open = true`);
  await checkScreen(tab, '11-removed');
  await tab.js(`document.querySelector('.gone .row').click()`);
  await tab.until(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Rudisha kwenye orodha')`);
  await tab.tap('Rudisha kwenye orodha');
  await tab.until(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Ondoa kwenye orodha')`);
  await tab.js(`document.querySelector('.sheet').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await tab.until(LIST);
  const final = { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 501,000', Zimelipwa: 'TZS 65,500', Bado: 'TZS 440,500' };
  assert.deepEqual(await totals(tab), final);

  step('English switch, and back');
  await tab.tap('‹ Michango yote');
  await tab.until(`document.querySelector('.page.home')`);
  await tab.tap('English');
  await tab.until(`document.documentElement.lang === 'en'`);
  assert.match(await tab.text(), /All lists/);
  await checkScreen(tab, '12-home-english');
  await tab.tap('Kiswahili');
  await tab.until(`document.documentElement.lang === 'sw'`);
  assert.match(await tab.text(), /Zimelipwa 65,500 \/ Ahadi 501,000/);

  step('the network comes back; after a reload the list is still there');
  await tab.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await tab.goto(base + eventHash);
  await tab.until(`document.querySelector('.totals')`);
  assert.deepEqual(await totals(tab), final);

  step('deleting the list asks twice');
  await tab.tap('Zaidi');
  await tab.until(`document.querySelector('.danger') && ${PANEL}`);
  await checkScreen(tab, '13-edit');
  await tab.tap('Futa orodha hii');
  assert.match(await tab.text(), /Haiwezi kurudishwa/);
  await tab.tap('Endelea kufuta');
  assert.match(await tab.text(), /Una uhakika\? Orodha "Harusi ya Zawadi na Tumaini" itafutwa kabisa/);
  await checkScreen(tab, '14-delete-twice');
  await tab.tap('Ndiyo, futa kabisa');
  await tab.until(`document.querySelector('.page.home')`);
  assert.match(await tab.text(), /Orodha imefutwa/);
  assert.match(await tab.text(), /Anza mchango mpya/);

  step('every request was a plain GET to our own address; no page error');
  const origin = new URL(base).origin;
  assert.equal(tab.requests.length >= 5, true);
  for (const r of tab.requests) {
    assert.equal(new URL(r.url).origin, origin, 'a request left our own address: ' + r.url);
    assert.equal(r.method, 'GET', r.method + ' ' + r.url);
    assert.equal(r.hasPostData, false, 'a request carried a body: ' + r.url);
  }
  assert.deepEqual(tab.failures, []);
  assert.deepEqual(tab.errors, []);
  await tab.close();
}

// ---------- the text for WhatsApp ----------

async function shareScreen(browser, base) {
  const tab = await openTab(browser, 390);
  await tab.goto(base);
  await tab.js("navigator.share = async (data) => { window.__shared = data; }");
  await tab.tap('Anza mchango mpya');
  await tab.until("document.querySelector('form')");
  await tab.type('Jina la mchango', 'Harusi ya Zawadi na Tumaini');
  await tab.tap('Hifadhi');
  await tab.until(LIST);
  const eventHash = await tab.js('location.hash');
  await tab.tap('Ongeza mtu');
  await tab.until("document.querySelector('.quick')");
  await tab.js("document.querySelector('.quick').open = true");
  // Names of exactly 20 characters, with amounts in the hundreds of thousands.
  await tab.type('Mstari mmoja kwa kila mtu: jina, kisha ahadi', 'Zawadi Tumaini Amani 900,000\nFuraha Upendo Faraja 100,000');
  await tab.tap('Ongeza wote');
  await tab.until("document.querySelector('.note.ok')");
  for (const [name, amount] of [['Zawadi Tumaini Amani', '500,000'], ['Furaha Upendo Faraja', '100,000']]) {
    await tab.hash(eventHash + '/pay');
    await tab.until("document.querySelector('#who')");
    await tab.type('Kiasi, TZS', amount);
    await tab.js(`(() => { const s = document.querySelector('#who'); s.value = [...s.options].find((o) => o.textContent === ${JSON.stringify(name)}).value; s.dispatchEvent(new Event('change')); })()`);
    await tab.tap('Thibitisha malipo');
    await tab.until(LIST);
  }
  await tab.tap('Sambaza'); // the place at the bottom of the page
  await tab.until("document.querySelector('.bubble')");
  assert.equal(await tab.js("document.querySelector('.tabs [aria-current]').textContent"), 'Sambaza');
  assert.match(await tab.js("document.querySelector('.page.event h1').textContent + ' ' + document.querySelector('.bar').textContent"), /Harusi ya Zawadi na Tumaini Zimelipwa TZS 600,000/, 'the name and the sums left the top of the page');
  const expected = [
    '*Harusi ya Zawadi na Tumaini*',
    'Ahadi: TZS 1,000,000',
    'Zimelipwa: TZS 600,000',
    'Bado: TZS 400,000',
    '',
    'Waliolipa (2):',
    '1. Zawadi Tumaini Amani — 500,000 (bado 400,000)',
    '2. Furaha Upendo Faraja — 100,000 ✅',
    '',
    'Imetengenezwa bure na mchango.tov.co.tz',
  ];
  const shown = await tab.js("[...document.querySelectorAll('.bubble-line')].map((l) => l.textContent.replace(/\\u00a0/g, ''))");
  assert.deepEqual(shown, expected);
  const tall = await tab.js("(() => { const lines = [...document.querySelectorAll('.bubble-line')]; const one = Math.min(...lines.map((l) => l.getBoundingClientRect().height)); return lines.filter((l) => l.getBoundingClientRect().height > one * 1.5).map((l) => l.textContent); })()");
  assert.deepEqual(tall, [], 'a line wraps at 390 px');
  assert.equal(await tab.js('window.__shared'), undefined, 'the text was sent before any tap');
  await checkScreen(tab, '15-share');
  await tab.js("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Sambaza').click()");
  await tab.until('window.__shared');
  assert.deepEqual(await tab.js('window.__shared'), { text: expected.join('\n') });
  const link = await tab.js("[...document.querySelectorAll('a')].find((a) => a.textContent === 'Tuma WhatsApp').href");
  assert.equal(new URL(link).origin, 'https://wa.me');
  assert.equal(new URL(link).searchParams.get('text'), expected.join('\n'));

  // The second choice is never the default, and comes with a warning.
  assert.equal(await tab.js("document.querySelector('#who-paid').checked"), true);
  assert.equal(await tab.js("document.querySelector('.note.warn').hidden"), true);
  await tab.js("document.querySelector('#who-owing').click()");
  assert.equal(await tab.js("document.querySelector('.note.warn').hidden"), false);
  await tab.js("document.querySelector('#with-amounts').click()");
  const owing = await tab.js("[...document.querySelectorAll('.bubble-line')].map((l) => l.textContent)");
  assert.deepEqual(owing.slice(5, 7), ['Bado (1):', '1. Zawadi Tumaini Amani']);
  await checkScreen(tab, '16-share-owing');
  assert.deepEqual(tab.errors, []);
  assert.equal(tab.requests.every((r) => new URL(r.url).origin === new URL(base).origin), true);
  await tab.close();
}

// ---------- save a copy, open a copy ----------

/** Hand a file to the "choose a file" field, as the phone's file picker would. */
const chooseFile = (tab, text, name = 'mchango-nakala.txt') =>
  tab.js(`(() => {
    const input = document.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: 'text/plain' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
const homeCards = (tab) => tab.js(`[...document.querySelectorAll('.card')].map((c) => c.children[0].textContent + ' | ' + c.children[1].textContent)`);

async function copyScreens(browser, base) {
  const tab = await openTab(browser, 390);
  const step = (text) => console.log(`  ${text}`);
  const downloads = mkdtempSync(join(tmpdir(), 'mchango-downloads-'));
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', browserContextId: tab.browserContextId, downloadPath: downloads });
  await tab.goto(base);
  await tab.tap('Anza mchango mpya');
  await tab.until("document.querySelector('form')");
  await tab.type('Jina la mchango', 'Harusi ya Zawadi na Tumaini');
  await tab.tap('Hifadhi');
  await tab.until(LIST);
  const eventHash = await tab.js('location.hash');

  step('an empty list has nothing to lose: no reminder yet');
  assert.match(await tab.text(), /Orodha hii bado haina nakala\./);
  assert.equal(await tab.js("document.querySelector('.copy-line .note')"), null);

  await tab.tap('Ongeza mtu');
  await tab.until("document.querySelector('.quick')");
  await tab.js("document.querySelector('.quick').open = true");
  await tab.type('Mstari mmoja kwa kila mtu: jina, kisha ahadi', `Furaha Amani 100,000\nUpendo Faraja 50,000\n${XSS_NAME} 1000`);
  await tab.tap('Ongeza wote');
  await tab.until("document.querySelector('.note.ok')");
  await tab.hash(eventHash + '/pay');
  await tab.until("document.querySelector('#who')");
  await tab.type('Kiasi, TZS', '60,000');
  await tab.js(`(() => { const s = document.querySelector('#who'); s.value = [...s.options].find((o) => o.textContent === 'Furaha Amani').value; s.dispatchEvent(new Event('change')); })()`);
  await tab.tap('Thibitisha malipo');
  await tab.until(LIST);

  step('the list changed and was never saved: a reminder, not a blocking box');
  assert.match(await tab.js("document.querySelector('.copy-line .note.warn').textContent"), /Orodha hii bado haina nakala\. Hifadhi nakala sasa\./);
  await checkScreen(tab, '17-reminder');

  step('the copy screen says what the file holds; the file can be shared where the browser shares files');
  await tab.tap('Hifadhi nakala');
  await tab.until("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Pakua')");
  assert.equal(await tab.js("document.querySelector('.tabs [aria-current]').textContent"), 'Nakala');
  assert.equal(await tab.js("document.querySelector('.tabs .dot') !== null"), true, 'the place for copies does not show that a copy is due');
  assert.match(await tab.text(), /Faili hili lina majina na namba za simu za wachangiaji/);
  const sharing = await tab.js(`(() => {
    if (typeof navigator.canShare !== 'function') return 'this browser has no file sharing';
    return navigator.canShare({ files: [new File(['{}'], 'mchango-harusi-2026-11-26.txt', { type: 'text/plain' })] }) ? 'yes' : 'REFUSED';
  })()`);
  console.log(`    can the copy be shared as a file here? ${sharing}`);
  assert.notEqual(sharing, 'REFUSED', 'the browser shares files but refuses our .txt copy');
  await checkScreen(tab, '18-save-a-copy');

  step('Pakua writes the file; the reminder starts again');
  await tab.tap('Pakua');
  await tab.until("document.querySelector('.note.ok')");
  assert.match(await tab.text(), /Nakala imehifadhiwa\./);
  assert.match(await tab.text(), /Nakala ya mwisho: \d+\/\d+\/\d+ \d\d:\d\d/);
  let name;
  for (let i = 0; i < 100 && !name; i++) {
    name = readdirSync(downloads).find((n) => n.endsWith('.txt'));
    if (!name) await new Promise((r) => setTimeout(r, 50));
  }
  assert.match(name ?? 'no file was written', /^mchango-harusi-ya-zawadi-na-tumaini-\d{4}-\d\d-\d\d\.txt$/);
  const copy = readFileSync(join(downloads, name), 'utf8');
  const checked = checkBackup(copy);
  assert.equal(checked.ok, true, 'the file we wrote does not pass our own check');
  assert.deepEqual(checked.data.people.map((p) => [p.name, p.pledge]).sort((a, b) => b[1] - a[1]), [['Furaha Amani', 100000], ['Upendo Faraja', 50000], [XSS_NAME, 1000]]);
  assert.deepEqual(checked.data.payments.map((y) => [y.amount, y.method]), [[60000, 'cash']]);

  step('"Tuma nakala WhatsApp" hands over one .txt file, and only after the tap');
  await tab.js("navigator.canShare = () => true; navigator.share = async (data) => { window.__sent = data.files.map((f) => [f.name, f.type, f.size > 100]); }");
  await tab.tap('Watu');
  await tab.until("document.querySelector('.copy-line')");
  await tab.tap('Hifadhi nakala');
  await tab.until("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Tuma nakala WhatsApp')");
  assert.equal(await tab.js('window.__sent'), undefined);
  await checkScreen(tab, '19-send-a-copy');
  await tab.tap('Tuma nakala WhatsApp');
  await tab.until('window.__sent');
  assert.deepEqual(await tab.js('window.__sent'), [[name, 'text/plain', true]]);

  step('a change after the copy; then a spoiled file is refused and nothing changes');
  await new Promise((r) => setTimeout(r, 1100)); // times are kept to the second
  await tab.hash(eventHash + '/pay');
  await tab.until("document.querySelector('#who')");
  await tab.type('Kiasi, TZS', '5,000');
  await tab.js(`(() => { const s = document.querySelector('#who'); s.value = [...s.options].find((o) => o.textContent === 'Upendo Faraja').value; s.dispatchEvent(new Event('change')); })()`);
  await tab.tap('Thibitisha malipo');
  await tab.until(LIST);
  await tab.hash('#/');
  await tab.until("document.querySelector('.page.home')");
  const before = await homeCards(tab);
  assert.deepEqual(before, ['Harusi ya Zawadi na Tumaini | Zimelipwa 65,000 / Ahadi 151,000']);
  await tab.tap('Fungua nakala');
  await tab.until("document.querySelector('input[type=file]')");
  await checkScreen(tab, '20-open-a-copy');
  assert.equal(await tab.js("document.querySelector('label[for=copy-file]').textContent"), 'Chagua faili la nakala');
  assert.equal(await tab.js("document.querySelector('input[type=file]').accept"), '.txt,text/plain');
  const orphan = JSON.parse(copy);
  orphan.payments[0].personId = 'nobody';
  for (const [text, why] of [
    [JSON.stringify(orphan), 'lina mtu au malipo yasiyo ya orodha hii'],
    [copy.slice(0, 300), 'si nakala ya Mchango, au limeharibika'],
    [copy.replace('"schema":1', '"schema":2'), 'limetoka kwenye toleo jipya zaidi la Mchango'],
    [copy.replace('"amount":60000', '"amount":0'), 'lina kiasi kisichokubalika'],
  ]) {
    await chooseFile(tab, text);
    await tab.until("document.querySelector('.note.err')");
    assert.match(await tab.text(), new RegExp('Faili halikufunguliwa na hakuna kilichobadilika: ' + why));
    await tab.js("document.querySelector('.note.err').remove()");
  }
  await checkScreen(tab, '21-file-refused');

  step('the good file: a preview first, the phone and the file side by side, the newer phone copy said in words');
  await chooseFile(tab, copy, name);
  await tab.until("document.querySelector('.versus')");
  const preview = await tab.text();
  assert.match(preview, /Nakala hii ina:/);
  assert.match(preview, /Orodha hii tayari ipo kwenye simu hii\./);
  assert.match(preview, /Angalia: orodha iliyo kwenye simu ni mpya kuliko faili/);
  assert.deepEqual(await totals(tab), { Watu: '3', Ilihifadhiwa: await tab.js("document.querySelectorAll('.totals .fig-value')[1].textContent"), Ahadi: 'TZS 151,000', Zimelipwa: 'TZS 60,000' });
  const versus = await tab.js("[...document.querySelectorAll('.versus tbody tr')].map((r) => [...r.children].map((c) => c.textContent))");
  assert.deepEqual(versus.slice(0, 2), [['Watu', '3', '3'], ['Zimelipwa', '65,000', '60,000']]);
  assert.equal(await tab.js("document.querySelector('main img')"), null, 'a name in the file became an <img> element');
  assert.equal(await tab.js('window.__xss'), undefined);
  assert.deepEqual(await (async () => { await tab.hash('#/'); await tab.until("document.querySelector('.page.home')"); return homeCards(tab); })(), before, 'a preview changed the phone');

  step('"Weka kama nakala mpya" adds it beside the list that is here');
  await tab.tap('Fungua nakala');
  await tab.until("document.querySelector('input[type=file]')");
  await chooseFile(tab, copy, name);
  await tab.until("document.querySelector('.versus')");
  await checkScreen(tab, '22-already-here');
  await tab.tap('Weka kama nakala mpya');
  await tab.until(LIST);
  assert.match(await tab.text(), /Orodha imefunguliwa\./);
  assert.equal((await totals(tab)).Zimelipwa, 'TZS 60,000');
  assert.equal(await tab.js("document.querySelector('main img')"), null);
  await tab.hash('#/');
  await tab.until("document.querySelector('.page.home')");
  assert.deepEqual((await homeCards(tab)).sort(), [
    'Harusi ya Zawadi na Tumaini (nakala) | Zimelipwa 60,000 / Ahadi 151,000',
    'Harusi ya Zawadi na Tumaini | Zimelipwa 65,000 / Ahadi 151,000',
  ]);

  step('"Badilisha iliyopo" asks twice and first keeps the list that is here');
  await tab.tap('Fungua nakala');
  await tab.until("document.querySelector('input[type=file]')");
  await chooseFile(tab, copy, name);
  await tab.until("document.querySelector('.versus')");
  await tab.tap('Badilisha iliyopo');
  assert.match(await tab.text(), /Orodha iliyopo itahifadhiwa kwanza kwa jina "Harusi ya Zawadi na Tumaini \(kabla ya kubadilisha\)"/);
  await tab.tap('Endelea kubadilisha');
  assert.match(await tab.text(), /Una uhakika\? Faili litachukua nafasi ya orodha iliyopo\./);
  await checkScreen(tab, '23-replace-twice');
  await tab.tap('Ndiyo, badilisha');
  await tab.until(LIST);
  assert.equal(await tab.js('location.hash'), eventHash, 'the replaced list kept its place');
  assert.equal((await totals(tab)).Zimelipwa, 'TZS 60,000');
  assert.match(await tab.text(), /Nakala ya mwisho/);
  await tab.hash('#/');
  await tab.until("document.querySelector('.page.home')");
  assert.deepEqual((await homeCards(tab)).sort(), [
    'Harusi ya Zawadi na Tumaini (kabla ya kubadilisha) | Zimelipwa 65,000 / Ahadi 151,000',
    'Harusi ya Zawadi na Tumaini (nakala) | Zimelipwa 60,000 / Ahadi 151,000',
    'Harusi ya Zawadi na Tumaini | Zimelipwa 60,000 / Ahadi 151,000',
  ]);

  step('a new phone: the file opens as the list it was');
  const phone2 = await openTab(browser, 390);
  await phone2.goto(base);
  await phone2.tap('Fungua nakala');
  await phone2.until("document.querySelector('input[type=file]')");
  await chooseFile(phone2, copy, name);
  await phone2.until("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Fungua orodha hii')");
  assert.equal(await phone2.js("document.querySelector('.versus')"), null);
  await checkScreen(phone2, '24-new-phone-preview');
  await phone2.tap('Fungua orodha hii');
  await phone2.until(LIST);
  assert.deepEqual(await totals(phone2), { Ahadi: 'TZS 151,000', Zimelipwa: 'TZS 60,000', Bado: 'TZS 91,000' });
  assert.equal(await phone2.js('location.hash'), eventHash);
  assert.equal(await phone2.js(`[...document.querySelectorAll('.row-name')].some((e) => e.textContent === ${JSON.stringify(XSS_NAME)})`), true);
  assert.equal(await phone2.js('window.__xss'), undefined);

  for (const t of [tab, phone2]) {
    assert.deepEqual(t.errors, []);
    assert.deepEqual(t.failures, []);
    for (const r of t.requests) {
      assert.equal(new URL(r.url).origin, new URL(base).origin, 'a request left our own address: ' + r.url);
      assert.equal(r.method === 'GET' && !r.hasPostData, true, 'a request carried something: ' + r.url);
    }
    await t.close();
  }
  rmSync(downloads, { recursive: true, force: true });
}

// ---------- one page, panels over it: nobody gets lost ----------

async function movingAround(browser, base) {
  const step = (text) => console.log(`  ${text}`);
  const tab = await openTab(browser, 390);
  const back = async () => {
    await tab.js('history.back()');
  };
  const at = () => tab.js('location.hash');
  const HOME = "(document.querySelector('.page.home') && !document.querySelector('.sheet'))";
  const makeList = async (name) => {
    await tab.tap('Anza mchango mpya');
    await tab.until(`document.querySelector('form') && ${PANEL}`);
    await tab.type('Jina la mchango', name);
    await tab.tap('Hifadhi');
    await tab.until(LIST);
    return at();
  };
  await tab.goto(base);
  const first = await makeList('Harusi ya Zawadi');

  step('a form is a panel over the page: the name and the sums stay in sight, the page under it cannot be used');
  await tab.tap('Ongeza mtu');
  await tab.until(PANEL);
  assert.equal(await at(), first + '/add');
  assert.equal(await tab.js("document.querySelector('.sheet h2').textContent"), 'Ongeza mtu');
  assert.equal(await tab.js("document.querySelector('.sheet-top .hint').textContent"), 'Harusi ya Zawadi', 'the panel does not say which contribution it belongs to');
  assert.equal(await tab.js("document.querySelector('.sheet').getAttribute('aria-modal') + ' ' + document.querySelector('.sheet').getAttribute('aria-labelledby')"), 'true sheet-title');
  assert.equal(await tab.js("document.activeElement === document.querySelector('.sheet')"), true, 'the panel did not take the focus');
  assert.equal(await tab.js("document.querySelector('main[inert] h1').textContent"), 'Harusi ya Zawadi');
  assert.equal(await tab.js("document.querySelector('main[inert] .tabs') !== null && document.querySelector('main[inert] .totals') !== null"), true);
  assert.equal(await tab.js("document.querySelectorAll('.sheet').length"), 1);
  await tab.until("Math.round(document.querySelector('.sheet').getBoundingClientRect().bottom) === window.innerHeight", 'the panel has come to rest at the bottom of the phone screen');
  const box = await tab.js("(() => { const r = document.querySelector('.sheet').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.top) >= 0]; })()");
  assert.deepEqual(box, [0, 390, true], 'the panel does not span the phone screen');

  step('"Funga" puts the same page back; the phone Back button then leaves the list, it does not reopen the form');
  await tab.tap('Funga');
  await tab.until(LIST);
  assert.equal(await at(), first);
  await back();
  await tab.until(HOME);
  await tab.js('history.forward()');
  await tab.until(LIST);

  step('the phone Back button closes an open panel and nothing else');
  await tab.tap('Weka malipo');
  await tab.until(PANEL);
  await back();
  await tab.until(LIST);
  assert.equal(await at(), first);

  step('"Hifadhi" closes the panel; Back does not go through the filled form again');
  await tab.tap('Ongeza mtu');
  await tab.until(PANEL);
  await tab.type('Jina', 'Furaha Amani');
  await tab.type('Ahadi, TZS', '100,000');
  await tab.tap('Hifadhi');
  await tab.until(`${LIST} && document.querySelector('.note.ok')`);
  assert.equal(await at(), first);
  await back();
  await tab.until(HOME);
  await tab.js('history.forward()');
  await tab.until(LIST);

  step('one panel at a time: a payment from a person takes the place of that person, and saving lands on the page');
  await tab.js("document.querySelector('.row').click()");
  await tab.until(`${PANEL} && document.querySelector('.sheet h2').textContent === 'Furaha Amani'`);
  await tab.tap('Weka malipo');
  await tab.until("document.querySelector('.sheet #who')");
  assert.equal(await tab.js("document.querySelectorAll('.sheet').length"), 1);
  assert.equal(await tab.js("document.querySelector('#who').selectedOptions[0].textContent"), 'Furaha Amani');
  await tab.type('Kiasi, TZS', '40,000');
  await tab.tap('Thibitisha malipo');
  await tab.until(LIST);
  assert.equal(await at(), first);
  assert.equal((await totals(tab)).Zimelipwa, 'TZS 40,000');
  await back();
  await tab.until(HOME);
  await tab.js('history.forward()');
  await tab.until(LIST);

  step('the three places at the bottom change the page in place: Back still leaves the list in one step');
  for (const [place, tail, mark] of [['Sambaza', '/share', '.bubble'], ['Nakala', '/backup', '.pane .lead'], ['Watu', '', '.totals'], ['Sambaza', '/share', '.bubble']]) {
    await tab.tap(place);
    await tab.until(`document.querySelector(${JSON.stringify(mark)}) && document.querySelector('.tabs [aria-current]').textContent === ${JSON.stringify(place)}`);
    assert.equal(await at(), first + tail);
    assert.equal(await tab.js("document.querySelector('.page.event h1').textContent"), 'Harusi ya Zawadi');
    assert.equal(await tab.js("document.querySelectorAll('.tabs a').length"), 3);
  }
  step('a panel opened from another place closes back onto that place');
  await tab.tap('Zaidi');
  await tab.until(`${PANEL} && document.querySelector('.danger')`);
  assert.equal(await tab.js("document.querySelector('main[inert] .bubble') !== null"), true, 'the page under the panel changed');
  await tab.tap('Funga');
  await tab.until(`${LIST} && document.querySelector('.bubble')`);
  assert.equal(await at(), first + '/share');
  await back();
  await tab.until(HOME);

  step('one list on the phone: opening the bare address starts inside it; "Michango yote" is the way out');
  await tab.goto(base);
  await tab.until(LIST);
  assert.equal(await at(), first);
  await tab.tap('‹ Michango yote');
  await tab.until(HOME);
  assert.match(await tab.text(), /Michango yote/);

  step('a second list: now the bare address shows the list of lists');
  const second = await makeList('Msiba wa Faraja');
  assert.notEqual(second, first);
  await back(); // the new list took the form's place, so one step back is the list of lists
  await tab.until(HOME);
  await tab.goto(base);
  await tab.until(HOME);
  assert.equal((await homeCards(tab)).length, 2);

  step('opened straight at a form (a reload, a saved address): "Funga" still lands on its page');
  await tab.goto(base + first + '/pay');
  await tab.until(PANEL);
  await tab.js('location.reload()');
  await tab.until(`document.readyState === 'complete' && ${PANEL}`);
  await tab.tap('Funga');
  await tab.until(LIST);
  assert.equal(await at(), first);

  step('a long list keeps its place when a panel opens and closes');
  await tab.tap('Ongeza mtu');
  await tab.until(PANEL);
  await tab.js("document.querySelector('.quick').open = true");
  await tab.type('Mstari mmoja kwa kila mtu: jina, kisha ahadi', Array.from({ length: 30 }, (_, i) => `Amani Zawadi ${i + 1} 10,000`).join('\n'));
  await tab.tap('Ongeza wote');
  await tab.until("document.querySelector('.sheet .note.ok')");
  await tab.tap('Funga');
  await tab.until(LIST);
  await tab.js('window.scrollTo(0, 900)');
  const down = await tab.js('window.scrollY');
  assert.equal(down > 500, true);
  await tab.js("[...document.querySelectorAll('.row')].at(-1).click()");
  await tab.until(PANEL);
  assert.equal(await tab.js('window.scrollY'), down);
  await checkScreen(tab, '28-panel-over-long-list');
  await tab.tap('Funga');
  await tab.until(LIST);
  assert.equal(await tab.js('window.scrollY'), down);

  assert.deepEqual(tab.errors, []);
  assert.deepEqual(tab.failures, []);
  await tab.close();
}

// ---------- no network at all, and a new version ----------

/** A copy of the project as the next version, with one visible change in the SMS reader. */
function nextVersion(dir) {
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !/\/(\.git|node_modules|tests)(\/|$)/.test(src) });
  for (const name of readdirSync(dir).filter((n) => /\.(js|html|css|webmanifest)$/.test(n))) {
    let text = readFileSync(join(dir, name), 'utf8').replaceAll('1.1.0', '1.1.1');
    if (name === 'parse.js') {
      const old = "if (OUTGOING.test(t)) return refuse('outgoing');";
      assert.equal(text.includes(old), true);
      text = text.replace(old, "if (OUTGOING.test(t)) return refuse('loan');");
    }
    writeFileSync(join(dir, name), text);
  }
}

async function offlineAndUpdate(browser) {
  const step = (text) => console.log(`  ${text}`);
  const v2 = mkdtempSync(join(tmpdir(), 'mchango-v2-'));
  nextVersion(v2);
  const shop = await serve({ root: ROOT });
  const tab = await openTab(browser, 390);
  const outgoing = async () => {
    await tab.hash(eventHash + '/pay');
    await tab.until("document.querySelector('#who')");
    await tab.type('Bandika SMS ya malipo hapa', smsText('till_out_to_lipa'));
    await tab.tap('Soma SMS');
    return tab.js("document.querySelector('.note.err').textContent");
  };
  await tab.goto(shop.url);
  await tab.until('navigator.serviceWorker.controller', 'the files are kept on the phone');
  await tab.tap('Anza mchango mpya');
  await tab.until("document.querySelector('form')");
  await tab.type('Jina la mchango', 'Msiba wa Faraja');
  await tab.tap('Hifadhi');
  await tab.until(LIST);
  const eventHash = await tab.js('location.hash');
  assert.equal(await tab.js('document.documentElement.dataset.version'), '1.1.0');
  assert.match(await outgoing(), /pesa iliyotoka/);

  step('version 2 is published: the page says so and waits for the tap, a form being filled is left alone');
  shop.setRoot(v2);
  await tab.type('Kiasi, TZS', '7,000');
  await tab.js('navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => 1)');
  await tab.until("document.querySelector('.update')", 'the new-version notice');
  assert.match(await tab.js("document.querySelector('.sheet .update').textContent"), /Toleo jipya lipo/, 'the notice is not in the open panel, where it can be seen and tapped');
  assert.equal(await tab.js('document.documentElement.dataset.version'), '1.1.0');
  assert.equal(await tab.js("document.querySelector('#who') !== null && [...document.querySelectorAll('input')].some((i) => i.value === '7,000')"), true, 'the notice wiped the form');
  await checkScreen(tab, '25-new-version');

  step('"Fungua upya": the new SMS reader runs, the list is still there, the old files are gone');
  await tab.tap('Fungua upya');
  await tab.until("document.documentElement.dataset.version === '1.1.1' && document.querySelector('#app main')", 'the page reopened as version 2');
  assert.match(await outgoing(), /kulipa deni/);
  assert.equal(await tab.js("document.querySelector('.update')"), null);
  const kept = await tab.js('caches.keys()');
  assert.equal(kept.length === 1 && kept[0].endsWith(' 1.1.1'), true, 'files kept: ' + kept.join(' | '));

  step('the server is switched off altogether: the page still opens, and still saves');
  shop.server.closeAllConnections();
  await new Promise((r) => shop.server.close(r));
  await tab.goto(shop.url + eventHash);
  await tab.until(LIST);
  assert.match(await tab.text(), /Msiba wa Faraja/);
  assert.equal(await tab.js('document.documentElement.dataset.version'), '1.1.1');
  await tab.tap('Ongeza mtu');
  await tab.until("document.querySelector('.quick')");
  await tab.type('Jina', 'Tumaini Amani');
  await tab.type('Ahadi, TZS', '20,000');
  await tab.tap('Hifadhi');
  await tab.until(`${LIST} && document.querySelector('.people')`);
  await tab.goto(shop.url); // the bare address too, with no server: one list on the phone, so it opens inside it
  await tab.until(LIST);
  assert.equal(await tab.js('location.hash'), eventHash);
  await tab.tap('‹ Michango yote');
  await tab.until("document.querySelector('.page.home')");
  assert.deepEqual(await homeCards(tab), ['Msiba wa Faraja | Zimelipwa 0 / Ahadi 20,000']);
  assert.deepEqual(tab.errors, []);
  await tab.close();
  rmSync(v2, { recursive: true, force: true });
}

async function homeScreenHints(browser, base) {
  const tab = await openTab(browser, 390);
  await tab.goto(base);
  assert.equal(/Add to Home Screen/.test(await tab.text()), false, 'the iPhone note shows on a phone that is not an iPhone');
  assert.equal(/Weka Mchango kwenye skrini ya simu/.test(await tab.text()), false);
  await tab.js("(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__asked = true; }; window.dispatchEvent(e); })()");
  await tab.until("[...document.querySelectorAll('button')].some((b) => b.textContent === 'Weka Mchango kwenye skrini ya simu')");
  await checkScreen(tab, '26-install');
  await tab.tap('Weka Mchango kwenye skrini ya simu');
  assert.equal(await tab.js('window.__asked'), true);
  await tab.close();

  const iphone = await openTab(browser, 390);
  await iphone.cdp('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await iphone.goto(base);
  assert.match(await iphone.text(), /Kwenye iPhone: kabla ya kuanza orodha, gusa kitufe cha Share, kisha "Add to Home Screen"/);
  await checkScreen(iphone, '27-iphone');
  await iphone.close();
}

// ---------- run ----------

/** A copy that is already being served: the same files as this folder, and (HEADERS=1) the headers. */
async function liveFiles(base) {
  const list = /const FILES = \[([^\]]+)\]/.exec(readFileSync(join(ROOT, 'sw.js'), 'utf8'))[1];
  const asked = ['sw.js', ...[...list.matchAll(/'([^']+)'/g)].map((m) => m[1])];
  for (const address of asked) {
    const res = await fetch(new URL(address, base), { redirect: 'manual', cache: 'no-store' });
    assert.equal(res.status, 200, `${address}: ${res.status}`);
    const local = readFileSync(join(ROOT, address === './' ? 'index.html' : address.split('?')[0]));
    assert.equal(Buffer.from(await res.arrayBuffer()).equals(local), true, `${address} is not the file in this folder`);
    if (process.env.HEADERS !== '1') continue;
    const h = res.headers;
    assert.match(h.get('strict-transport-security') ?? '', /max-age=\d+/, address + ': no HSTS');
    assert.equal(h.get('x-content-type-options'), 'nosniff', address);
    assert.equal(h.get('x-frame-options'), 'DENY', address);
    assert.match(h.get('referrer-policy') ?? '', /./, address + ': no Referrer-Policy');
    const csp = h.get('content-security-policy') ?? '';
    for (const part of ["default-src 'self'", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) {
      assert.equal(csp.includes(part), true, `${address}: the CSP lacks ${part}`);
    }
    const cache = h.get('cache-control') ?? '';
    const fresh = ['./', 'index.html', 'sw.js'].includes(address) || address.startsWith('manifest.webmanifest');
    // A CDN in front may put its own browser lifetime on a plain .js address (seen: sw.js got max-age=14400).
    // For sw.js that delays nothing: a browser asks the server afresh for a service worker script whatever its
    // cache lifetime, unless the page registers it with updateViaCache 'all' (tests/version.test.mjs forbids that),
    // and the CDN itself must then be re-checking with the server (REVALIDATED / DYNAMIC / MISS / BYPASS / EXPIRED).
    const cdn = h.get('cf-cache-status');
    if (address === 'sw.js' && cdn && !/no-cache|max-age=0/.test(cache)) {
      assert.match(cdn, /^(REVALIDATED|DYNAMIC|MISS|BYPASS|EXPIRED)$/, `sw.js is served from the CDN's own copy (${cdn})`);
      console.log(`  note: the CDN sends sw.js with "${cache}" (${cdn}); browsers still ask afresh for a worker script`);
    } else if (fresh) assert.match(cache, /no-cache|max-age=0/, `${address} must be asked for afresh every time, got "${cache}"`);
    else assert.match(cache, /max-age=31536000/, `${address} may be kept a year, got "${cache}"`);
    if (address.startsWith('manifest.webmanifest')) assert.match(h.get('content-type') ?? '', /application\/manifest\+json/);
    if (address.includes('.js')) assert.match(h.get('content-type') ?? '', /javascript/, address);
  }
  if (process.env.HEADERS === '1') {
    const post = await fetch(base, { method: 'POST', body: 'x', redirect: 'manual' });
    assert.equal(post.status, 405, 'a POST must be refused, got ' + post.status);
    assert.equal(post.headers.get('x-frame-options'), 'DENY', 'the refusal carries the headers too');
    for (const hidden of ['.git/config', 'tests/browser.mjs', 'package.json', 'README.md']) {
      const res = await fetch(new URL(hidden, base), { redirect: 'manual' });
      assert.equal(res.status, 404, `${hidden} is served (${res.status})`);
    }
  }
  return asked.length;
}

const site = LIVE ? { url: LIVE, server: { close() {} } } : await serve({ root: ROOT });
const fork = LIVE ? { server: { close() {} } } : await serve({ root: ROOT, prefix: '/mchango/' });
const browser = await launch();
let failed = false;
try {
  if (LIVE) {
    console.log(`LIVE: ${LIVE}` + (process.env.HEADERS === '1' ? ' (with headers)' : ''));
    console.log(`  ${await liveFiles(LIVE)} served files are the files in this folder`);
  }
  for (const width of [390, 820, 1440]) {
    console.log(`one whole contribution at ${width} px, network off`);
    await wholeEvent(browser, site.url, width);
  }

  if (!LIVE) {
    console.log('the same page served under /mchango/, as a fork would serve it');
    const tab = await openTab(browser, 390);
    await tab.goto(fork.url);
    await tab.tap('Anza mchango mpya');
    await tab.until(`document.querySelector('form')`);
    assert.deepEqual(tab.failures, []);
    assert.deepEqual(tab.errors, []);
    assert.equal(tab.requests.every((r) => new URL(r.url).pathname.startsWith('/mchango/')), true);
    await tab.close();
  }

  console.log('the text for WhatsApp: exact, one line per person at 390 px, never sent by itself');
  await shareScreen(browser, site.url);

  console.log('save a copy, open a copy');
  await copyScreens(browser, site.url);

  console.log('one page with panels over it: where you are, and where Back goes');
  await movingAround(browser, site.url);

  if (!LIVE) {
    console.log('version 1, then version 2, then no server at all');
    await offlineAndUpdate(browser);
  }

  console.log('the phone screen: Android offers it, iPhone is told how');
  await homeScreenHints(browser, site.url);

  console.log('everything the phone keeps is under 80 KB over the wire');
  // Every file in sw.js's list. Text travels compressed (gzip); pictures travel as they are.
  const list = /const FILES = \[([^\]]+)\]/.exec(readFileSync(join(ROOT, 'sw.js'), 'utf8'))[1];
  const files = ['sw.js', ...[...list.matchAll(/'([^']+)'/g)].map((m) => m[1].split('?')[0]).filter((f) => f !== './')];
  let raw = 0;
  let wire = 0;
  for (const f of files) {
    const body = readFileSync(join(ROOT, f));
    raw += body.length;
    wire += f.endsWith('.png') ? body.length : gzipSync(body, { level: 6 }).length;
  }
  console.log(`  ${files.length} files: ${raw} bytes on disk, ${wire} bytes over the wire`);
  assert.equal(wire < 80000, true, `over the wire it is ${wire} bytes`);

  console.log(LIVE ? 'LIVE BROWSER TESTS GREEN' : 'BROWSER TESTS GREEN');
} catch (err) {
  failed = true;
  console.error('BROWSER TEST FAILED\n' + (err.stack ?? err));
} finally {
  await browser.close();
  site.server.close();
  fork.server.close();
}
process.exit(failed ? 1 : 0);
