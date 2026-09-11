// 导入口：把导出的 JSON 粘回来，继续编辑。
// 与 toJson() 对称——导出是单向快照，这里补上回灌，让它变成可归档、可续编的存档。

import { emptyState } from '../types';
import type { AngleAnswer, ExpressionAnswer, TitleAnswer, WizardState } from '../types';

export type ParseResult = { ok: true; state: WizardState } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 解析用户粘贴的 JSON。
 * 只接受本工具导出的结构；缺字段的部分留空而不报错，让用户能走最少的回头路。
 */
export function parseImportedState(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: '内容为空，请先粘贴导出的 JSON。' };

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: '不是合法的 JSON，请确认复制完整（应包含最外层的大括号）。' };
  }

  if (!isRecord(data)) return { ok: false, error: 'JSON 顶层应该是一个对象。' };

  // 兼容两种来源：本工具的导出（带 schema/brief）与分享链接解码后的裸状态
  const brief = isRecord(data.brief) ? data.brief : null;
  const source = brief ?? data;
  const hasSchema = typeof data.schema === 'string';
  if (!hasSchema && !brief) {
    const looksLikeState = ['audience', 'topic', 'subject', 'expression'].some((k) => k in source);
    if (!looksLikeState) {
      return {
        ok: false,
        error: '这份 JSON 里没有找到创作简报字段（audience / topic / subject / expression）。',
      };
    }
  }

  const state: WizardState = emptyState();

  if (isRecord(source.audience) && typeof source.audience.label === 'string') {
    state.audience = {
      id: typeof source.audience.id === 'string' ? source.audience.id : 'custom',
      label: source.audience.label,
      implies: typeof source.audience.implies === 'string' ? source.audience.implies : '',
    };
  }

  if (isRecord(source.topic) && typeof source.topic.big === 'string') {
    state.topic = {
      big: source.topic.big,
      subs: Array.isArray(source.topic.subs) ? source.topic.subs.filter((s): s is string => typeof s === 'string') : [],
    };
  }

  if (isRecord(source.subject) && isRecord(source.subject.who) && typeof source.subject.what === 'string') {
    state.subject = {
      who: {
        id: typeof source.subject.who.id === 'string' ? source.subject.who.id : 'custom',
        label: typeof source.subject.who.label === 'string' ? source.subject.who.label : '（待填写）',
        hint: typeof source.subject.who.hint === 'string' ? source.subject.who.hint : '',
      },
      what: source.subject.what,
    };
  }

  // 注意：导出用的是 angles（数组），不是 angle（对象），这里显式转换
  if (Array.isArray(source.angles)) {
    const selected = source.angles
      .filter(isRecord)
      .filter((a) => typeof a.text === 'string' && a.text.trim())
      .map((a) => ({
        id: typeof a.id === 'string' ? a.id : `imported-${Math.random().toString(36).slice(2, 8)}`,
        label: typeof a.label === 'string' ? a.label : '切入点',
        text: a.text as string,
      }));
    if (selected.length) {
      const angle: AngleAnswer = { selected, consistencyAcknowledged: true };
      state.angle = angle;
    }
  }

  if (isRecord(source.titleOption) && typeof source.titleOption.text === 'string') {
    const title: TitleAnswer = {
      selected: {
        id: typeof source.titleOption.id === 'string' ? source.titleOption.id : 'imported',
        kind: typeof source.titleOption.kind === 'string' ? source.titleOption.kind : '导入的标题',
        text: source.titleOption.text,
        reason: typeof source.titleOption.reason === 'string' ? source.titleOption.reason : '',
      },
    };
    state.title = title;
  }

  if (isRecord(source.expression) && Array.isArray(source.expression.sections)) {
    const sections = source.expression.sections
      .filter(isRecord)
      .filter((s) => typeof s.label === 'string')
      .map((s, i) => ({
        id: typeof s.id === 'string' ? s.id : `imported-${i}`,
        label: s.label as string,
        role: typeof s.role === 'string' ? s.role : '',
        detail: typeof s.detail === 'string' ? s.detail : '',
      }));
    if (sections.length) {
      const format =
        source.expression.format === 'video' || source.expression.format === 'carousel'
          ? source.expression.format
          : 'text';
      const followUps: Record<string, string> = {};
      if (isRecord(source.expression.followUps)) {
        for (const [k, v] of Object.entries(source.expression.followUps)) {
          if (typeof v === 'string') followUps[k] = v;
        }
      }
      const expression: ExpressionAnswer = { sections, format, followUps };
      state.expression = expression;
    }
  }

  const restored = ['audience', 'topic', 'subject', 'angle', 'title', 'expression'].filter(
    (k) => state[k as keyof WizardState] !== null,
  );
  if (!restored.length) {
    return { ok: false, error: '这份 JSON 里没有可恢复的内容，请确认是本工具导出的文件。' };
  }

  return { ok: true, state };
}

/** 返回一句面向用户的结果说明 */
export function describeImport(state: WizardState): string {
  const names: Array<[keyof WizardState, string]> = [
    ['audience', '关系'],
    ['topic', '话题'],
    ['subject', '选题'],
    ['angle', '切入点'],
    ['title', '标题'],
    ['expression', '表达'],
  ];
  const got = names.filter(([k]) => state[k] !== null).map(([, n]) => n);
  const missing = names.filter(([k]) => state[k] === null).map(([, n]) => n);
  return missing.length
    ? `已恢复：${got.join('、')}；缺：${missing.join('、')}（可以补填后继续）。`
    : `六步全部恢复：${got.join('、')}。`;
}
