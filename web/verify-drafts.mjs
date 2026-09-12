// 草稿箱与「候选重生成 ⇒ 旧选择作废」的专项验收。
// 用法：node verify-drafts.mjs [baseUrl]   默认 http://127.0.0.1:5240/
//
// 逐条对应这次的需求：
//   未完成的草稿存下来后能新建另一份，两份互不干扰；来回切换时下游不会串味；
//   改话题或选题之后，第 4 步已选的切入点自动清空并给出原因；
//   用一个完全不同的方向做同一件事，第 4 步不出现任何旧话题的文案；
//   草稿箱显示标题 / 已完成几步 / 最后编辑时间，能新建、打开、重命名、删除（二次确认）；
//   窄屏下草稿箱折叠成抽屉，不挤掉六步主流程。

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5240/';
const PAGE_URL = `${BASE}${BASE.includes('?') ? '&' : '?'}debug=1`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = resolve(import.meta.dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function clickByText(page, selector, text, matchMode = 'contains') {
  const handle = await page.evaluateHandle(
    (sel, txt, mode) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.find((n) => {
        const label = n.querySelector?.('.option-label');
        const t = ((label ?? n).textContent ?? '').replace(/\s+/g, ' ').trim();
        if (mode === 'exact') return t === txt;
        if (mode === 'startsWith') return t.startsWith(txt);
        return t.includes(txt);
      });
    },
    selector,
    text,
    matchMode,
  );
  const el = handle.asElement();
  if (!el) {
    const available = await page.$$eval(selector, (ns) =>
      ns.map((n) => ((n.querySelector?.('.option-label') ?? n).textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    throw new Error(`找不到元素：${selector} 包含「${text}」；当前可用：[${available.join(' | ')}]`);
  }
  if (await el.evaluate((n) => n.disabled === true)) throw new Error(`元素被禁用：${selector}「${text}」`);
  await el.click();
}

async function bodyText(page) {
  return page.evaluate(() => document.body.textContent ?? '');
}

async function setInputValue(page, selector, value) {
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
}

async function next(page) {
  await clickByText(page, 'button.btn.primary', '下一步');
  await sleep(400);
}

async function readStore(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('content-wizard.drafts.v1') ?? '{}'));
}

async function activeDraft(page) {
  const store = await readStore(page);
  const drafts = store.drafts ?? [];
  return drafts.find((d) => d.id === store.activeId) ?? drafts[0] ?? null;
}

/** 按标题点开某一份草稿（重命名中时标题输入框里还留着原名，也要认出来） */
async function openDraftByTitle(page, title) {
  await page.evaluate((t) => {
    const card = Array.from(document.querySelectorAll('.draft-card')).find((c) => {
      const shown = c.querySelector('.draft-title')?.textContent ?? '';
      const input = c.querySelector('.draft-rename input');
      return shown.includes(t) || (input && input.value.includes(t));
    });
    card?.querySelector('.draft-open')?.click();
  }, title);
  await sleep(500);
}

/** 点某份草稿卡片上的按钮（重命名 / 删除 / 取消 / 确认删除 / 保存名称） */
async function clickDraftButton(page, title, label) {
  await page.evaluate(
    (t, lbl) => {
      const card = Array.from(document.querySelectorAll('.draft-card')).find((c) => {
        const shown = c.querySelector('.draft-title')?.textContent ?? '';
        const input = c.querySelector('.draft-rename input');
        return shown.includes(t) || (input && input.value.includes(t));
      });
      const btn = Array.from(card?.querySelectorAll('.draft-card-actions button') ?? []).find(
        (b) => (b.textContent ?? '').trim() === lbl,
      );
      btn?.click();
    },
    title,
    label,
  );
  await sleep(350);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 950 },
});

