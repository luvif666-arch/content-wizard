// 专项验收：用一个内置预设库覆盖不到的话题（宠物殡葬），
// 检查第 3 步是否仍能给出 4 个以上与这个话题真正相关的具体人物示例。
// 用法：node verify-coverage.mjs [baseUrl]

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5240/';
const PAGE_URL = `${BASE}${BASE.includes('?') ? '&' : '?'}debug=1`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = resolve(import.meta.dirname, 'shots');
const TOPIC = process.argv[3] ?? '宠物殡葬';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 980 },
});

try {
  await mkdir(SHOTS, { recursive: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[页面异常] ${e.message}`));
  await page.goto(PAGE_URL, { waitUntil: 'networkidle0' });

  // 走到第 2 步
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.option'));
    btns.find((b) => (b.textContent ?? '').includes('已关注我的人'))?.click();
  });
  await page.evaluate(() => document.querySelector('button.btn.primary')?.click());
  await sleep(350);

  // 输入一个预设库覆盖不到的话题
  await page.type('#topic-big', TOPIC);
  await sleep(900);

  const subs = await page.$$eval('button.option .option-label', (ns) =>
    ns.map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim()),
  );
  check(
    `「${TOPIC}」能给出子话题候选`,
    subs.length >= 3,
    subs.slice(0, 4).join(' / '),
  );

  // 选第一个子话题并进入第 3 步
  await page.evaluate(() => document.querySelector('button.option')?.click());
  await sleep(250);
  await page.evaluate(() => document.querySelector('button.btn.primary')?.click());
  await sleep(400);

  await page.waitForSelector('.inspire-card', { timeout: 6000 });
  const info = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.inspire-card'));
    return {
      count: cards.length,
      labels: cards.map((c) => (c.querySelector('.tag')?.textContent ?? '').trim()),
      texts: cards.map((c) => (c.querySelector('.inspire-what')?.textContent ?? '').trim()),
      source: (document.querySelector('.inspire-head .tag')?.textContent ?? '').trim(),
    };
  });

  check(
    '第 3 步仍给出 4 条以上示例（不是空白）',
    info.count >= 4,
    `${info.count} 条`,
  );
  check(
    '示例与当前话题真正相关，不是通用模板',
    info.texts.every((t) => t.includes(TOPIC) || t.includes(subs[0])) && info.texts.every((t) => t.length >= 12),
    `例如：${info.texts[0]?.slice(0, 42)}…`,
  );
  check(
    '示例覆盖多种不同处境',
    new Set(info.labels).size >= 4,
    info.labels.join(' / '),
  );
  check(
    '来源如实标注（模板拼出来的不冒充内置文案）',
    info.source === '内置库' || info.source === '模板推导',
    `「${info.source}」`,
  );

  await page.screenshot({ path: resolve(SHOTS, 'coverage-offtopic.png'), fullPage: true });
} catch (err) {
  check('脚本执行完成', false, String(err?.message ?? err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log('\n================ 汇总 ================');
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
process.exit(failed.length ? 1 : 0);
