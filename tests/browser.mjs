// The page in a real browser: headless Chrome, driven over its debugging socket
// with nothing but Node (no dependency).   node tests/browser.mjs
//
// One whole contribution is run at 390, 820 and 1440 px wide, each in a clean
// browser profile, WITH THE NETWORK OFF once the page has loaded.
// Set SHOTS=<folder> to keep screenshots. Set CHROME=<path> if Chrome is elsewhere.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS ?? null;
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
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank',
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
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
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
  const until = async (expression, what = expression) => {
    for (let i = 0; i < 100; i++) {
      if (await js(`!!(${expression})`)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for: ${what}\n  page says: ${await js('document.body.innerText.slice(0, 400)')}`);
  };
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  const tab = {
    cdp, js, until, requests, failures, errors, width,
    goto: async (url) => {
      await cdp('Page.navigate', { url });
      await until(`document.readyState === 'complete' && ${q('#app main')}`, 'page loaded: ' + url);
    },
    /** Tap the first link or button whose text is exactly `text`. */
    tap: async (text) => {
      const found = await js(`(() => {
        const el = [...document.querySelectorAll('a, button, summary')].find((e) => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      assert.equal(found, true, `nothing to tap called "${text}"`);
    },
    /** Type into the field whose label is exactly `label`. */
    type: async (label, value) => {
      const found = await js(`(() => {
        const lab = [...document.querySelectorAll('label')].find((e) => !e.closest('[hidden]') && e.textContent.trim() === ${JSON.stringify(label)});
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
    for (const el of document.querySelectorAll('a, button, summary, input, select, textarea')) {
      if (!seen(el)) continue;
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

  // From here on the network is OFF: the list must not need it.
  await tab.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });

  step('start a list');
  await tab.tap('Anza mchango mpya');
  await tab.until(`document.querySelector('form')`);
  await checkScreen(tab, '2-new-list');
  await tab.type('Jina la mchango', 'Harusi ya Zawadi na Tumaini');
  await tab.type('Lengo, TZS (si lazima)', '5,000,000');
  await tab.tap('Hifadhi');
  await tab.until(`document.querySelector('.page.event')`);
  assert.match(await tab.text(), /Bado hakuna mtu/);
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
  await tab.until(`document.querySelector('.people')`);

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
  await tab.until(`document.querySelector('.people')`);
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
  await tab.until(`document.querySelector('.page.event')`);
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
  await tab.until(`document.querySelector('.page.event')`);
  assert.deepEqual(await totals(tab), { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 451,000', Zimelipwa: 'TZS 60,500', Bado: 'TZS 390,500' });

  step('a payer who is not on the list is added on the spot with pledge 0');
  await tab.tap('Weka malipo');
  await tab.until(`document.querySelector('#who')`);
  await tab.type('Kiasi, TZS', '5000');
  await tab.js(`(() => { const s = document.querySelector('#who'); s.value = 'new'; s.dispatchEvent(new Event('change')); })()`);
  await tab.type('Jina la mtu mpya', 'Tumaini Upendo');
  await tab.tap('Thibitisha malipo');
  await tab.until(`document.querySelector('.page.event')`);
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
  await tab.hash(eventHash);
  await tab.until(`document.querySelector('.page.event')`);
  assert.equal((await totals(tab)).Zimelipwa, 'TZS 5,500');
  await tab.js(`[...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-name').textContent === 'Upendo Faraja').click()`);
  await tab.until(`document.querySelector('.pays')`);
  await tab.tap('Rudisha');
  await tab.until(`document.querySelector('.pays li:not(.greyed)')`);

  step('raise a pledge; remove a person, then put them back');
  await tab.type('Ahadi, TZS', '150,000');
  await tab.tap('Hifadhi');
  await tab.until(`document.querySelector('.note.ok')`);
  await tab.tap('Ondoa kwenye orodha');
  await tab.until(`document.querySelector('.page.event')`);
  assert.deepEqual(await totals(tab), { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 351,000', Zimelipwa: 'TZS 5,500', Bado: 'TZS 350,500' });
  assert.match(await tab.text(), /Walioondolewa \(1\)/);
  await tab.js(`document.querySelector('.gone').open = true`);
  await checkScreen(tab, '11-removed');
  await tab.js(`document.querySelector('.gone .row').click()`);
  await tab.until(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Rudisha kwenye orodha')`);
  await tab.tap('Rudisha kwenye orodha');
  await tab.until(`[...document.querySelectorAll('button')].some((b) => b.textContent === 'Ondoa kwenye orodha')`);
  await tab.hash(eventHash);
  await tab.until(`document.querySelector('.page.event')`);
  const final = { Lengo: 'TZS 5,000,000', Ahadi: 'TZS 501,000', Zimelipwa: 'TZS 65,500', Bado: 'TZS 440,500' };
  assert.deepEqual(await totals(tab), final);

  step('English switch, and back');
  await tab.hash('#/');
  await tab.until(`document.querySelector('.page.home')`);
  await tab.tap('English');
  await tab.until(`document.documentElement.lang === 'en'`);
  assert.match(await tab.text(), /My lists/);
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
  await tab.until(`document.querySelector('.danger')`);
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

// ---------- run ----------

const site = await serve({ root: ROOT });
const fork = await serve({ root: ROOT, prefix: '/mchango/' });
const browser = await launch();
let failed = false;
try {
  for (const width of [390, 820, 1440]) {
    console.log(`one whole contribution at ${width} px, network off`);
    await wholeEvent(browser, site.url, width);
  }

  console.log('the same page served under /mchango/, as a fork would serve it');
  const tab = await openTab(browser, 390);
  await tab.goto(fork.url);
  await tab.tap('Anza mchango mpya');
  await tab.until(`document.querySelector('form')`);
  assert.deepEqual(tab.failures, []);
  assert.deepEqual(tab.errors, []);
  assert.equal(tab.requests.every((r) => new URL(r.url).pathname.startsWith('/mchango/')), true);
  await tab.close();

  console.log('first load is under 80 KB');
  const files = ['index.html', 'style.css', 'app.js', 'store.js', 'parse.js'];
  const bytes = files.reduce((sum, f) => sum + statSync(join(ROOT, f)).size, 0);
  console.log(`  ${bytes} bytes in ${files.length} files`);
  assert.equal(bytes < 80000, true, `first load is ${bytes} bytes`);

  console.log('BROWSER TESTS GREEN');
} catch (err) {
  failed = true;
  console.error('BROWSER TEST FAILED\n' + (err.stack ?? err));
} finally {
  await browser.close();
  site.server.close();
  fork.server.close();
}
process.exit(failed ? 1 : 0);