try {
  await mkdir(SHOTS, { recursive: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[页面异常] ${e.message}`));

  // ---------- 0. 干净起步 ----------
  await page.goto(PAGE_URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);

  const initialCards = await page.$$eval('.draft-card', (ns) => ns.length);
  check('草稿箱默认就有一份空草稿，不会出现空列表', initialCards === 1, `${initialCards} 份`);

  // ---------- 1. 填第一份草稿到第 4 步并选 2 个切入点 ----------
  await clickByText(page, 'button.option', '完全陌生的人');
  await sleep(200);
  await next(page);
  await page.type('#topic-big', '情感');
  await page.waitForFunction(() => document.querySelectorAll('button.option').length >= 3, { timeout: 6000 });
  await clickByText(page, 'button.option', '约会', 'exact');
  await sleep(200);
  await next(page);
  await clickByText(page, 'button.option', '第一次做这件事的人');
  await setInputValue(page, '#subject-what', '怎么让这次约会聊得舒服，让对方愿意继续了解你');
  await sleep(250);
  await next(page);
  await page.waitForFunction(() => document.querySelectorAll('button.option').length >= 6, { timeout: 6000 });
  await clickByText(page, 'button.option', '具体场景', 'exact');
  await clickByText(page, 'button.option', '普遍误区', 'exact');
  await sleep(300);

  const cardMeta = await page.evaluate(() => {
    const card = document.querySelector('.draft-card');
    return {
      title: (card?.querySelector('.draft-title')?.textContent ?? '').trim(),
      meta: (card?.querySelector('.draft-meta')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      current: !!card?.querySelector('.draft-current'),
    };
  });
  check('草稿标题自动取「大方向 + 子话题」', cardMeta.title === '情感 · 约会', cardMeta.title);
  check('草稿箱显示已完成几步', cardMeta.meta.includes('已完成 4/6'), cardMeta.meta);
  check('草稿箱显示最后编辑时间', /最后编辑 (刚刚|\d+ 分钟前|\d+ 小时前|\d{2}-\d{2} \d{2}:\d{2})/.test(cardMeta.meta), cardMeta.meta);
  check('当前打开的草稿有明确标记', cardMeta.current, '标了「当前打开」');

  const angleBefore = (await activeDraft(page))?.state?.angle?.selected?.length ?? 0;
  check('第 4 步已选 2 个切入点（改上游前的基线）', angleBefore === 2, `已选 ${angleBefore} 个`);
  await page.screenshot({ path: resolve(SHOTS, 'drafts-two-col.png') });

  // ---------- 2. 换一个完全不同的方向，第 4 步必须自动清空并说明原因 ----------
  await clickByText(page, 'button.step-pill', '话题');
  await sleep(400);
  await setInputValue(page, '#topic-big', '宠物殡葬');
  await sleep(1200);
  await page.evaluate(() => {
    const first = document.querySelector('button.option');
    if (first instanceof HTMLButtonElement && !first.disabled) first.click();
  });
  await sleep(300);
  await clickByText(page, 'button.step-pill', '选题');
  await sleep(400);
  await setInputValue(page, '#subject-what', '预算有限时怎么开始做宠物殡葬');
  await sleep(250);
  await clickByText(page, 'button.option', '正在做选择、拿不定主意的人');
  await sleep(400);

  await clickByText(page, 'button.step-pill', '切入点');
  await sleep(800);

  const afterTopicChange = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('content-wizard.drafts.v1') ?? '{}');
    const d = (store.drafts ?? []).find((x) => x.id === store.activeId) ?? (store.drafts ?? [])[0];
    return {
      selected: d?.state?.angle?.selected?.length ?? 0,
      snapshot: d?.snapshots?.angle ?? null,
      banner: (document.querySelector('.reset-banner')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      cards: Array.from(document.querySelectorAll('button.option .option-hint')).map((n) => (n.textContent ?? '').trim()),
      text: document.body.textContent ?? '',
    };
  });
  check(
    '改话题与选题后回到第 4 步，已选切入点自动清空（不需要手动取消）',
    afterTopicChange.selected === 0,
    `已选 ${afterTopicChange.selected} 个`,
  );
  check(
    '清空时明确说明原因：「选题变了，原来的切入点已经不适用，已清空，请重新选」',
    afterTopicChange.banner.includes('选题变了') &&
      afterTopicChange.banner.includes('原来的切入点已经不适用') &&
      afterTopicChange.banner.includes('已清空，请重新选'),
    afterTopicChange.banner || '没抓到说明',
  );
  check(
    '第 4 步不出现任何旧话题的文案',
    !afterTopicChange.text.includes('怎么让这次约会聊得舒服') &&
      !afterTopicChange.text.includes('让对方愿意继续了解你') &&
      !afterTopicChange.cards.some((c) => c.includes('约会')),
    `旧文案已随候选一起作废；当前候选示例：${afterTopicChange.cards[0]?.slice(0, 26)}…`,
  );
  check(
    '旧选择不会被当成「待确认」留在页面上（该项快照已撤销）',
    afterTopicChange.snapshot === null && !afterTopicChange.banner.includes('沿用当前答案'),
    '清空就是清空，不是保留待确认',
  );
  await page.screenshot({ path: resolve(SHOTS, 'drafts-angle-cleared.png'), fullPage: true });

  // ---------- 3. 新建草稿：上一份必须留在草稿箱里 ----------
  await clickByText(page, 'button.btn', '新建草稿');
  await sleep(500);
  const afterNew = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('content-wizard.drafts.v1') ?? '{}');
    return {
      count: (store.drafts ?? []).length,
      titles: (store.drafts ?? []).map((d) => d.title),
      activeTitle: ((store.drafts ?? []).find((d) => d.id === store.activeId) ?? {}).title ?? null,
      stepText: document.body.textContent ?? '',
      index: window.__wizardDebug?.index ?? null,
      keptWhat:
        ((store.drafts ?? []).find((d) => d.title.startsWith('宠物殡葬')) ?? {}).state?.subject?.what ?? null,
    };
  });
  check('「新建草稿」后草稿箱里有两份', afterNew.count === 2, afterNew.titles.join(' | '));
  check('新建后当前打开的是一份全新草稿', afterNew.activeTitle === '未命名草稿', String(afterNew.activeTitle));
  check('新建草稿后回到第 1 步且内容为空', afterNew.index === 0 && afterNew.stepText.includes('这条内容是给谁看的'), `index=${afterNew.index}`);
  check(
    '原来那份半成品被完整保留下来（没做完也能存住）',
    afterNew.keptWhat === '预算有限时怎么开始做宠物殡葬',
    String(afterNew.keptWhat),
  );

  // ---------- 4. 第二份草稿填成完全不同的内容 ----------
  await clickByText(page, 'button.option', '同行的从业者');
  await sleep(200);
  await next(page);
  await page.type('#topic-big', '职场');
  await page.waitForFunction(() => document.querySelectorAll('button.option').length >= 3, { timeout: 6000 });
  await clickByText(page, 'button.option', '转行', 'exact');
  await sleep(200);
  await next(page);
  await clickByText(page, 'button.option', '已经做了但结果不好、在怀疑自己的人');
  await setInputValue(page, '#subject-what', '做了三年想转行却不敢投简历');
  await sleep(250);

  const twoDrafts = await readStore(page);
  check(
    '两份草稿的标题各自跟着自己的方向走',
    twoDrafts.drafts.some((d) => d.title === '职场 · 转行') &&
      twoDrafts.drafts.some((d) => d.title.startsWith('宠物殡葬')),
    twoDrafts.drafts.map((d) => d.title).join(' | '),
  );

  // ---------- 5. 来回切换：下游不能串味 ----------
  await openDraftByTitle(page, '宠物殡葬');
  const backToA = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('content-wizard.drafts.v1') ?? '{}');
    const d = (store.drafts ?? []).find((x) => x.id === store.activeId) ?? (store.drafts ?? [])[0];
    const quote = (document.querySelector('.quote')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      index: window.__wizardDebug?.index ?? null,
      selected: d?.state?.angle?.selected?.length ?? 0,
      quote,
      cards: Array.from(document.querySelectorAll('button.option .option-hint')).map((n) => (n.textContent ?? '').trim()),
      topicValue: document.querySelector('#topic-big')?.value ?? null,
    };
  });
  check(
    '切回第一份草稿，停在自己没做完的那一步（第 4 步）',
    backToA.index === 3,
    `index=${backToA.index}`,
  );
  check(
    '切回来的这一份显示的是它自己的选题，不是另一份的',
    backToA.quote.includes('预算有限时怎么开始做宠物殡葬') && !backToA.quote.includes('转行'),
    backToA.quote.slice(0, 56),
  );
  check(
    '第 4 步的候选里没有任何另一份草稿的内容',
    !backToA.cards.some((c) => c.includes('转行') || c.includes('投简历')),
    `候选示例：${backToA.cards[0]?.slice(0, 26)}…`,
  );
  check('这份草稿的已选切入点仍是清空后的状态', backToA.selected === 0, `已选 ${backToA.selected} 个`);

  await openDraftByTitle(page, '职场 · 转行');
  // 它只填到第 3 步，打开时会停在第 4 步；回第 3 步看它自己的内容
  await clickByText(page, 'button.step-pill', '选题');
  await sleep(400);
  const backToB = await page.evaluate(() => {
    const col = document.querySelector('.wizard-col');
    return {
      what: document.querySelector('#subject-what')?.value ?? null,
      who: (col?.querySelector('.option.selected .option-label')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      quote: (col?.querySelector('.quote')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      colText: col?.textContent ?? '',
    };
  });
  check(
    '切到第二份草稿，第 3 步显示的是它自己的「对谁说什么」',
    backToB.what === '做了三年想转行却不敢投简历' &&
      backToB.quote.includes('转行') &&
      !backToB.colText.includes('宠物殡葬'),
    `what=${backToB.what}｜${backToB.quote}`,
  );
  check(
    '第二份草稿的「具体的人」也是它自己的，不会留着上一份的临时输入',
    backToB.who.includes('已经做了但结果不好'),
    `who=${backToB.who}`,
  );

  // ---------- 6. 重命名 ----------
  await openDraftByTitle(page, '宠物殡葬');
  await clickDraftButton(page, '宠物殡葬', '重命名');
  await setInputValue(page, '.draft-rename input', '宠物殡葬选题（我的）');
  await clickDraftButton(page, '宠物殡葬', '保存名称');
  const renamed = await readStore(page);
  const renamedDraft = renamed.drafts.find((d) => d.title === '宠物殡葬选题（我的）');
  check('草稿可以重命名', !!renamedDraft, renamed.drafts.map((d) => d.title).join(' | '));
  check('重命名之后不再被自动标题覆盖', renamedDraft?.autoTitle === false, `autoTitle=${renamedDraft?.autoTitle}`);
  await page.screenshot({ path: resolve(SHOTS, 'drafts-renamed.png') });

  // ---------- 7. 删除要二次确认 ----------
  await clickDraftButton(page, '职场 · 转行', '删除');
  const pendingDelete = await page.evaluate(() => ({
    confirmShown: !!document.querySelector('.draft-confirm'),
    confirmText: (document.querySelector('.draft-confirm-text')?.textContent ?? '').trim(),
    count: JSON.parse(localStorage.getItem('content-wizard.drafts.v1') ?? '{}').drafts.length,
  }));
  check(
    '点删除先要二次确认，不会立刻删掉',
    pendingDelete.confirmShown && pendingDelete.count === 2,
    pendingDelete.confirmText || '没出现确认提示',
  );

  await clickDraftButton(page, '职场 · 转行', '取消');
  const afterCancel = await readStore(page);
  check('二次确认可以取消，草稿还在', afterCancel.drafts.length === 2, afterCancel.drafts.map((d) => d.title).join(' | '));

  await clickDraftButton(page, '职场 · 转行', '删除');
  await clickDraftButton(page, '职场 · 转行', '确认删除');
  const afterDelete = await readStore(page);
  check(
    '确认后才真的删掉，且只删这一份',
    afterDelete.drafts.length === 1 && afterDelete.drafts[0].title === '宠物殡葬选题（我的）',
    afterDelete.drafts.map((d) => d.title).join(' | '),
  );

  // 删掉当前打开的那一份时，界面要自动换到另一份，不能停在空白上
  await openDraftByTitle(page, '宠物殡葬选题（我的）');
  await clickDraftButton(page, '宠物殡葬选题（我的）', '删除');
  await clickDraftButton(page, '宠物殡葬选题（我的）', '确认删除');
  const afterDeleteActive = await readStore(page);
  const activeAfterDelete = afterDeleteActive.drafts.find((d) => d.id === afterDeleteActive.activeId);
  const uiAfterDelete = await page.evaluate(() => ({
    count: document.querySelectorAll('.draft-card').length,
    text: document.body.textContent ?? '',
  }));
  check(
    '删掉最后一份时会自动补一份空草稿，界面不会留下空白',
    afterDeleteActive.drafts.length === 1 &&
      uiAfterDelete.count === 1 &&
      uiAfterDelete.text.includes('这条内容是给谁看的') &&
      !!activeAfterDelete,
    `剩「${activeAfterDelete?.title}」`,
  );

  // ---------- 8. 窄屏：草稿箱折叠成抽屉 ----------
  await page.setViewport({ width: 420, height: 880 });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);
  const narrow = await page.evaluate(() => {
    const box = document.querySelector('.draftbox');
    const toggle = document.querySelector('.draft-toggle');
    return {
      position: box ? getComputedStyle(box).position : 'missing',
      transform: box ? getComputedStyle(box).transform : 'missing',
      toggleVisible: !!toggle && toggle.offsetParent !== null,
      mainVisible: (document.body.textContent ?? '').includes('这条内容是给谁看的'),
    };
  });
  check('窄屏下草稿箱不再占据版面（变成抽屉）', narrow.position === 'fixed', `position=${narrow.position}`);
  check('窄屏下草稿箱默认收起，不挤掉主流程', narrow.transform !== 'none' && narrow.mainVisible, `transform=${narrow.transform}`);
  check('窄屏下顶部有草稿箱入口', narrow.toggleVisible, '「草稿箱 N」入口可见');

  await clickByText(page, 'button.linkbtn', '草稿箱');
  await sleep(400);
  const drawerOpen = await page.evaluate(() => {
    const box = document.querySelector('.draftbox');
    return {
      open: !!box?.classList.contains('open'),
      transform: box ? getComputedStyle(box).transform : 'missing',
      cards: document.querySelectorAll('.draft-card').length,
    };
  });
  check(
    '点顶部入口能展开草稿箱抽屉',
    drawerOpen.open && drawerOpen.transform === 'none' && drawerOpen.cards >= 1,
    `transform=${drawerOpen.transform}，${drawerOpen.cards} 份草稿`,
  );
  await page.screenshot({ path: resolve(SHOTS, 'drafts-mobile-drawer.png') });

  // ---------- 9. 旧版「只有一份草稿」的用户，升级后那份草稿不能丢 ----------
  await page.setViewport({ width: 1280, height: 950 });
  await page.evaluate(() => {
    localStorage.clear();
    // 旧版的存储形态：一份草稿 + 一份快照，各占一个 key
    localStorage.setItem(
      'content-wizard.draft.v1',
      JSON.stringify({
        audience: { id: 'stranger', label: '完全陌生的人', implies: '需要从头建立语境，不能跳步。' },
        topic: { big: '理财', subs: ['记账'] },
        subject: { who: { id: 'first-timer', label: '第一次做这件事的人', hint: '' }, what: '怎么开始记账才坚持得下来' },
        angle: null,
        title: null,
        expression: null,
      }),
    );
    localStorage.setItem('content-wizard.snapshots.v1', JSON.stringify({}));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(600);
  const migrated = await readStore(page);
  check(
    '旧版单草稿会自动迁移成草稿箱里的第一份（半成品不丢）',
    migrated.drafts?.length === 1 &&
      migrated.drafts[0].state.topic?.big === '理财' &&
      migrated.drafts[0].state.subject?.what === '怎么开始记账才坚持得下来',
    migrated.drafts?.[0]?.title ?? '没迁移成功',
  );
  check(
    '迁移进来的草稿标题按同一套规则生成',
    migrated.drafts?.[0]?.title === '理财 · 记账',
    migrated.drafts?.[0]?.title ?? '',
  );
  const migratedView = await page.evaluate(() => ({
    cards: document.querySelectorAll('.draft-card').length,
    meta: (document.querySelector('.draft-meta')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    staleMarks: document.querySelectorAll('.stale-mark').length,
  }));
  check(
    '迁移进来的草稿带着原有进度，且不会一进来就满屏「待确认」',
    migratedView.cards === 1 && migratedView.meta.includes('已完成 3/6') && migratedView.staleMarks === 0,
    migratedView.meta,
  );
} catch (err) {
  check('脚本执行完成', false, String(err?.message ?? err));
  try {
    const pages = await browser.pages();
    const p = pages[pages.length - 1];
    await p.screenshot({ path: resolve(SHOTS, 'FAILURE-drafts.png'), fullPage: true });
    console.log('\n----- 失败现场页面文本 -----');
    console.log((await p.evaluate(() => document.body.innerText)).slice(0, 1200));
    console.log('----- 现场文本结束 -----\n');
  } catch {
    // 拿不到现场就算了，不要盖住原始错误
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log('\n================ 汇总 ================');
console.log(`通过 ${results.length - failed.length} / ${results.length}`);
if (failed.length) {
  console.log('未通过：');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
}
process.exit(failed.length ? 1 : 0);
