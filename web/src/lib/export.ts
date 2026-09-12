// 导出层：把向导状态渲染成三种产物。
// 一致性要求：Markdown / Prompt / JSON 三种产物必须来自同一份 buildBrief()，字段不得各写一套。

import { buildFilterList } from '../presets';
import { OUTPUT_FORMAT_LABEL, STEP_META } from '../types';
import type { AngleOption, TitleOption, WizardState } from '../types';

export interface BriefGroup {
  title?: string;
  items: string[];
}

export interface Brief {
  title: string;
  generatedAt: string;
  sections: Array<{ layer: string; question: string; lines: string[]; groups?: BriefGroup[] }>;
}

function angleOf(state: WizardState): AngleOption[] {
  return state.angle?.selected ?? [];
}

function titleOf(state: WizardState): TitleOption | null {
  return state.title?.selected ?? null;
}

/** 唯一的事实来源：三种导出都从这里取内容 */
export function buildBrief(state: WizardState): Brief {
  const sections: Brief['sections'] = [];

  sections.push({
    layer: STEP_META.audience.layer,
    question: STEP_META.audience.question,
    // 明确写出视角：避免「给谁看」这种说法让人分不清是谁在看谁
    lines: state.audience
      ? [`你（创作者）要讲给谁：${state.audience.label}`, `这意味着：${state.audience.implies}`]
      : ['（未填写）'],
  });

  sections.push({
    layer: STEP_META.topic.layer,
    question: STEP_META.topic.question,
    lines: state.topic
      ? [`大方向：${state.topic.big}`, `范围收窄到：${state.topic.subs.join('、') || '（未选）'}`]
      : ['（未填写）'],
  });

  const filter = state.subject
    ? buildFilterList(state.subject.what, state.topic?.subs ?? [])
    : { skip: [] as string[], must: [] as string[] };
  sections.push({
    layer: STEP_META.subject.layer,
    question: STEP_META.subject.question,
    lines: state.subject
      ? [`要对谁讲：${state.subject.who.label}`, `要讲什么：${state.subject.what}`]
      : ['（未填写）'],
    // 分组而不是拼缩进字符串：展示层不需要再解析前缀，浏览器和 Markdown 才能各自渲染成正确的列表
    groups: state.subject
      ? [
          { title: '这次不讲', items: filter.skip },
          { title: '这次必须给到', items: filter.must },
        ]
      : undefined,
  });

  sections.push({
    layer: STEP_META.angle.layer,
    question: STEP_META.angle.question,
    lines: angleOf(state).length
      ? angleOf(state).map((a, i) => `${i + 1}. [${a.label}] ${a.text}`)
      : ['（未填写）'],
  });

  const title = titleOf(state);
  sections.push({
    layer: STEP_META.title.layer,
    question: STEP_META.title.question,
    lines: title ? [`标题：${title.text}`, `句式：${title.kind}`, `为什么是它：${title.reason}`] : ['（未填写）'],
  });

  sections.push({
    layer: STEP_META.expression.layer,
    question: STEP_META.expression.question,
    lines: state.expression
      ? [`体裁：${OUTPUT_FORMAT_LABEL[state.expression.format]}`, '结构顺序：']
      : ['（未填写）'],
    groups: state.expression
      ? [
          {
            items: state.expression.sections.map(
              (s, i) => `${i + 1}. ${s.label}——${s.role}${s.detail ? `；本篇要讲：${s.detail}` : ''}`,
            ),
          },
          ...(Object.keys(state.expression.followUps).length
            ? [
                {
                  title: '体裁追问',
                  items: Object.entries(state.expression.followUps).map(([q, a]) => `${q} ${a || '（未填）'}`),
                },
              ]
            : []),
        ]
      : undefined,
  });

  return {
    title: title ? title.text : '未命名选题',
    generatedAt: new Date().toISOString(),
    sections,
  };
}

export function toMarkdown(state: WizardState): string {
  const brief = buildBrief(state);
  const out: string[] = ['# 创作简报', '', `> 标题：${brief.title}`, ''];
  for (const s of brief.sections) {
    out.push(`## ${s.layer}｜${s.question}`, '');
    for (const line of s.lines) out.push(line);
    if (s.lines.length) out.push('');
    for (const g of s.groups ?? []) {
      if (g.title) out.push(`**${g.title}**`, '');
      for (const item of g.items) out.push(`- ${item}`);
      out.push('');
    }
  }
  out.push('---', '', `由「内容创作向导」生成于 ${brief.generatedAt}`, '');
  return out.join('\n');
}

/** 可直接粘贴进另一个 AI 对话框的提示词 */
export function toPrompt(state: WizardState): string {
  const brief = buildBrief(state);
  const body = brief.sections
    .map((s) => {
      const blocks = s.lines.map((l) => `- ${l}`);
      for (const g of s.groups ?? []) {
        if (g.title) blocks.push(`- ${g.title}：`);
        for (const item of g.items) blocks.push(`  - ${item}`);
      }
      return `【${s.layer}】${s.question}\n${blocks.join('\n')}`;
    })
    .join('\n\n');
  return [
    '你要帮我写一条内容。下面是我已经想清楚的创作简报，请严格按它来写，不要自行更换选题和切入点。',
    '',
    body,
    '',
    '要求：',
    '1. 按上面给定的结构顺序展开，每一段都要服务于「说什么」那一项。',
    '2. 切入点只负责开头把人带进来，后面必须回到选题目标，不要写成另一篇内容。',
    '3. 标题就用上面选定的那一句；如果想换，只给 3 个候选并说明理由。',
    '4. 不要添加我没要求的信息，不要写空泛的大道理。',
  ].join('\n');
}

/** 导出为 JSON。与 Markdown 同源，只是换了承载形式。 */
export function toJson(state: WizardState): string {
  const brief = buildBrief(state);
  return JSON.stringify(
    {
      schema: 'content-wizard/brief@1',
      generatedAt: brief.generatedAt,
      brief: {
        title: brief.title,
        audience: state.audience,
        topic: state.topic,
        subject: state.subject,
        angles: angleOf(state),
        titleOption: titleOf(state),
        expression: state.expression,
      },
      rendered: brief.sections,
    },
    null,
    2,
  );
}

export function slugify(input: string): string {
  const base = input
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base.slice(0, 40) || '创作简报';
}

/** 触发浏览器下载 */
export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 复制到剪贴板，带 http 环境下的兜底 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
