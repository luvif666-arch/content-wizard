// AI 适配层。整个应用只有这一处发起模型请求。
// 契约：任何一步的候选生成，模型不可用 / 无 Key / 返回结构不合法，都必须回退到预设库，向导照常走完。

import {
  ANGLE_TYPES,
  TITLE_FORMULAS,
  TOPIC_PRESET_MAP,
  buildFilterList,
  extractNoun,
  normalizeKey,
  presetSubtopics,
} from '../presets';
import type { AngleOption, SubjectAnswer, TitleOption, TopicAnswer } from '../types';

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

/** 本次候选的来源，用于在界面上如实标注，不假装查过 */
export type CandidateSource = 'preset' | 'model';

export interface Generated<T> {
  items: T[];
  source: CandidateSource;
  /** 回退原因，source === 'preset' 且非空时展示给用户 */
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
      source: 'preset',
      note: prefs.apiKey ? undefined : '未配置 API Key，候选来自内置预设库。',
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
      source: 'preset',
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
      source: 'preset',
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
    return { items: fallback, source: 'preset', note: `模型调用失败（${(err as Error).message}），已回退到内置规则模板。` };
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
      source: 'preset',
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
    return { items: fallback, source: 'preset', note: `模型调用失败（${(err as Error).message}），已回退到内置句式模板。` };
  }
}

/** 第 3 步：过滤清单。规则推导为主，保证离线可用。 */
export function getFilterList(ctx: GenContext): { skip: string[]; must: string[] } {
  return buildFilterList(ctx.subject?.what ?? '', ctx.topic?.subs ?? []);
}
