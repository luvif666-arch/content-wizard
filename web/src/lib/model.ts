// AI 适配层。整个应用只有这一处发起模型请求。
// 契约：任何一步的候选生成，模型不可用 / 无 Key / 返回结构不合法，都必须回退到预设库，向导照常走完。

import {
  ANGLE_TYPES,
  INSPIRATION_PATTERNS,
  TITLE_FORMULAS,
  TOPIC_PRESET_MAP,
  buildFilterList,
  extractNoun,
  batchSource,
  normalizeKey,
  presetExpansion,
  presetInspirations,
  presetSectionIdeas,
  presetSubtopics,
} from '../presets';
import type { Inspiration, SectionIdea, SectionIdeaContext } from '../presets';
import type {
  AngleOption,
  CandidateSource,
  ExpressionSection,
  SectionExpansion,
  SubjectAnswer,
  TitleOption,
  TopicAnswer,
} from '../types';

// 来源类型定义在领域模型里（第 4/5/6 步的答案需要记住它），这里原样再导出，方便调用方就近引入
export type { CandidateSource };

const PREFS_KEY = 'content-wizard.prefs.v1';

export interface ModelPrefs {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_PREFS: ModelPrefs = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

export function loadPrefs(): ModelPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ModelPrefs>;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_PREFS.baseUrl,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_PREFS.model,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ModelPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用（隐私模式）时静默降级：向导仍然可用，只是不记住设置
  }
}

/**
 * 来源的中文标签。四档必须如实区分，界面上不许混：
 *   preset   内置库——预先写好的整段文案；
 *   template 模板推导——用当前上下文现拼的句子，不是预先写好的；
 *   model    模型生成——由用户配置的模型按当前上下文生成；
 *   search   联网检索——只有真的联网查过才能用。
 * 本应用是浏览器直连的 OpenAI 兼容端点，没有联网检索能力，所以正常不会出现 search。
 */
export const SOURCE_LABEL: Record<CandidateSource, string> = {
  preset: '内置库',
  template: '模板推导',
  model: '模型生成',
  search: '联网检索',
};

export interface Generated<T> {
  items: T[];
  source: CandidateSource;
  /** 回退原因或来源说明，展示给用户 */
  note?: string;
}

export interface GenContext {
  topic: TopicAnswer | null;
  subject: SubjectAnswer | null;
  audienceLabel: string;
}

function stripFence(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1] : t;
}

/** 调一次 OpenAI 兼容的 /chat/completions，要求返回 JSON。任何异常都抛出，由调用方回退。 */
async function callModel(prefs: ModelPrefs, system: string, user: string): Promise<unknown> {
  const url = `${prefs.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${prefs.apiKey}`,
      },
      body: JSON.stringify({
        model: prefs.model,
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('返回内容为空');
    return JSON.parse(stripFence(content));
  } finally {
    clearTimeout(timer);
  }
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) throw new Error('结构不合法');
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!out.length) throw new Error('结构不合法');
  return Array.from(new Set(out)).slice(0, max);
}

/** 第 2 步：子话题候选。预设表优先，未命中才问模型。 */
export async function getSubtopics(big: string, prefs: ModelPrefs): Promise<Generated<string>> {
  const key = big.trim();
  if (!key) return { items: [], source: 'preset' };

  const nk = normalizeKey(key);
  const hit = Object.keys(TOPIC_PRESET_MAP).some((k) => {
    const candidate = normalizeKey(k);
    return candidate === nk || (nk.length >= 2 && (candidate.includes(nk) || nk.includes(candidate)));
  });

  if (hit || !prefs.apiKey) {
    const items = Array.from(new Set(presetSubtopics(key))).slice(0, 4);
    return {
      items,
      // 命中预设表的是预先写好的子话题（内置库）；没命中是按通用后缀现拼的（模板推导）
      source: hit ? 'preset' : 'template',
      note: prefs.apiKey ? undefined : '未配置 API Key，候选来自内置预设库与通用模板。',
    };
  }

  try {
    const raw = await callModel(
      prefs,
      '你是内容创作策划。只返回 JSON，不要解释。',
      `用户想做关于「${key}」的内容。请给出 6 个更小的子话题分支，每个不超过 12 个字，彼此不重复。返回格式：{"subtopics":["...","..."]}`,
    );
    const items = asStringArray((raw as { subtopics?: unknown }).subtopics, 4);
    return { items, source: 'model' };
  } catch (err) {
    return {
      items: Array.from(new Set(presetSubtopics(key))).slice(0, 4),
      source: hit ? 'preset' : 'template',
      note: `模型调用失败（${(err as Error).message}），已回退到内置预设库。`,
    };
  }
}

