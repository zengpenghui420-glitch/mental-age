/**
 * Mock the mental-age order unlock flow. No real orders or legacy codes.
 *
 *   NODE_PATH=/tmp/mockdeps/node_modules node tools/order-unlock-mock.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
function loadPuppeteer() {
  try { return require('puppeteer-core'); }
  catch (e) { return createRequire('/tmp/mockdeps/package.json')('puppeteer-core'); }
}
const puppeteer = loadPuppeteer();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'index.html');
const ORDER_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const LEGACY_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const ORDER_ID = 'P135792468013579246';
const CODE = 'MA7K2P';
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint',
  'content-type': 'application/json; charset=utf-8'
};

let failed = 0;

function assert(cond, msg, extra) {
  if (cond) return;
  const err = new Error(msg);
  err.extra = extra;
  throw err;
}

async function test(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (err) {
    failed += 1;
    console.error('FAIL', name);
    console.error(err && err.stack ? err.stack : err);
    if (err && err.extra != null) console.error(JSON.stringify(err.extra, null, 2).slice(0, 5000));
  }
}

function staticChecks() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  assert(html.includes("const LEGACY_API_BASE='https://snappy-tundra-7uesdvk.tmp.now'"), 'legacy host missing');
  assert(html.includes("const API_BASE='https://snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app'"), 'order host missing');
  assert(html.includes("const QUIZ_KEY='mental'"), 'quiz key missing');
  assert(html.includes("LEGACY_API_BASE+'/get?quiz='"), 'legacy peek path missing');
  assert(html.includes("LEGACY_API_BASE+'/redeem'"), 'legacy redeem path missing');
  assert(html.includes("JSON.stringify({quiz:QUIZ_KEY,orderId})"), 'order redeem body missing');
  assert(html.includes("API_BASE+'/order/get?quiz='"), 'order peek path missing');
  assert(html.includes("API_BASE+'/order/redeem'"), 'order redeem path missing');
  const withoutLegacy = html.split('LEGACY_API_BASE').join('');
  assert(!withoutLegacy.includes("API_BASE+'/redeem'"), 'legacy redeem must not use the order host');
  assert(!withoutLegacy.includes("API_BASE+'/get?"), 'legacy peek must not use the order host');
  assert(!html.includes('验证码'), 'page must not advertise legacy codes');
  assert(!html.includes('付款') && !html.includes('支付'), 'page must not advertise payment checks');
  assert(html.includes('到小红书「我的订单」复制订单号贴过来'), 'order hint missing');
  assert(html.includes('每个订单号可以测 3 次'), 'three-use hint missing');
  assert(html.includes('看到路边小狗'), 'question copy changed');
  assert((html.match(/dim:'[PRECST]'/g) || []).length === 18, 'question count changed');
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  const js = html.slice(start + '<script>'.length, end);
  fs.writeFileSync('/tmp/mental-age-check.js', js);
}

function startServer() {
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
    const file = path.normalize(path.join(ROOT, decodeURIComponent(name)));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
      res.end(buf);
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function json(req, status, body) {
  req.respond({status, headers: CORS, body: JSON.stringify(body)});
}

function orderBody(uses) {
  const max = 3;
  return {
    ok: true,
    remaining: max - uses,
    max,
    uses,
    quiz: 'mental',
    orderId: ORDER_ID,
    bound: true,
    paidVerified: false
  };
}

function book() {
  let uses = 0;
  return {
    get uses() { return uses; },
    view() {
      if (uses === 0) return {status: 404, body: {ok: false, error: 'not_found'}};
      return {status: 200, body: orderBody(uses)};
    },
    redeem() {
      if (uses >= 3) return {status: 403, body: {ok: false, error: 'exhausted', remaining: 0, max: 3}};
      uses += 1;
      return {status: 200, body: orderBody(uses)};
    }
  };
}

async function attach(page, state) {
  const calls = [];
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = req.url();
    let parsed;
    try { parsed = new URL(url); } catch (e) { req.continue(); return; }
    if (parsed.hostname === '127.0.0.1') { req.continue(); return; }
    const rec = {
      method: req.method(),
      href: url,
      host: parsed.host,
      path: parsed.pathname,
      headers: req.headers(),
      body: req.postData() || ''
    };
    if (rec.method === 'OPTIONS') {
      req.respond({status: 204, headers: CORS});
      return;
    }
    calls.push(rec);
    let mode = false;
    try { mode = state.handle(rec, req); }
    catch (err) {
      try { req.abort('failed'); } catch (e) {}
      state.routeError = err;
      return;
    }
    if (mode === 'hang') {
      setTimeout(() => { try { req.abort('timedout'); } catch (e) {} }, state.hangMs || 500);
      return;
    }
    if (mode === 'respond') return;
    try { req.abort('blockedbyclient'); } catch (e) {}
  });
  return calls;
}

function orderHandle(vault, mutate) {
  return (rec, req) => {
    if (rec.host !== ORDER_HOST) return false;
    if (!rec.headers['x-device-id']) throw new Error('order request missing X-Device-Id');
    if (rec.path === '/order/get' && rec.method === 'GET') {
      const q = new URL(rec.href).searchParams;
      if (q.get('quiz') !== 'mental') throw new Error('peek quiz ' + q.get('quiz'));
      if (q.get('orderId') !== ORDER_ID) throw new Error('peek order ' + q.get('orderId'));
      const out = vault.view();
      json(req, out.status, out.body);
      return 'respond';
    }
    if (rec.path === '/order/redeem' && rec.method === 'POST') {
      const body = JSON.parse(rec.body);
      if (body.quiz !== 'mental' || body.orderId !== ORDER_ID || body.code) throw new Error('redeem body ' + rec.body);
      if (mutate) {
        const mode = mutate(rec, req);
        if (mode === 'hang') return 'hang';
      }
      const out = vault.redeem();
      json(req, out.status, out.body);
      return 'respond';
    }
    throw new Error('unexpected order path ' + rec.method + ' ' + rec.path);
  };
}

function legacyHandle(slot) {
  return (rec, req) => {
    if (rec.host !== LEGACY_HOST) return false;
    if (rec.headers['x-device-id']) throw new Error('legacy request sent X-Device-Id');
    if (rec.path === '/redeem' && rec.method === 'POST') {
      const body = JSON.parse(rec.body);
      if (body.quiz !== 'mental' || body.code !== CODE || body.orderId) throw new Error('legacy body ' + rec.body);
      slot.posts.push(body);
      if (slot.exhausted) json(req, 403, {ok: false, error: 'exhausted', remaining: 0, max: 3});
      else json(req, 200, {ok: true, remaining: 2, max: 3});
      return 'respond';
    }
    if (rec.path === '/get' && rec.method === 'GET') {
      const q = new URL(rec.href).searchParams;
      if (q.get('quiz') !== 'mental' || !q.get('code')) throw new Error('legacy get ' + rec.href);
      json(req, 404, {ok: false, error: 'not_found'});
      return 'respond';
    }
    throw new Error('unexpected legacy path ' + rec.path);
  };
}

function posts(calls) {
  return calls.filter(c => c.method === 'POST' && c.path === '/order/redeem');
}
function peeks(calls) {
  return calls.filter(c => c.method === 'GET' && c.path === '/order/get');
}
function since(calls, n) { return calls.slice(n); }

async function waitToast(page, text) {
  await page.waitForFunction(t => {
    const el = document.getElementById('toast');
    return !!(el && el.textContent.includes(t));
  }, {}, text);
}

async function openModal(page) {
  await page.waitForSelector('#btnStart');
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
}

async function submit(page, value) {
  await page.evaluate(v => { document.getElementById('codeInput').value = v; }, value);
  await page.click('#btnCodeOk');
}

async function answerAll(page) {
  for (let n = 1; n <= 18; n++) {
    await page.waitForFunction(label => {
      const el = document.getElementById('qprog');
      return !!(el && el.textContent === label);
    }, {}, n + ' / 18');
    await page.click('#opts .opt');
  }
  await page.waitForSelector('#result.active', {timeout: 8000});
}

async function overflow(page) {
  return page.evaluate(() => {
    const input = document.getElementById('codeInput');
    const hint = document.querySelector('.code-hint');
    const hr = hint ? hint.getBoundingClientRect() : null;
    return {
      pageSw: document.documentElement.scrollWidth,
      pageCw: document.documentElement.clientWidth,
      inputSw: input ? input.scrollWidth : 0,
      inputCw: input ? input.clientWidth : 0,
      hint: hr ? {top: hr.top, bottom: hr.bottom, left: hr.left, right: hr.right, text: hint.innerText} : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
      quiz: document.getElementById('quiz').classList.contains('active'),
      modal: document.getElementById('codeMask').classList.contains('show')
    };
  });
}

async function shot(page, name) {
  const file = `/tmp/mental-ui/${name}.png`;
  fs.mkdirSync('/tmp/mental-ui', {recursive: true});
  await page.screenshot({path: file});
  return file;
}

async function main() {
  staticChecks();
  await test('static source paths', async () => {
    const {spawnSync} = await import('node:child_process');
    const out = spawnSync(process.execPath, ['--check', '/tmp/mental-age-check.js'], {encoding: 'utf8'});
    assert(out.status === 0, 'inline script failed node --check', out.stderr);
  });

  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars']
  });

  async function withPage(viewport, fn) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    if (viewport) await page.setViewport({width: viewport.width, height: viewport.height, deviceScaleFactor: 1, isMobile: true, hasTouch: true});
    try { await fn(page); }
    finally { await ctx.close(); }
  }

  async function boot(page, state, href) {
    const calls = await attach(page, state);
    await page.goto(origin + (href || '/'), {waitUntil: 'load'});
    if (state.routeError) throw state.routeError;
    return calls;
  }

  await test('modal copy, no free start', async () => {
    await withPage({width: 390, height: 800}, async page => {
      const calls = await boot(page, {handle: () => { throw new Error('network'); }});
      const hidden = await page.$eval('#btnLast', el => el.hidden);
      assert(hidden, 'last-result button should stay hidden without a saved result');
      await openModal(page);
      const text = await page.$eval('.code-panel', el => el.innerText);
      assert(text.includes('输入订单号'), text);
      assert(text.includes('小红书'), text);
      assert(text.includes('3 次'), text);
      assert(!text.includes('验证码'), text);
      assert(!text.includes('付款'), text);
      assert(calls.length === 0, 'opening the form must not call the API', calls);
      const quizOn = await page.$eval('#quiz', el => el.classList.contains('active'));
      assert(!quizOn, 'quiz opened without an order');
    });
  });

  await test('invalid order and wrong binding', async () => {
    await withPage({width: 390, height: 800}, async page => {
      const vault = {
        view() { return {status: 403, body: {ok: false, error: 'bound_other_quiz'}}; },
        redeem() { throw new Error('wrong binding must not redeem'); }
      };
      const calls = await boot(page, {handle: orderHandle(vault)});
      await openModal(page);
      await submit(page, '');
      await waitToast(page, '请贴上订单号');
      await submit(page, 'P111111111111111111');
      await waitToast(page, '订单号格式不对');
      await submit(page, 'P123456789012345678');
      await waitToast(page, '订单号格式不对');
      assert(calls.length === 0, 'invalid orders must not hit the API', calls);
      await submit(page, ORDER_ID);
      await waitToast(page, '这个订单号已经用来测过别的测试了');
      const quizOn = await page.$eval('#quiz', el => el.classList.contains('active'));
      assert(!quizOn, 'wrong binding started the quiz');
      assert(posts(calls).length === 0, 'wrong binding redeemed', calls);
      assert(peeks(calls).length === 1, 'wrong binding should only peek', calls);
    });
  });

  await test('first redeem, mid refresh, continue', async () => {
    await withPage({width: 390, height: 800}, async page => {
      const vault = book();
      const calls = await boot(page, {handle: orderHandle(vault)});
      await openModal(page);
      await submit(page, '「' + ORDER_ID + '」');
      await page.waitForSelector('#quiz.active');
      await waitToast(page, '验证成功，还可以测 2 次');
      assert(posts(calls).length === 1, 'first start should redeem once', calls);
      assert(peeks(calls).length === 1, 'first start should peek once before redeem', calls);
      assert(!calls.some(c => c.host === LEGACY_HOST), 'order flow hit the legacy host', calls);
      const paid = await page.evaluate(() => document.body.innerText.includes('paidVerified') || document.body.innerText.includes('付款'));
      assert(!paid, 'payment flag leaked into the page');

      await page.waitForFunction(() => document.getElementById('qprog').textContent === '1 / 18');
      await page.click('#opts .opt');
      await page.waitForFunction(() => document.getElementById('qprog').textContent === '2 / 18');
      const qtext = await page.$eval('#qtext', el => el.textContent);
      const mark = calls.length;
      await page.reload({waitUntil: 'load'});
      await page.waitForFunction(text => {
        const q = document.getElementById('qtext');
        const p = document.getElementById('qprog');
        return !!(q && p && q.textContent === text && p.textContent === '2 / 18');
      }, {}, qtext);
      const mid = since(calls, mark);
      assert(posts(mid).length === 0, 'mid-quiz refresh redeemed', mid);
      assert(peeks(mid).length === 1, 'mid-quiz refresh should peek once', mid);

      await page.click('#qback');
      await page.waitForFunction(() => document.getElementById('qprog').textContent === '1 / 18');
      await page.click('#qback');
      await page.waitForSelector('#start.active');
      const beforeContinue = calls.length;
      await page.click('#btnStart');
      await page.waitForFunction(() => document.getElementById('qprog') && document.getElementById('qprog').textContent === '1 / 18');
      const cont = since(calls, beforeContinue);
      assert(posts(cont).length === 0, 'continue redeemed', cont);
      assert(peeks(cont).length === 1, 'continue should peek once', cont);
      const selected = await page.$$eval('.opt.sel', els => els.length);
      assert(selected === 1, 'continue lost the saved answer');
      assert(vault.uses === 1, 'use count changed across refresh/continue: ' + vault.uses);
    });
  });

  await test('result refresh, retest, fourth refusal', async () => {
    await withPage({width: 390, height: 844}, async page => {
      const vault = book();
      const calls = await boot(page, {handle: orderHandle(vault)});
      await openModal(page);
      await submit(page, ORDER_ID);
      await page.waitForSelector('#quiz.active');
      await answerAll(page);
      const title = await page.$eval('#typeTitle', el => el.textContent);
      assert(title && title.length > 0, 'missing result title');
      const age = await page.$eval('.index-num', el => el.textContent);
      const mark = calls.length;
      await page.reload({waitUntil: 'load'});
      await page.waitForSelector('#result.active');
      const title2 = await page.$eval('#typeTitle', el => el.textContent);
      assert(title2 === title, 'result refresh changed the result');
      const refreshed = since(calls, mark);
      assert(posts(refreshed).length === 0, 'result refresh redeemed', refreshed);
      assert(peeks(refreshed).length === 1, 'result refresh should peek once', refreshed);
      assert(vault.uses === 1, 'result refresh changed uses');

      const beforeRetry = calls.length;
      await page.click('#btnRetry');
      await page.waitForSelector('#quiz.active');
      await waitToast(page, '验证成功，还可以测 1 次');
      const retryCalls = since(calls, beforeRetry);
      assert(posts(retryCalls).length === 1, 'retest should redeem once', retryCalls);
      await answerAll(page);
      assert(vault.uses === 2, 'second attempt did not consume the second use');

      await page.click('#btnRetry');
      await page.waitForSelector('#quiz.active');
      await waitToast(page, '验证成功，这是最后一次');
      await answerAll(page);
      const kept = await page.$eval('#typeTitle', el => el.textContent);
      const keptAge = await page.$eval('.index-num', el => el.textContent);
      assert(vault.uses === 3, 'third attempt missing');
      const beforeFourth = calls.length;
      await page.click('#btnRetry');
      await waitToast(page, '这个订单号的 3 次已经用完了');
      const fourth = since(calls, beforeFourth);
      assert(posts(fourth).length === 0, 'fourth attempt redeemed', fourth);
      assert(peeks(fourth).length === 1, 'fourth attempt should peek', fourth);
      const stillResult = await page.$eval('#result', el => el.classList.contains('active'));
      const stillTitle = await page.$eval('#typeTitle', el => el.textContent);
      const stillAge = await page.$eval('.index-num', el => el.textContent);
      assert(stillResult && stillTitle === kept && stillAge === keptAge, 'fourth refusal dropped the result');
      assert(vault.uses === 3, 'fourth refusal consumed another use');
      assert(age && keptAge, 'age missing');
      const box320 = await page.setViewport({width: 320, height: 700, deviceScaleFactor: 1, isMobile: true, hasTouch: true}).then(() => overflow(page));
      assert(box320.pageSw <= box320.pageCw + 1, 'result overflows at 320', box320);
    });
  });

  await test('timeout reconcile', async () => {
    await withPage({width: 390, height: 800}, async page => {
      let applied = false;
      let postCount = 0;
      const vault = {
        view() {
          if (!applied) return {status: 404, body: {ok: false, error: 'not_found'}};
          return {status: 200, body: orderBody(1)};
        },
        redeem() { return {status: 200, body: orderBody(1)}; }
      };
      const calls = await boot(page, {
        hangMs: 450,
        handle: orderHandle(vault, () => {
          postCount += 1;
          if (postCount === 1) { applied = true; return 'hang'; }
          throw new Error('accepted timeout sent a second redeem');
        })
      });
      await page.evaluate(() => { globalThis.__ORDER_TIMEOUT_MS = 250; globalThis.__ORDER_RECONCILE_MS = 0; });
      await openModal(page);
      await submit(page, ORDER_ID);
      await page.waitForSelector('#quiz.active', {timeout: 8000});
      assert(postCount === 1, 'timeout accept posted ' + postCount);
      assert(posts(calls).length === 1, 'timeout accept call log', calls);
      await waitToast(page, '验证成功，还可以测 2 次');
    });

    await withPage({width: 390, height: 800}, async page => {
      let postCount = 0;
      const vault = book();
      const calls = await boot(page, {
        hangMs: 450,
        handle: orderHandle(vault, () => {
          postCount += 1;
          if (postCount === 1) return 'hang';
          return 'respond';
        })
      });
      await page.evaluate(() => { globalThis.__ORDER_TIMEOUT_MS = 250; globalThis.__ORDER_RECONCILE_MS = 0; });
      await openModal(page);
      await submit(page, ORDER_ID);
      await page.waitForSelector('#quiz.active', {timeout: 8000});
      assert(postCount === 2, 'unapplied timeout should retry once, got ' + postCount);
      assert(vault.uses === 1, 'retry charged ' + vault.uses + ' times');
      assert(posts(calls).length === 2, 'retry call log', calls);
    });

    await withPage({width: 390, height: 800}, async page => {
      const calls = await boot(page, {
        handle(rec, req) {
          if (rec.host !== ORDER_HOST) return false;
          json(req, 500, {ok: false, error: 'unavailable'});
          return 'respond';
        }
      });
      await page.evaluate(() => { globalThis.__ORDER_TIMEOUT_MS = 250; globalThis.__ORDER_RECONCILE_MS = 0; });
      await openModal(page);
      await submit(page, ORDER_ID);
      await waitToast(page, '暂时验证不了，请稍后再试');
      const quizOn = await page.$eval('#quiz', el => el.classList.contains('active'));
      assert(!quizOn, 'give-up timeout started the quiz');
      assert(posts(calls).length === 1, 'give-up should not keep redeeming', calls);
    });
  });

  await test('legacy code path', async () => {
    await withPage({width: 390, height: 800}, async page => {
      const slot = {posts: [], exhausted: false};
      const calls = await boot(page, {handle: legacyHandle(slot)}, '/?code=' + CODE);
      await page.waitForSelector('#codeMask.show');
      const prefilled = await page.$eval('#codeInput', el => el.value);
      assert(prefilled === CODE, 'url code was not kept as-is: ' + prefilled);
      assert(slot.posts.length === 0, 'url prefill redeemed immediately');
      await page.click('#btnCodeOk');
      await page.waitForSelector('#quiz.active');
      assert(slot.posts.length === 1, 'legacy redeem count ' + slot.posts.length);
      assert(slot.posts[0].quiz === 'mental' && slot.posts[0].code === CODE, 'legacy body changed', slot.posts);
      assert(calls.every(c => c.host === LEGACY_HOST), 'legacy call left this repo host', calls);
      assert(!calls.some(c => c.path.startsWith('/order/')), 'legacy used the order API', calls);
      const mark = calls.length;
      await page.reload({waitUntil: 'load'});
      await page.waitForSelector('#start.active');
      await page.click('#btnStart');
      await page.waitForSelector('#quiz.active');
      const after = since(calls, mark);
      assert(after.length === 0, 'legacy refresh/continue redeemed again', after);

      await answerAll(page);
      await page.click('#btnRetry');
      await page.waitForSelector('#codeMask.show');
      slot.exhausted = true;
      await page.click('#btnCodeOk');
      await waitToast(page, '次数已经用完了');
      const quizAfter = await page.$eval('#quiz', el => el.classList.contains('active'));
      assert(!quizAfter, 'exhausted legacy code started a quiz');
      assert(slot.posts.length === 2, 'legacy retry did not call the original redeem');
      assert(calls.every(c => c.host === LEGACY_HOST && (c.path === '/redeem' || c.path === '/get')), 'legacy path drifted', calls);
    });
  });

  await test('layout 320 and 390', async () => {
    for (const width of [320, 390]) {
      await withPage({width, height: width === 320 ? 700 : 844}, async page => {
        const vault = book();
        await boot(page, {handle: orderHandle(vault)});
        await openModal(page);
        await page.evaluate(v => { document.getElementById('codeInput').value = v; }, ORDER_ID);
        const modalBox = await overflow(page);
        assert(modalBox.pageSw <= modalBox.pageCw + 1, width + ' modal page overflow', modalBox);
        assert(modalBox.inputSw <= modalBox.inputCw + 1, width + ' order id clipped', modalBox);
        assert(modalBox.hint && modalBox.hint.top >= 0 && modalBox.hint.bottom <= modalBox.vh + 1, width + ' hint offscreen', modalBox);
        assert(modalBox.hint.left >= 0 && modalBox.hint.right <= modalBox.vw + 1, width + ' hint horizontal', modalBox);
        assert(modalBox.hint.text.includes('小红书') && modalBox.hint.text.includes('3 次'), width + ' hint text', modalBox);
        await shot(page, 'modal-' + width);
        await page.click('#btnCodeOk');
        await page.waitForSelector('#quiz.active');
        const quizBox = await overflow(page);
        assert(quizBox.pageSw <= quizBox.pageCw + 1, width + ' quiz overflow', quizBox);
        await shot(page, 'quiz-' + width);
      });
    }
  });

  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (failed) {
    console.error(failed + ' failed');
    process.exit(1);
  }
  console.log('ALL PASS');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
