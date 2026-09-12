// 端到端验证：用真实 Chrome 走完 6 步，并逐条核对需求里的验收标准。
// 用法：node verify.mjs [baseUrl]   默认 http://127.0.0.1:5240/

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5240/';
// 带 ?debug=1 才会挂载 window.__wizardDebug（生产默认不挂载）
const PAGE_URL = `${BASE}${BASE.includes('?') ? '&' : '?'}debug=1`;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = resolve(import.meta.dirname, 'shots');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 按可见文本点击元素。
 * matchMode: 'contains'（默认）| 'exact' | 'startsWith'
 * 若目标是禁用按钮，明确报错而不是静默无效。
 */
async function clickByText(page, selector, text, matchMode = 'contains') {
  const handle = await page.evaluateHandle(
    (sel, txt, mode) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.find((n) => {
        // 选项卡片的标题在 .option-label 里；整张卡片还包含说明文字，直接比对会失配
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
  const disabled = await el.evaluate((n) => n.disabled === true);
  if (disabled) throw new Error(`元素被禁用，无法点击：${selector}「${text}」`);
  await el.click();
  return true;
}

async function bodyText(page) {
  // 用 textContent 而不是 innerText：innerText 只返回视口内的文本，
  // 页面滚动后会漏掉内容，导致断言假失败。
  return page.evaluate(() => document.body.textContent ?? '');
}

/** 读取「下一步」按钮当前的禁用状态 */
async function nextDisabled(page) {
  return page.$eval('button.btn.primary', (b) => b.disabled === true);
}

/** 读取页面上的拦截/提示文本 */
async function notices(page) {
  return page.$$eval('.notice', (ns) => ns.map((n) => (n.textContent ?? '').trim()));
}

/**
 * 直接给输入框赋值并派发 input 事件。
 * page.type() 是逐字符输入，几百字的 JSON 会因为太慢而超时截断，所以这里走原生 setter，
 * 让 React 的 onChange 正常收到变更。
 */
async function setInputValue(page, selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`找不到输入框：${sel}`);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    selector,
    value,
  );
}

async function next(page) {
  await clickByText(page, 'button.btn.primary', '下一步');
  await new Promise((r) => setTimeout(r, 350));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  await mkdir(SHOTS, { recursive: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[页面异常] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console.error] ${m.text()}`);
  });

  // ---------- 1. 冷启动 ----------
  await page.goto(PAGE_URL, { waitUntil: 'networkidle0' });
  let text = await bodyText(page);
  check('页面能加载并渲染第 1 步', text.includes('这条内容是给谁看的'), '无白屏、无报错');

  // ---------- 1b. 定位卡片：没读过原文也能看懂自己在回答什么 ----------
  const orient = await page.$eval('.orient', (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).catch(() => '');
  check(
    '第 1 步有定位卡片讲清「跟一个人聊天」的参照系',
    orient.includes('跟一个人聊天') && orient.includes('对面坐着谁'),
    orient ? `卡片开头：${orient.slice(0, 34)}…` : '没找到 .orient',
  );
  check(
    '定位卡片说明使用者是创作者、并交代「你／他」指谁',
    orient.includes('你是创作者') && orient.includes('读者'),
    '不必再倒推是谁的视角',
  );
  check(
    '定位卡片不剧透后面的步骤',
    !orient.includes('切入点') && !orient.includes('选题') && !orient.includes('标题'),
    '只讲类比，不提前给结论',
  );

  // 只检查 5 个受众预设；「其他（我自己描述）」的说明是操作指引，不适用这条规则
  let hintTexts = await page.$$eval('button.option:not(:last-of-type) .option-hint', (ns) =>
    ns.map((n) => (n.textContent ?? '').trim()),
  );
  check(
    '受众选项的说明用第二人称，看不出是谁的视角就不合格',
    hintTexts.length >= 5 &&
      hintTexts.every((h) => h.startsWith('你') || h.startsWith('他')) &&
      // 不能出现指代不明的「我」——之前写的是「对我和我的领域一无所知」
      hintTexts.every((h) => !h.includes('我')),
    hintTexts.slice(0, 2).join(' / '),
  );
  check(
    '界面上不出现原文摘录',
    !text.includes('抿一下你们大概能打成什么关系'),
    '按用户决定：只留流程本身，不引原文',
  );

  // ---------- 2. 未填不能前进（不能跳过步骤） ----------
  let disabled = await nextDisabled(page);
  let notes = await notices(page);
  check(
    '第 1 步未选时无法进入第 2 步',
    disabled && notes.some((n) => n.includes('还没选这条内容给谁看')),
    '按钮禁用，并给出明确原因而不是放行',
  );

  // ---------- 3. 第 1 步：受众 ----------
  await clickByText(page, 'button.option', '已关注我的人');
  await sleep(250);
  text = await bodyText(page);
  check(
    '选中后仍不出现原文摘录',
    !text.includes('抿一下你们大概能打成什么关系'),
    '摘录已按用户要求整段移除',
  );

  await next(page);
  text = await bodyText(page);
  check('第 1 步可选并进入第 2 步', text.includes('你想聊哪个大方向'));

  // ---------- 4. 第 2 步：输入「情感」出现子话题候选 ----------
  await page.type('#topic-big', '情感');
  await page.waitForFunction(
    () => document.querySelectorAll('button.option').length >= 3,
    { timeout: 6000 },
  );
  text = await bodyText(page);
  const subCount = await page.$$eval('button.option', (n) => n.length);
  check('输入「情感」出现可选子话题', subCount >= 3 && text.includes('约会'), `候选数 ${subCount}，含「约会」`);
  check('候选来源被如实标注', text.includes('内置预设'), '标注为内置预设而不是假装模型生成');
  await page.screenshot({ path: resolve(SHOTS, 'step2-topic.png') });

  // （不选子话题，下一步应保持禁用）
  disabled = await nextDisabled(page);
  notes = await notices(page);
  check(
    '第 2 步未选子话题时无法前进',
    disabled && notes.some((n) => n.includes('更小的子话题') || n.includes('范围还圈得太大')),
    '提醒而不是放行',
  );

  // 选 2 个子话题
  await clickByText(page, 'button.option', '约会', 'exact');
  await clickByText(page, 'button.option', '暧昧期', 'exact');
  await sleep(250);

  // ---------- 4b. 已选范围必须可以删减 ----------
  const chipInfo = await page.evaluate(() => ({
    chips: Array.from(document.querySelectorAll('.chip')).map((c) => (c.textContent ?? '').replace('×', '').trim()),
    hasRemove: document.querySelectorAll('.chip-remove').length,
    hasClear: Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === '清空'),
  }));
  check(
    '已选范围显示成可删减的标签',
    chipInfo.chips.length === 2 && chipInfo.hasRemove === 2,
    `标签：${chipInfo.chips.join('、')}`,
  );

  // 点 × 删掉一个
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('.chip-remove')).find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('约会'),
    );
    target?.click();
  });
  await sleep(300);
  let subsNow = await page.$$eval('.chip', (ns) => ns.map((c) => (c.textContent ?? '').replace('×', '').trim()));
  check('点标签上的 × 可以去掉已选范围', subsNow.length === 1 && subsNow[0] === '暧昧期', `剩：${subsNow.join('、')}`);

  // 自定义添加的分支也必须能删——这是之前真正缺入口的地方
  await page.type('#topic-custom', '冷场怎么办');
  await clickByText(page, 'button.btn', '添加', 'exact');
  await sleep(300);
  const withCustom = await page.$$eval('.chip', (ns) => ns.map((c) => (c.textContent ?? '').replace('×', '').trim()));
  check(
    '自定义添加的分支出现在已选范围里',
    withCustom.includes('冷场怎么办'),
    withCustom.join('、'),
  );
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('.chip-remove')).find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('冷场怎么办'),
    );
    target?.click();
  });
  await sleep(300);
  const afterCustomRemove = await page.$$eval('.chip', (ns) =>
    ns.map((c) => (c.textContent ?? '').replace('×', '').trim()),
  );
  check(
    '自定义添加的分支也能删掉',
    !afterCustomRemove.includes('冷场怎么办'),
    `剩：${afterCustomRemove.join('、') || '（空）'}`,
  );
  await page.screenshot({ path: resolve(SHOTS, 'step2-chips.png'), fullPage: true });

  // 恢复成 2 个子话题，继续后面的流程
  await clickByText(page, 'button.option', '约会', 'exact');
  await sleep(250);
  // 记下实际选中的子话题，后面判断灵感示例的相关性时要用（不写死成某个词）
  const selectedSubWords = await page.$$eval('.chip', (ns) =>
    ns.map((c) => (c.textContent ?? '').replace('×', '').trim()),
  );

  await next(page);
  text = await bodyText(page);
  check('第 2 步可多选并进入第 3 步', text.includes('这次你要对谁说什么'));

  // ---------- 5b. 第 3 步的灵感示例 ----------
  await page.waitForSelector('.inspire-card', { timeout: 6000 });
  const inspireInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.inspire-card'));
    return {
      count: cards.length,
      labels: cards.map((c) => (c.querySelector('.tag')?.textContent ?? '').trim()),
      texts: cards.map((c) => (c.querySelector('.inspire-what')?.textContent ?? '').trim()),
      source: (document.querySelector('.inspire-head .tag')?.textContent ?? '').trim(),
      helper: Array.from(document.querySelectorAll('.inspire .helper')).map((n) => (n.textContent ?? '').trim()),
    };
  });
  check(
    '第 3 步给出 4 条以上结合当前话题的灵感示例',
    inspireInfo.count >= 4,
    `${inspireInfo.count} 条，处境类型：${inspireInfo.labels.slice(0, 2).join('、')}…`,
  );
  check(
    '示例是具体的人和事，不是泛泛的类型标签',
    // 注意：内置成稿文案（如「一提到确定关系对方就转移话题」）是领域特异的，
    // 但不会逐字出现话题名，所以这里只要求「至少一条明确带话题词 + 每条都足够具体」。
    // 话题词取自第 2 步实际选中的范围，不写死——删减标签的测试会改变子话题的顺序与集合。
    // 离题话题的严格相关性由 verify-coverage.mjs 专项验收。
    inspireInfo.texts.every((t) => t.length >= 12) &&
      inspireInfo.texts.some((t) => selectedSubWords.some((w) => t.includes(w))),
    `例如：${inspireInfo.texts[0]?.slice(0, 30)}…`,
  );
  check(
    '示例标注来源，且不谎称联网检索',
    ['内置预设', '模板推导', '主题推导'].includes(inspireInfo.source),
    `来源标注为「${inspireInfo.source}」`,
  );
  check(
    '明说示例只是起点、可以改',
    inspireInfo.helper.some((h) => h.includes('随便改') || h.includes('只是起点')),
    '启发而非替用户决定',
  );

  // 一键回填
  await page.evaluate(() => document.querySelector('.inspire-card')?.click());
  await sleep(300);
  const afterFill = await page.evaluate(() => {
    const ta = document.querySelector('#subject-what');
    const sel = document.querySelector('.option.selected .option-label');
    return {
      what: ta instanceof HTMLTextAreaElement ? ta.value : '',
      whoLabel: (sel?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      notice: Array.from(document.querySelectorAll('.notice')).map((n) => (n.textContent ?? '').trim()),
    };
  });
  check(
    '点一条示例即可一键填上「他是谁」和「你要讲什么」',
    !!afterFill.what && afterFill.whoLabel.length > 0,
    `人=${afterFill.whoLabel}｜事=${afterFill.what.slice(0, 20)}…`,
  );
  check(
    '填入后提示这是起点、可自由修改',
    afterFill.notice.some((n) => n.includes('随便改') || n.includes('起点')),
    '不把示例当答案',
  );

  // 用户大改之后，示例的「已填入」状态要撤掉，不试图改回去
  await page.type('#subject-what', '，另外补充一点我自己的观察');
  await sleep(250);
  const afterEdit = await page.evaluate(() => ({
    stillMarked: !!document.querySelector('.inspire-card.selected'),
    value: (document.querySelector('#subject-what'))?.value ?? '',
  }));
  check(
    '用户改动后不再标示该示例、也不覆盖他的修改',
    !afterEdit.stillMarked && afterEdit.value.includes('我自己的观察'),
    '尊重用户对角色的最终决定权',
  );

  // 「换一批」必须给出不同角度
  const before = await page.$$eval('.inspire-card .inspire-what', (ns) => ns.map((n) => n.textContent));
  await clickByText(page, 'button.btn', '换一批');
  await sleep(400);
  const after = await page.$$eval('.inspire-card .inspire-what', (ns) => ns.map((n) => n.textContent));
  check(
    '「换一批」给的是不同角度的示例',
    before.length > 0 && after.length > 0 && before[0] !== after[0],
    '而不是重复同一组',
  );
  await page.screenshot({ path: resolve(SHOTS, 'step3-inspiration.png'), fullPage: true });

  // 把干扰内容清掉，回到只填一半的状态继续后面的流程
  await page.evaluate(() => {
    const ta = document.querySelector('#subject-what');
    if (ta instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(ta, '');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);

  // ---------- 5. 第 3 步：只填一半不能前进 ----------
  await clickByText(page, 'button.option', '第一次做这件事的人');
  disabled = await nextDisabled(page);
  notes = await notices(page);
  check(
    '第 3 步只填一半时无法前进',
    disabled && notes.some((n) => n.includes('还差') && n.includes('具体的事')),
    '提示缺哪一半',
  );

  await page.type('#subject-what', '怎么让这次约会聊得舒服，让对方愿意继续了解你');
  await next(page);
  text = await bodyText(page);
  check('第 3 步两部分填完可进入第 4 步', text.includes('这次从哪里开始聊'));
  await page.screenshot({ path: resolve(SHOTS, 'step3-subject.png') });

  // ---------- 6. 第 4 步：切入点 ----------
  await page.waitForFunction(() => document.querySelectorAll('button.option').length >= 6, { timeout: 6000 });
  const angleCount = await page.$$eval('button.option', (n) => n.length);
  check('第 4 步给出 6 类切入点候选', angleCount >= 6, `候选数 ${angleCount}`);
  // 选满 3 个：场景 + 误区 + 踩坑
  await clickByText(page, 'button.option', '具体场景', 'exact');
  await clickByText(page, 'button.option', '普遍误区', 'exact');
  await clickByText(page, 'button.option', '一次踩坑', 'exact');
  await sleep(250);
  text = await bodyText(page);
  check('第 4 步支持多选', text.includes('已选 3/3'), '可选满上限 3 个');
  check('第 4 步提供排序区', text.includes('决定顺序'), '出现排序区');
  check('含场景型入口时不触发一致性警告', !text.includes('一致性提醒'), '规则只对纯信息型入口报警');

  // 取消「具体场景」，只留纯信息型入口（普遍误区 / 一次踩坑）
  await clickByText(page, 'button.option', '具体场景', 'exact');
  await sleep(250);
  text = await bodyText(page);
  check('点击已选卡片可取消选择', text.includes('已选 2/3'), '由 3 个减为 2 个');

  // 纯信息型入口应触发警告
  await sleep(150);
  text = await bodyText(page);
  check('切入点与选题的一致性提醒生效', text.includes('一致性提醒'), '选中信息型入口时给出警告');
  await clickByText(page, 'button', '我知道了');
  await sleep(200);
  text = await bodyText(page);
  check('确认后可消除警告', text.includes('已确认'), '确认后不再重复提示');
  await page.screenshot({ path: resolve(SHOTS, 'step4-angle.png') });

  await next(page);
  text = await bodyText(page);
  check('第 4 步可进入第 5 步', text.includes('用哪句话开启这段对话'));

  // ---------- 7. 第 5 步：标题必须带理由 ----------
  await page.waitForFunction(
    () => document.body.innerText.includes('为什么是它'),
    { timeout: 6000 },
  );
  const reasonCount = await page.$$eval('button.option .option-implies', (n) =>
    n.filter((x) => (x.textContent ?? '').includes('为什么是它')).length,
  );
  check('每条标题都带生成理由', reasonCount >= 3, `带理由的标题 ${reasonCount} 条`);
  await page.screenshot({ path: resolve(SHOTS, 'step5-title.png') });

  // 选第 2 条（判断式）
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.option'));
    const target = btns.find((b) => (b.textContent ?? '').includes('判断式'));
    target?.click();
  });
  await sleep(200);
  await next(page);
  text = await bodyText(page);
  check('第 5 步可进入第 6 步', text.includes('你准备用什么让对方理解你的判断'));

  // ---------- 8. 第 6 步：体裁追问 ----------
  await clickByText(page, 'button.option', '口播视频');
  await sleep(200);
  text = await bodyText(page);
  check('选择视频体裁后追加追问', text.includes('哪些地方需要画面演示'), '体裁相关追问出现');
  await page.screenshot({ path: resolve(SHOTS, 'step6-expression.png') });

  // ---------- 9. 生成简报 ----------
  await clickByText(page, 'button.btn.primary', '生成创作简报');
  await sleep(400);
  text = await bodyText(page);
  check('能生成创作简报', text.includes('创作简报') && text.includes('关系') && text.includes('切入点'));
  check('简报包含「这次不讲」的过滤清单', text.includes('这次不讲'));
  check(
    '简报里写明了视角（你/创作者 要对谁讲）',
    text.includes('你（创作者）要讲给谁') && text.includes('要对谁讲'),
    '不再用含义模糊的「给谁看」「对谁说」',
  );
  await page.screenshot({ path: resolve(SHOTS, 'step7-brief.png'), fullPage: true });

  // ---------- 10. 导出的 JSON 字段完整 ----------
  // 默认停在「简报 Markdown」标签，必须先切到 JSON 再读
  await clickByText(page, 'button.tab', '结构化 JSON', 'exact');
  await sleep(250);
  const rawJson = await page.$eval('pre.raw', (el) => el.textContent ?? '');
  let parsed = null;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // 保留 null，下面判失败
  }
  check(
    '导出的 JSON 可解析且字段完整',
    !!parsed &&
      !!parsed.brief?.audience &&
      !!parsed.brief?.topic &&
      !!parsed.brief?.subject &&
      Array.isArray(parsed.brief?.angles) &&
      !!parsed.brief?.titleOption &&
      !!parsed.brief?.expression,
    parsed ? `schema=${parsed.schema}` : '解析失败',
  );

  // ---------- 10b. 导出动作跟随当前标签，不重复堆按钮 ----------
  const tabActions = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.actions button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    return btns.filter((t) => t.startsWith('复制这份') || t.startsWith('下载为文件') || t === '从 JSON 恢复');
  });
  check(
    '导出动作跟随当前标签且带格式名',
    tabActions.includes('复制这份JSON') && tabActions.includes('下载为文件') && tabActions.includes('从 JSON 恢复'),
    tabActions.join(' / '),
  );

  // ---------- 10c. JSON 往返：导出 → 打乱草稿 → 粘回恢复 ----------
  // 把第 3 步的「具体的人」清掉，制造一份不完整的草稿
  await clickByText(page, 'button.step-pill', '选题');
  await sleep(350);
  await clickByText(page, 'button.step-pill', '切入点');
  await sleep(350);
  const beforeImport = await page.evaluate(() => window.__wizardDebug.index);
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  // 直接清掉草稿的主要字段，模拟「换台电脑/重新开始」后想用 JSON 找回
  await page.evaluate(() => {
    const key = 'content-wizard.draft.v1';
    const d = JSON.parse(localStorage.getItem(key) ?? '{}');
    d.subject = null;
    d.angle = null;
    d.title = null;
    localStorage.setItem(key, JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(500);
  const draftedAway = await page.evaluate(
    () => JSON.parse(localStorage.getItem('content-wizard.draft.v1') ?? '{}')?.subject,
  );
  check('已制造出缺字段的草稿（用于往返测试）', draftedAway === null, `导入前 index=${beforeImport}`);

  // 打开导入弹层，把刚才导出的 JSON 粘回去
  // 顺带把体裁切成「图文」，这样恢复后应回到 JSON 里的 video——能证明恢复的确实不只是显眼字段
  await clickByText(page, 'button.step-pill', '表达');
  await sleep(400);
  await clickByText(page, 'button.option', '图文', 'exact');
  await sleep(250);
  await clickByText(page, 'button.btn.primary', '生成创作简报');
  await sleep(400);
  await clickByText(page, 'button.tab', '结构化 JSON', 'exact');
  await sleep(250);
  await clickByText(page, 'button.btn', '从 JSON 恢复');
  await sleep(300);

  const modalOpen = await page.evaluate(() => !!document.querySelector('#import-json'));
  check('「从 JSON 恢复」能打开导入弹层', modalOpen);

  // 先粘一段坏 JSON，确认会被明确拒绝而不是静默出错
  await setInputValue(page, '.modal #import-json', '{"schema":"wrong"}');
  await clickByText(page, '.modal button.btn.primary', '恢复并继续编辑');
  await sleep(300);
  text = await bodyText(page);
  check(
    '无效 JSON 被拒绝并给出原因',
    text.includes('没有找到创作简报字段') || text.includes('没有可恢复的内容'),
    '不是静默失败',
  );

  // 再粘正确的那份（用原生 setter，避免逐字符输入超时截断）
  await setInputValue(page, '.modal #import-json', rawJson);
  // 弹层里的主按钮必须精确定位到 .modal 内，否则可能点到页面上其它 primary 按钮
  await clickByText(page, '.modal button.btn.primary', '恢复并继续编辑');
  await sleep(600);
  const importDebug = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('content-wizard.draft.v1') ?? '{}');
    return {
      modalStillOpen: !!document.querySelector('#import-json'),
      draftWho: d?.subject?.who?.label ?? null,
      draftAngles: d?.angle?.selected?.length ?? 0,
      notice: Array.from(document.querySelectorAll('.notice')).map((n) => (n.textContent ?? '').trim()),
    };
  });
  console.log('  [调试] 导入现场：', JSON.stringify(importDebug));
  const restored = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('content-wizard.draft.v1') ?? '{}');
    return {
      who: d?.subject?.who?.label ?? null,
      what: d?.subject?.what ?? null,
      angles: d?.angle?.selected?.length ?? 0,
      title: d?.title?.selected?.text ?? null,
      format: d?.expression?.format ?? null,
    };
  });
  check(
    'JSON 往返后选题被完整恢复',
    restored.who === '第一次做这件事的人' && !!restored.what,
    `who=${restored.who} what=${(restored.what ?? '').slice(0, 14)}…`,
  );
  check(
    'JSON 往返后切入点/标题/体裁一并恢复',
    restored.angles >= 1 && !!restored.title && restored.format === 'video',
    `切入点 ${restored.angles} 个、标题「${(restored.title ?? '').slice(0, 12)}…」、体裁 ${restored.format}`,
  );
  // toast 只停留 2.2 秒，恢复后立刻去读，抓真实的用户可见提示
  const toastText = await page.evaluate(() => (document.querySelector('.toast')?.textContent ?? '').trim());
  check(
    '恢复后给出「已恢复哪几步 / 缺哪几步」的提示',
    toastText.includes('恢复'),
    toastText || '没抓到提示',
  );
  await page.screenshot({ path: resolve(SHOTS, 'json-import.png') });

  // ---------- 10d. 站点图标 ----------
  const iconOk = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return { found: false };
    const res = await fetch(link.getAttribute('href'));
    const svg = await res.text();
    return { found: true, status: res.status, isSvg: svg.includes('<svg') };
  });
  check(
    '页面图标可加载且是 SVG',
    iconOk.found && iconOk.status === 200 && iconOk.isSvg,
    `status=${iconOk.status}`,
  );
  await page.screenshot({ path: resolve(SHOTS, 'step7-brief.png'), fullPage: true });

  // ---------- 11. 刷新后草稿不丢 ----------
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(400);
  const afterReload = await page.evaluate(() => localStorage.getItem('content-wizard.draft.v1'));
  check('刷新后草稿仍在 localStorage', !!afterReload && afterReload.includes('约会'));

  // ---------- 12. 失效传播：改上游，下游立刻标待确认 ----------
  // 先把下游两步实走一遍再改上游，让「切入点 / 标题」各自留下确认过的快照。
  await clickByText(page, 'button.step-pill', '切入点');
  await sleep(350);
  await next(page); // 进入第 5 步
  await page.waitForFunction(() => (document.body.textContent ?? '').includes('为什么是它'), { timeout: 6000 });
  await clickByText(page, 'button.option', '问题式', 'startsWith');
  await sleep(250);
  await next(page); // 进入第 6 步

  let dbg = await page.evaluate(() => window.__wizardDebug);
  const confirmedCount = Object.keys(dbg.snapshots).length;
  check(
    '实走到第 6 步后 1–5 步均已确认',
    dbg.index === 5 && confirmedCount >= 5 && !!dbg.snapshots.title,
    `index=${dbg.index} 已确认快照=${Object.keys(dbg.snapshots).join(',')}`,
  );

  // 导入前草稿里的标题是「判断式」，而导入的 JSON 里是「问题式」：
  // 表达层依赖标题，所以它被判为待确认是正确行为，不是 bug。重新确认一次即可消除。
  await clickByText(page, '.stale-banner button.btn', '沿用当前答案');
  await sleep(300);
  const staleAfterReconfirm = await page.$$eval('.stale-mark', (n) => n.length);
  check(
    '重新确认后消除导入带来的待确认',
    staleAfterReconfirm === 0,
    `剩余 ${staleAfterReconfirm} 个`,
  );

  // 真改上游后，失效传播必须仍然有效——这才是在导入场景下真正要保证的不变量
  await clickByText(page, 'button.step-pill', '选题');
  await sleep(350);
  await clickByText(page, 'button.option', '做过很多次却一直卡住的人');
  await sleep(400);
  const staleAfterEdit = await page.$$eval('.stale-mark', (n) => n.length);
  check(
    '导入之后改上游，下游仍会标待确认',
    staleAfterEdit >= 2,
    `待确认标记 ${staleAfterEdit} 个`,
  );
  await page.screenshot({ path: resolve(SHOTS, 'json-import.png') });

  // 回到第 3 步改「具体的人」
  await clickByText(page, 'button.step-pill', '选题');
  await sleep(350);
  dbg = await page.evaluate(() => window.__wizardDebug);
  check('步骤条可跳回已完成的第 3 步', dbg.index === 2, `index=${dbg.index}`);

  await clickByText(page, 'button.option', '做过很多次却一直卡住的人');
  await sleep(400);

  text = await bodyText(page);
  check('改动生效：新的「具体的人」已选中', text.includes('做过很多次却一直卡住的人'), '状态已回写');

  // 幂等读取：分别判定两个标记，不因其中一个失败而连带误报
  const angleStale = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.step-pill'))
      .filter((p) => (p.textContent ?? '').includes('切入点'))
      .some((p) => p.className.includes('stale')),
  );
  const titleStale = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button.step-pill'))
      .filter((p) => (p.textContent ?? '').includes('标题'))
      .some((p) => p.className.includes('stale')),
  );
  check('改动第 3 步后「切入点」立刻标待确认', angleStale, '上游变了，旧选择不再成立');
  check('改动第 3 步后「标题」立刻标待确认', titleStale, '标题依赖受众与选题');
  await page.screenshot({ path: resolve(SHOTS, 'stale-propagation.png') });

  // 进入第 4 步应看到待确认横幅
  await clickByText(page, 'button.step-pill', '切入点');
  await sleep(400);
  text = await bodyText(page);
  check('进入下游步骤时显示待确认横幅', text.includes('待确认：'), '要求重新确认而不是静默沿用');

  // ---------- 13. 无 Key + 外网不可达，仍能走完 ----------
  // 注意：不能直接 reload 后测，因为 SPA 全部由本机静态服务提供，整页断网测的是「静态资源能不能加载」，
  // 与本条验收标准（模型不可用时回退预设库）不是同一件事。这里只切断外部请求。
  await page.setRequestInterception(true);
  const blocked = [];
  const origin = new URL(BASE).origin;
  page.on('request', (req) => {
    const url = req.url();
    // 放行本机静态服务与内联资源，只切断外部请求（模型端点等）
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      void req.continue();
    } else {
      blocked.push(url);
      void req.abort();
    }
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(700);
  text = await bodyText(page);
  check(
    '外网不可达时页面仍可用（离线回退）',
    text.includes('这条内容是给谁看的') || text.includes('这条内容是给谁看'),
    `已拦截 ${blocked.length} 个外部请求`,
  );
  await page.setRequestInterception(false);
} catch (err) {
  check('脚本执行完成', false, String(err?.message ?? err));
  try {
    const pages = await browser.pages();
    const p = pages[pages.length - 1];
    await p.screenshot({ path: resolve(SHOTS, 'FAILURE.png'), fullPage: true });
    const dump = await p.evaluate(() => document.body.innerText);
    console.log('\n----- 失败现场页面文本 -----');
    console.log(dump.slice(0, 1500));
    console.log('----- 现场文本结束 -----\n');
  } catch {
    // 现场信息拿不到就算了，不要盖住原始错误
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