/** 第 4 步：切入点候选。模型不可用时按规则模板拼装。 */
export function presetAngles(ctx: GenContext): AngleOption[] {
  const noun = extractNoun(ctx.subject?.what ?? '', ctx.topic?.subs ?? []);
  return ANGLE_TYPES.map((t) => ({
    id: t.id,
    label: t.label,
    text: t.template.replace(/\{noun\}/g, noun),
  }));
}

export async function getAngles(ctx: GenContext, prefs: ModelPrefs): Promise<Generated<AngleOption>> {
  const fallback = presetAngles(ctx);
  if (!prefs.apiKey || !ctx.subject) {
    return {
      items: fallback,
      // 六类入口是按当前选题用句式模板拼的，所以是「模板推导」，不是预先写好的成稿文案
      source: 'template',
      note: prefs.apiKey ? undefined : '未配置 API Key，候选来自内置规则模板。',
    };
  }
  try {
    const raw = await callModel(
      prefs,
      '你是内容创作策划，负责为同一选题设计不同的切入点。只返回 JSON。',
      [
        `受众：${ctx.audienceLabel}`,
        `选题：对「${ctx.subject.who.label}」，讲「${ctx.subject.what}」`,
        `切入点类型：${ANGLE_TYPES.map((t) => `${t.id}=${t.label}`).join('、')}`,
        '为每一类各写一个结合该选题的具体切入点，一句话，不超过 40 字。',
        '返回格式：{"angles":[{"id":"scene","text":"..."}]}',
      ].join('\n'),
    );
    const list = (raw as { angles?: unknown }).angles;
    if (!Array.isArray(list)) throw new Error('结构不合法');
    const byId = new Map<string, string>();
    for (const item of list) {
      const rec = item as { id?: unknown; text?: unknown };
      if (typeof rec.id === 'string' && typeof rec.text === 'string' && rec.text.trim()) {
        byId.set(rec.id, rec.text.trim());
      }
    }
    const items = ANGLE_TYPES.map((t) => ({
      id: t.id,
      label: t.label,
      text: byId.get(t.id) ?? t.template.replace(/\{noun\}/g, extractNoun(ctx.subject?.what ?? '', ctx.topic?.subs ?? [])),
    }));
    return { items, source: 'model' };
  } catch (err) {
    return { items: fallback, source: 'template', note: `模型调用失败（${(err as Error).message}），已回退到内置规则模板。` };
  }
}

/** 第 5 步：标题候选。三种句式各一条，每条必须带生成理由。 */
export function presetTitles(ctx: GenContext): TitleOption[] {
  const noun = extractNoun(ctx.subject?.what ?? '', ctx.topic?.subs ?? []);
  const audience = ctx.audienceLabel || '你的读者';
  return TITLE_FORMULAS.map((f) => ({
    id: f.id,
    kind: f.kind,
    text: f.text(noun),
    reason: f.reason(audience),
  }));
}

