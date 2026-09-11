// 移动端验收截图：单列布局与触控区尺寸检查。
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] ?? 'http://127.0.0.1:5240/';
const SHOTS = resolve(import.meta.dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});
await mkdir(SHOTS, { recursive: true });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle0' });

async function clickOption(label) {
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll('button.option'));
    const t = btns.find((n) =>
      ((n.querySelector('.option-label') ?? n).textContent ?? '').replace(/\s+/g, ' ').trim().includes(lbl),
    );
    t?.click();
  }, label);
  await sleep(250);
}
async function next() {
  await page.evaluate(() => {
    const b = document.querySelector('button.btn.primary');
    if (b && !b.disabled) b.click();
  });
  await sleep(420);
}

// 第 1 步：移动端截图 + 触控区测量
await page.screenshot({ path: resolve(SHOTS, 'mobile-step1.png'), fullPage: true });
const metrics = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button.option'));
  const primary = document.querySelector('button.btn.primary');
  const rects = [...btns, primary].filter(Boolean).map((b) => {
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  return {
    视口宽: window.innerWidth,
    是否有横向滚动: document.documentElement.scrollWidth > window.innerWidth + 1,
    最小高度: Math.min(...rects.map((r) => r.h)),
    最小宽度: Math.min(...rects.map((r) => r.w)),
    选项列数: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().left))).size,
  };
});
console.log('第 1 步移动端指标：', JSON.stringify(metrics, null, 1));

// 走到第 4 步（卡片最密的一屏）
await clickOption('已关注我的人');
await next();
await page.type('#topic-big', '情感');
await sleep(800);
await clickOption('约会');
await next();
await clickOption('第一次做这件事的人');
await page.type('#subject-what', '怎么让这次约会聊得舒服');
await next();
await sleep(500);
await page.screenshot({ path: resolve(SHOTS, 'mobile-step4.png'), fullPage: true });
const m4 = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button.option'));
  const card = btns[0]?.getBoundingClientRect();
  return {
    视口宽: window.innerWidth,
    是否有横向滚动: document.documentElement.scrollWidth > window.innerWidth + 1,
    卡片宽: card ? Math.round(card.width) : null,
    卡片高: card ? Math.round(card.height) : null,
    选项列数: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().left))).size,
  };
});
console.log('第 4 步移动端指标：', JSON.stringify(m4, null, 1));

await browser.close();
