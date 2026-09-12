// 复现脚本：验证「改了上游话题/选题后，第 4 步是否还留着旧话题的切入点」。
// 这个 bug 曾经是真实存在的：当时的 useEffect 只调用了 setOptions() 重新生成候选，
// 从来没处理已选；而 value.selected 里存的是旧候选对象的拷贝，所以永远不会自己更新。
//
// 用法：node probe-stale-angle.mjs [baseUrl]   默认 http://127.0.0.1:5240/
// 现在应当输出「已选 0 个」，并看到一句说明：「选题变了，原来的切入点已经不适用，已清空，请重新选。」

import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5240/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 多草稿存储：取当前打开的那一份 */
const readActive = (page) =>
  page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('content-wizard.drafts.v1') ?? '{}');
    const drafts = store.drafts ?? [];
    return drafts.find((d) => d.id === store.activeId) ?? drafts[0] ?? null;
  });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1280, height: 950 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${BASE}${BASE.includes('?') ? '&' : '?'}debug=1`, { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await sleep(300);

const clickOption = async (label) => {
  await page.evaluate((lbl) => {
    const bs = Array.from(document.querySelectorAll('button.option'));
    const t = bs.find((n) =>
      ((n.querySelector('.option-label') ?? n).textContent ?? '').replace(/\s+/g, ' ').trim().includes(lbl),
    );
    if (t && !t.disabled) t.click();
  }, label);
  await sleep(250);
};
const nextBtn = async () => {
  await page.evaluate(() => {
    const b = document.querySelector('button.btn.primary');
    if (b && !b.disabled) b.click();
  });
  await sleep(450);
};
const setInput = async (selector, value) => {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`找不到输入框：${sel}`);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );
};
const selectedAngles = async () => (await readActive(page))?.state?.angle?.selected ?? [];
const angleCards = () => page.$$eval('button.option .option-hint', (ns) => ns.map((n) => (n.textContent ?? '').trim()));
const gotoPill = async (layer) => {
  await page.evaluate((l) => {
    Array.from(document.querySelectorAll('button.step-pill'))
      .find((p) => (p.textContent ?? '').includes(l))
      ?.click();
  }, layer);
  await sleep(600);
};

// 走完 1→4，选题用「第一次做这件事的人」
await clickOption('已关注我的人');
await nextBtn();
await page.type('#topic-big', '情感');
await sleep(900);
await clickOption('约会');
await nextBtn();
await clickOption('第一次做这件事的人');
await setInput('#subject-what', '怎么让这次约会聊得舒服');
await sleep(300);
await nextBtn();
await sleep(600);

await clickOption('具体场景');
await clickOption('普遍误区');
console.log('【改上游前】已选切入点：');
for (const a of await selectedAngles()) console.log(`   [${a.label}] ${a.text}`);

// 回到第 3 步换一个完全不同的选题，再把话题也换掉
await gotoPill('选题');
await setInput('#subject-what', '预算有限时怎么开始做宠物殡葬');
await sleep(300);
await gotoPill('话题');
await setInput('#topic-big', '宠物殡葬');
await sleep(1200);
await page.evaluate(() => {
  const first = document.querySelector('button.option');
  if (first instanceof HTMLButtonElement && !first.disabled) first.click();
});
await sleep(300);
await gotoPill('切入点');
await sleep(800);

const after = await selectedAngles();
const cards = await angleCards();
const banner = await page.evaluate(
  () => (document.querySelector('.reset-banner')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
);
const pageText = await page.evaluate(() => document.body.textContent ?? '');

console.log('\n【换掉话题与选题后】');
console.log('  当前候选（新话题）：');
for (const t of cards.slice(0, 3)) console.log(`   · ${t}`);
console.log(`  已选切入点：${after.length} 个（应为 0）`);
for (const a of after) console.log(`   [${a.label}] ${a.text}`);
const staleOnes = after.filter((a) => !cards.includes(a.text));
console.log(`\n  清空说明：${banner || '（没有说明 —— 这就是静默清空，不合格）'}`);
console.log(`  残留旧文案：${staleOnes.length} 个；页面是否仍出现旧选题文字：${pageText.includes('怎么让这次约会聊得舒服')}`);
console.log(
  `\n  结论：${after.length === 0 && banner.includes('已清空') ? '已修复：候选重生成后旧选择立即作废并说明了原因' : '仍有问题'}`,
);

await page.screenshot({ path: 'shots/probe-stale-angle.png', fullPage: true });
await browser.close();