export async function getTitles(ctx: GenContext, prefs: ModelPrefs): Promise<Generated<TitleOption>> {
  const fallback = presetTitles(ctx);
  if (!prefs.apiKey || !ctx.subject) {
    return {
      items: fallback,
      source: 'template',
      note: prefs.apiKey ? undefined : '未配置 API Key，标题来自内置句式模板。',
    };
  }
  try {
    const raw = await callModel(
      prefs,
      '你是内容标题策划。只返回 JSON。每条标题必须附带它邀请谁进来、为什么他会点开的理由。',
      [
        `受众：${ctx.audienceLabel}`,
        `选题：对「${ctx.subject.who.label}」，讲「${ctx.subject.what}」`,
        '按三种句式各写 1 条标题：question=问题式、judgement=判断式、resonance=共鸣式。',
        'title 不超过 24 字；reason 一句话说清这句话在邀请谁、为什么他会想点开。',
        '返回格式：{"titles":[{"id":"question","title":"...","reason":"..."}]}',
      ].join('\n'),
    );
    const list = (raw as { titles?: unknown }).titles;
    if (!Array.isArray(list)) throw new Error('结构不合法');
    const byId = new Map<string, { title: string; reason: string }>();
    for (const item of list) {
      const rec = item as { id?: unknown; title?: unknown; reason?: unknown };
      if (typeof rec.id === 'string' && typeof rec.title === 'string' && rec.title.trim()) {
        byId.set(rec.id, {
          title: rec.title.trim(),
          reason: typeof rec.reason === 'string' && rec.reason.trim() ? rec.reason.trim() : '',
        });
      }
    }
    const items: TitleOption[] = TITLE_FORMULAS.map((f) => {
      const hit = byId.get(f.id);
      const fb = fallback.find((x) => x.id === f.id)!;
      return {
        id: f.id,
        kind: f.kind,
        text: hit?.title ?? fb.text,
        reason: hit?.reason || fb.reason,
      };
    });
    // 缺理由的条目一律补回模板理由，保证「每条标题都带理由」这条验收标准恒成立
    return { items, source: 'model' };
  } catch (err) {
    return { items: fallback, source: 'template', note: `模型调用失败（${(err as Error).message}），已回退到内置句式模板。` };
  }
}

/** 第 3 步：过滤清单。规则推导为主，保证离线可用。 */
export function getFilterList(ctx: GenContext): { skip: string[]; must: string[] } {
  return buildFilterList(ctx.subject?.what ?? '', ctx.topic?.subs ?? []);
}

/**
 * 第 3 步：灵感示例。
 * 用户在这一步最容易卡住——抽象的处境类型给不出具体的人和事。
 * 这里给 4–6 个结合当前话题的具体人物与处境，点选后一键回填，仍可编辑。
 *
 * 关于来源标注：本应用的模型层是浏览器直连的 OpenAI 兼容端点，**没有联网检索能力**，
 * 所以模型生成的示例一律标注为「模型生成」，绝不标成「联网检索」。
 */
