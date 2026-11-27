// Mocked order-unlock checks. Synthetic ids only. Chrome pins the vault,
// order, and Mantle hosts to 127.0.0.1, so a missed mock cannot redeem a real code.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const LEGACY_HOST = 'snappy-tundra-7uesdvk.tmp.now';
const VERCEL_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const ORDER = 'P847291038475610293';
const OTHER = 'P102938475610293847';
const CODE = 'MA7K2P';
const PORT = 8956;
const BASE = `http://127.0.0.1:${PORT}/`;

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER)) throw new Error('synthetic order is not a legal id: ' + patternError(ORDER));
if (patternError(OTHER)) throw new Error('second synthetic order is not a legal id: ' + patternError(OTHER));
if (!/^MA[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    vaultMode: 'ok',
    vaultPosts: 0,
    vaultGets: 0,
    mantleGets: 0,
    mantleDecr: 0,
    mantleIncr: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

async function handleVault(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' ' + u.hostname + u.pathname + u.search);
  if (u.pathname === '/order/get' || u.pathname === '/order/redeem' || u.pathname.startsWith('/order/') || u.pathname.includes('/orders/')) {
    state.unexpected.push('order ' + req.method() + ' ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'down') {
      await req.abort('failed');
      return;
    }
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  if (u.pathname === '/get') {
    state.vaultGets++;
    if (u.searchParams.get('quiz') !== 'mental') return send(req, 400, { ok: false, error: 'invalid' });
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  state.unexpected.push('vault ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function handleBlocked(req, u, state) {
  state.urls.push(req.method() + ' ' + u.hostname + u.pathname);
  state.unexpected.push(u.hostname + ' ' + req.method() + ' ' + u.pathname);
  if (u.hostname === 'mantledb.sh') {
    if (u.pathname.includes('/orders/')) state.unexpected.push('mantle-order ' + u.pathname);
    if (req.method() === 'GET') state.mantleGets++;
    if (req.method() === 'POST' && u.pathname.includes('/increment/')) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.by === -1) state.mantleDecr++;
      else if (body.by === 1) state.mantleIncr++;
    }
  }
  await req.abort('failed');
}

async function arm(page, state) {
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === LEGACY_HOST) return await handleVault(req, u, state);
      if (u.hostname === VERCEL_HOST || u.hostname === 'mantledb.sh') return await handleBlocked(req, u, state);
      state.unexpected.push(u.hostname + ' ' + req.url());
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + (e && e.message));
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      vaultPosts: state.vaultPosts,
      vaultGets: state.vaultGets,
      mantleGets: state.mantleGets,
      mantleDecr: state.mantleDecr,
      mantleIncr: state.mantleIncr,
      bodies: state.bodies,
      urls: state.urls,
      unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qno', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qno').textContent !== prev, { timeout: 3000 }, before);
}

async function newPage(browser, state) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument(() => {
    try {
      if (sessionStorage.getItem('__test_ready')) return;
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('__test_ready', '1');
    } catch (e) {}
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemVault === 'function' && typeof shownOrderUses === 'function');
  return { page, errors };
}

async function shownUses(page, orderId = ORDER) {
  return page.evaluate((id) => shownOrderUses(id), orderId);
}

function assertNoOrderNet(state, msg) {
  const hit = state.urls.filter((u) => u.includes('/orders/') || u.includes('/order/') || u.includes('vercel') || u.includes('mantle'));
  assert(hit.length === 0 && state.unexpected.length === 0, msg, state);
  assert(state.vaultPosts === 0 && state.vaultGets === 0, msg, state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, msg, state);
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep the count per order id', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order, other) => {
    const pasted = classifyInput(' 「p8472-9103-8475-610293」 ');
    const code = classifyInput(' ma 7k 2p ');
    noteDisplayedUse(order);
    noteDisplayedUse(other);
    noteDisplayedUse(order);
    return {
      good: orderFormatError(order),
      repeat: orderFormatError('P111111111111111111'),
      seq: orderFormatError('P123456789012345678'),
      p19: orderFormatError('P9900000000000001378'),
      p19c: classifyInput('P9900000000000001378').type,
      pasted,
      code,
      junk: classifyInput('hello').type,
      copy: orderSuccessText({ ok: true, uses: 1, remaining: 2, paidVerified: false }),
      lastCopy: orderSuccessText({ ok: true, uses: 3, remaining: 0, paidVerified: false }),
      laterCopy: orderSuccessText({ ok: true, uses: 4, remaining: 0, paidVerified: false }),
      paid: noteDisplayedUse(order).paidVerified,
      uses: shownOrderUses(order),
      other: shownOrderUses(other),
      key: ORDER_USES_KEY,
      stored: localStorage.getItem(ORDER_USES_KEY),
      foreign: localStorage.getItem('soft_persimmon_order_uses'),
    };
  }, ORDER, OTHER);
  assert(out.good === '' && out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids');
  assert(out.p19 === 'invalid' && out.p19c === 'order-invalid', '19-digit id must stay invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced code ' + JSON.stringify(out.code));
  assert(out.junk === 'order-invalid', 'junk classified ' + out.junk);
  assert(out.copy === '验证成功，还可以测 2 次', out.copy);
  assert(out.lastCopy === '验证成功，这是最后一次', out.lastCopy);
  assert(out.laterCopy === '验证成功', out.laterCopy);
  assert(out.paid === false, 'paidVerified must stay false');
  assert(out.uses === 3 && out.other === 1, 'count must be stored per order id ' + out.uses + '/' + out.other);
  assert(out.key === 'mental_age_order_uses' && out.stored && out.stored.includes(ORDER) && !out.stored.includes('soft_persimmon'), out.key);
  assert(out.foreign == null, 'must not reuse the soft-persimmon key');
  assert(!HTML.includes('soft_persimmon_order_uses'), 'page reuses another quiz key');
  assert(!HTML.includes(VERCEL_HOST) && !HTML.includes('/order/redeem') && !HTML.includes('/order/get'), 'page still calls the order API');
  assert(!HTML.includes('mantledb'), 'page calls Mantle');
  assert(HTML.includes("const LEGACY_API_BASE='https://" + LEGACY_HOST + "'"), 'vault host changed');
  assert(HTML.includes("LEGACY_API_BASE+'/redeem'") && HTML.includes("LEGACY_API_BASE+'/get?quiz='"), 'vault paths changed');
  assert(HTML.includes('paidVerified:false'), 'paidVerified flag dropped');
  assert(HTML.includes('看到路边小狗'), 'question copy changed');
  assert(HTML.includes('>输入订单号<'), 'input title changed');
  const orderCopy = HTML.slice(HTML.indexOf('function orderFailText'), HTML.indexOf('function codeSuccessText'));
  assert(!orderCopy.includes('次数已经用完') && !orderCopy.includes('暂时验证不了'), 'order path still hard-blocks');
  assert(HTML.includes('次数已经用完了'), 'exhausted access codes lost their message');
  assertNoOrderNet(state, 'format checks must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('valid order starts with no order network request', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const title = await page.$eval('h1', (el) => el.textContent);
  assert(title.includes('心理年龄测试'), title);
  await openAndSubmit(page, ' 「p8472-9103-8475-610293」 ');
  await waitQuiz(page);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('还可以测 2 次') && !toast.includes('付款') && !toast.includes('paidVerified'), toast);
  assert(await shownUses(page) === 1, 'first start should display one use');
  assert(await shownUses(page, OTHER) === 0, 'another id must stay at zero');
  const paid = await page.evaluate(() => document.body.innerText.includes('paidVerified') || document.body.innerText.includes('付款'));
  assert(!paid, 'payment flag leaked into the page');
  assertNoOrderNet(state, 'first start must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('19-digit, repeating, and sequence ids are rejected on the page', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'P111111111111111111');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.$eval('#codeInput', (el) => { el.value = 'P123456789012345678'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  await page.$eval('#codeInput', (el) => { el.value = 'P9900000000000001378'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号格式不对'));
  const quizOn = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!quizOn, 'rejected id started the quiz');
  assert(await shownUses(page, 'P111111111111111111') === 0, 'rejected id recorded a use');
  assertNoOrderNet(state, 'rejected ids must not hit the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('refresh, continue, result restore, and 查看上次结果 do not advance; 重新测试 does', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  const q1 = await page.$eval('#qtext', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const q1b = await page.$eval('#qtext', (el) => el.textContent);
  assert(q1b === q1, 'refresh changed the question');
  assert(await shownUses(page) === 1, 'refresh changed the display count');
  assertNoOrderNet(state, 'refresh must not call the network');

  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval('#qprog', (el) => el.textContent);
  assert(prog === '3 / 18', prog);
  const midText = await page.$eval('#qtext', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    text: document.getElementById('qtext').textContent,
    qi,
    a0: ans[0],
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.text === midText, 'mid refresh ' + JSON.stringify(resumed));
  assert(await shownUses(page) === 1, 'mid refresh changed the display count');
  assertNoOrderNet(state, 'mid refresh must not call the network');

  await page.click('#qback');
  await page.click('#qback');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    sel: document.querySelectorAll('#opts .opt.sel').length,
    a0: ans[0],
  }));
  assert(cont.prog === '1 / 18' && cont.sel === 1 && cont.a0 === 1, 'continue reset the attempt ' + JSON.stringify(cont));
  assert(await shownUses(page) === 1, 'continue changed the display count');
  assertNoOrderNet(state, 'continue must not call the network');

  await fastFinish(page);
  const age = await page.$eval('.index-num', (el) => el.textContent);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const age2 = await page.$eval('.index-num', (el) => el.textContent);
  assert(age2 === age && age, 'result refresh changed the result');
  assert(await shownUses(page) === 1, 'result refresh changed the display count');
  assertNoOrderNet(state, 'result refresh must not call the network');

  await page.click('#btnViewLast');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('不扣次'));
  assert(await shownUses(page) === 1, '查看上次结果 changed the display count');
  assertNoOrderNet(state, '查看上次结果 must not call the network');

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 2, '重新测试 should display the second use');
  const second = await page.$eval('#toast', (el) => el.textContent);
  assert(second.includes('还可以测 1 次'), second);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent, len: ans.length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  assertNoOrderNet(state, 'retest must not call the network');
  await fastFinish(page);

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(await shownUses(page) === 3, 'third displayed use');
  const third = await page.$eval('#toast', (el) => el.textContent);
  assert(third.includes('这是最后一次'), third);
  await fastFinish(page);

  await page.click('#btnRetry');
  await waitQuiz(page);
  await page.waitForFunction(() => document.getElementById('toast').textContent === '验证成功');
  const after = await page.evaluate((id) => ({
    quiz: document.getElementById('quiz').classList.contains('active'),
    toast: document.getElementById('toast').textContent,
    uses: shownOrderUses(id),
  }), ORDER);
  assert(after.quiz, 'a later entry must still open the quiz');
  assert(after.toast === '验证成功' && !after.toast.includes('用完') && !after.toast.includes('暂时验证不了'), after.toast);
  assert(after.uses === 4, 'later entry still records a display count');
  assertNoOrderNet(state, 'later entry must not call the network');
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('access code hits the vault, and a vault miss does not call Mantle', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ' ma 7k 2p ');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === 'mental' && state.bodies[0].code === CODE, 'vault body', state);
  assert(!state.bodies[0].orderId, 'code redeem must not send orderId', state);
  assert(state.urls.some((u) => u.startsWith('POST ' + LEGACY_HOST + '/redeem')), 'vault url', state);
  assert(!state.urls.some((u) => u.includes('vercel') || u.includes('/order/')), 'code redeem called an order endpoint', state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0 && state.mantleIncr === 0, 'vault hit must not call Mantle', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('还可以测 2 次'), toast);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();

  const miss = freshState();
  miss.vaultMode = 'not_found';
  const missed = await newPage(browser, miss);
  await openAndSubmit(missed.page, CODE);
  await missed.page.waitForFunction(() => document.getElementById('toast').textContent.includes('订单号不对'));
  const missQuiz = await missed.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!missQuiz, 'vault miss started the quiz');
  assert(miss.vaultPosts === 1 && miss.mantleGets === 0 && miss.mantleDecr === 0 && miss.mantleIncr === 0, 'vault miss must not call Mantle', miss);
  assert(!miss.urls.some((u) => u.includes('/order/') || u.includes('vercel')), 'vault miss called an order endpoint', miss);
  assert(await missed.page.evaluate(() => !isUnlocked()), 'vault miss unlocked');
  await missed.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完了'));
  const doneQuiz = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!doneQuiz && done.vaultPosts === 1 && done.mantleGets === 0 && done.mantleDecr === 0, 'exhausted vault fell through', done);
  await second.page.close();
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${LEGACY_HOST} 127.0.0.1, MAP ${VERCEL_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