export async function getInspirations(
  ctx: GenContext,
  prefs: ModelPrefs,
): Promise<Generated<Inspiration>> {
  const fallback = presetInspirations(ctx.topic);
  const fallbackSource = batchSource(fallback);

  if (!prefs.apiKey || !ctx.topic) {
    return {
      items: fallback,
      source: fallbackSource,
      note:
        fallbackSource === 'preset'
          ? '这批示例里含内置成稿文案，其余按话题模板推导；未接入联网检索。'
          : '示例由内置模板按当前话题推导，不是联网检索来的。配置 API Key 可让模型按话题现推。',
    };
  }

  try {
    const raw = await callModel(
      prefs,
      '你是内容创作策划。你要帮创作者找到具体的目标读者，只返回 JSON。',
      [
        `创作者想做的方向：${ctx.topic.big}，已收窄到：${ctx.topic.subs.join('、')}`,
        `请给出 ${INSPIRATION_PATTERNS.length} 个具体的人，每个人都带着一个真实的、看得出张力的处境。`,
        '要求：',
        '1. whoLabel 用处境类型短语（例如「第一次做这件事的人」），不超过 14 字；',
        '2. what 用一句自然语言写清他具体卡在哪，不超过 40 字，要能看出矛盾和张力；',
        '3. 这些人是这个话题下真实会存在的读者，不要泛泛的类型标签，也不要编造具体数据或来源；',
        `4. 覆盖不同处境，尽量包含：${INSPIRATION_PATTERNS.map((p) => p.whoLabel).join('、')}。`,
        '返回格式：{"people":[{"whoLabel":"...","what":"..."}]}',
      ].join('\n'),
    );
    const list = (raw as { people?: unknown }).people;
    if (!Array.isArray(list)) throw new Error('结构不合法');
    const items: Inspiration[] = [];
    for (const item of list) {
      const rec = item as { whoLabel?: unknown; what?: unknown };
      if (typeof rec.whoLabel === 'string' && typeof rec.what === 'string' && rec.what.trim()) {
        items.push({
          id: `model-${items.length}`,
          whoLabel: rec.whoLabel.trim() || '有具体处境的读者',
          what: rec.what.trim(),
          source: 'model',
        });
      }
    }
    if (items.length < 4) throw new Error('示例数量不足');
    return {
      items,
      source: 'model',
      note: '示例由你配置的模型按话题推导（不是联网检索结果），用作灵感即可。',
    };
  } catch (err) {
    return {
      items: fallback,
      source: fallbackSource,
      note: `模型调用失败（${(err as Error).message}），已回退到内置库与模板推导。`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * 第 6 步：正文每一段的「参考写法」
 * 结构选完、体裁选完之后，用户仍然会卡在「这一段具体写什么」。
 * 这里按当前结构给每一段 3–4 条结合已定内容的写法，并提供「扩写」把它展开成具体建议。
 * 参考不是成稿：用户可以采纳，也可以全改。
 * ------------------------------------------------------------------ */

/** 生成「参考写法」需要的全部上下文：第 3 步的对谁说什么 + 第 4 步切入点 + 第 5 步标题 + 当前段落 */
export interface ExpressionContext extends GenContext {
  angles: AngleOption[];
  title: TitleOption | null;
  section: ExpressionSection;
  /** 这一段在结构里的序号（从 1 开始），用于让模型知道它是第几段 */
  position: number;
  total: number;
}

/** 把上下文摊平成模板占位符需要的形状；缺什么就用一句不假装有的话顶上 */
function ideaContextOf(ctx: ExpressionContext): SectionIdeaContext {
  const what = ctx.subject?.what?.trim() || '你这次要讲的那件事';
  const subs = ctx.topic?.subs ?? [];
  const firstAngle = ctx.angles[0];
  return {
    who: ctx.subject?.who.label?.trim() || '你要对话的那个人',
    what,
    title: ctx.title?.text?.trim() || '你还没定下来的那一句标题',
    angle: firstAngle?.text?.trim() || '你还没选定的切入点',
    noun: extractNoun(what, subs),
    sub: subs.length ? subs.join('、') : ctx.topic?.big?.trim() || '这个话题',
    big: ctx.topic?.big?.trim() || '这个话题',
    role: ctx.section.role?.trim() || ctx.section.label?.trim() || '这一段该完成的事',
  };
}

/** 上下文说明：让用户看出这批候选是「这条内容的这一段的写法」，而不是通用模板 */
function contextLineOf(ctx: ExpressionContext): string {
  const idea = ideaContextOf(ctx);
  return `依据：对「${idea.who}」讲「${idea.what}」；切入点「${ctx.angles[0]?.label ?? '（未选）'}」；标题「${idea.title}」。`;
}

/**
 * 第 6 步：某一小节的参考写法候选。
 * 没有配置模型时用「内置库写法 + 按当前上下文现拼的模板」——两者来源不同，界面上分开标注。
 */
export async function getSectionIdeas(
  ctx: ExpressionContext,
  prefs: ModelPrefs,
): Promise<Generated<SectionIdea>> {
  const idea = ideaContextOf(ctx);
  const fallback = presetSectionIdeas(ctx.section, idea);
  const fallbackNote =
    '没有配置模型：候选由内置库写法与按你的选题／切入点／标题现拼的模板组成，不是联网检索来的。每条都标了各自的来源。';

  if (!prefs.apiKey || !ctx.subject) {
    return { items: fallback, source: 'template', note: fallbackNote };
  }

  try {
    const raw = await callModel(
      prefs,
      '你是内容创作策划。创作者已经定好选题、切入点和标题，现在要写正文的其中一段，但不知道这一段具体怎么写。只返回 JSON。',
      [
        contextLineOf(ctx),
        `这段在结构里的位置：第 ${ctx.position} 段（共 ${ctx.total} 段），名称「${ctx.section.label}」，负责：${idea.role}`,
        '请给出 4 条这条内容「这一段的写法」，每条从不同角度入手。',
        '要求：',
        '1. approach 用 6–12 字说清入手角度；',
        '2. text 一句话，40–90 字，必须带上上面给定的选题／切入点／标题中的具体内容，不要写成通用模板；',
        '3. 写的是「这一段可以怎么写」，不是成稿正文，不要替创作者编造他的经历或数据；',
        '返回格式：{"ideas":[{"approach":"...","text":"..."}]}',
      ].join('\n'),
    );
    const list = (raw as { ideas?: unknown }).ideas;
    if (!Array.isArray(list)) throw new Error('结构不合法');
    const items: SectionIdea[] = [];
    for (const item of list) {
      const rec = item as { approach?: unknown; text?: unknown };
      if (typeof rec.text === 'string' && rec.text.trim().length >= 10) {
        items.push({
          id: `model-${ctx.section.id}-${items.length}`,
          approach: typeof rec.approach === 'string' && rec.approach.trim() ? rec.approach.trim() : '模型给的入手角度',
          text: rec.text.trim(),
          source: 'model',
        });
      }
    }
    if (items.length < 3) throw new Error('候选数量不足');
    return {
      items,
      source: 'model',
      note: '这几条由你配置的模型按当前选题生成（不是联网检索结果）。参考而已，采纳前请按自己的情况改。',
    };
  } catch (err) {
    return {
      items: fallback,
      source: 'template',
      note: `模型调用失败（${(err as Error).message}），已回退到内置库写法与模板推导。${fallbackNote}`,
    };
  }
}

export interface ExpansionResult {
  item: SectionExpansion;
  source: CandidateSource;
  note?: string;
}

/**
 * 「根据已定内容扩写这段」：把参考写法展开成更具体的内容建议。
 * 离线路径同样是模板推导；模型可用时由模型生成。例子一律提示用户自己填，不替他编。
 */
export async function expandSection(
  ctx: ExpressionContext,
  prefs: ModelPrefs,
): Promise<ExpansionResult> {
  const idea = ideaContextOf(ctx);
  const fallback = presetExpansion(ctx.section, idea);
  const primaryText = ctx.section.reference?.text ?? '';

  if (!prefs.apiKey || !ctx.subject) {
    return {
      item: { ...fallback, source: 'template', basisKey: '' },
      source: 'template',
      note: '没有配置模型：这段建议是按当前选题／切入点／标题推导的模板，不是模型生成，也不是联网检索。',
    };
  }

  try {
    const raw = await callModel(
      prefs,
      '你是内容创作策划。把一段「参考写法」展开成更具体的内容建议。只返回 JSON。',
      [
        contextLineOf(ctx),
        `这一段：第 ${ctx.position} 段（共 ${ctx.total} 段），名称「${ctx.section.label}」，负责：${idea.role}`,
        primaryText ? `已经选定的参考写法：${primaryText}` : '（用户还没选参考写法，请直接按这一段的位置和职责来展开。）',
        '请展开成三部分：',
        'plan：这一段打算讲什么（一到两句）；',
        'example：举什么例子。只描述可以举哪一类例子，并提醒创作者用自己的经历填，不要编造具体人物、数据或来源；',
        'advice：给什么建议（一条，具体到能照着做）。',
        '返回格式：{"plan":"...","example":"...","advice":"..."}',
      ].join('\n'),
    );
    const rec = raw as { plan?: unknown; example?: unknown; advice?: unknown };
    const plan = typeof rec.plan === 'string' ? rec.plan.trim() : '';
    const example = typeof rec.example === 'string' ? rec.example.trim() : '';
    const advice = typeof rec.advice === 'string' ? rec.advice.trim() : '';
    if (!plan || !example || !advice) throw new Error('结构不合法');
    return {
      item: { plan, example, advice, source: 'model', basisKey: '' },
      source: 'model',
      note: '这段建议由你配置的模型生成（不是联网检索结果）。例子要换成你自己的，别照抄。',
    };
  } catch (err) {
    return {
      item: { ...fallback, source: 'template', basisKey: '' },
      source: 'template',
      note: `模型调用失败（${(err as Error).message}），已回退到模板推导。`,
    };
  }
}
