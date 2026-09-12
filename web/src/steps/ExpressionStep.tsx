import { useEffect, useMemo, useRef, useState } from 'react';
import { basisKeyOf, clearReason, describeBasisChange } from '../lib/candidates';
import { SOURCE_LABEL, expandSection, getSectionIdeas } from '../lib/model';
import type { BasisFields } from '../lib/candidates';
import type { CandidateSource, GenContext, ModelPrefs } from '../lib/model';
import type { SectionIdea } from '../presets';
import { DEFAULT_SECTIONS, FORMAT_FOLLOW_UPS } from '../presets';
import { OUTPUT_FORMAT_LABEL } from '../types';
import type {
  AngleOption,
  ExpressionAnswer,
  ExpressionSection,
  OutputFormat,
  SectionExpansion,
  SectionReference,
  TitleOption,
} from '../types';

interface Props {
  value: ExpressionAnswer | null;
  ctx: GenContext;
  /** 第 4 步已选的切入点，进入参考写法的上下文 */
  angles: AngleOption[];
  /** 第 5 步选定的标题，进入参考写法的上下文 */
  title: TitleOption | null;
  prefs: ModelPrefs;
  onChange: (v: ExpressionAnswer) => void;
  /**
   * 候选重生成后清掉了采纳的参考写法／扩写时，把原因交给外层显示。
   * 清空由本步自己做：这一步被作废的只是「从候选里采纳的东西」，
   * 用户自己敲进「这一段你要讲什么」的内容要留着，所以不能整步重置、也不能撤销这一步的「已确认」。
   */
  onNotice: (reason: string) => void;
}

const FORMATS: OutputFormat[] = ['text', 'video', 'carousel'];
/** 每段一次展示几条参考写法（需求：3–4 条不同角度） */
const VISIBLE = 4;
/** 「换一批」的位移量。候选池 5 条，位移 2 保证换过之后至少还有 3 条带上下文的模板 */
const ROTATE_STEP = 2;
const LAYER = '参考写法';

interface IdeaSlot {
  items: SectionIdea[];
  source: CandidateSource;
  note?: string;
  /** 模板来源按位移轮换，不重复请求 */
  offset: number;
  loading: boolean;
}

/** 第 6 步：表达。默认三段结构，可增删改序；再选体裁，按体裁追加追问。
 *  每一段都能拿到结合已定内容的「参考写法」（3–4 条），并可一键扩写成更具体的建议。 */
export default function ExpressionStep({ value, ctx, angles, title, prefs, onChange, onNotice }: Props) {
  const sections: ExpressionSection[] = value?.sections?.length
    ? value.sections
    : DEFAULT_SECTIONS.map((s) => ({ ...s, detail: '' }));
  const format: OutputFormat = value?.format ?? 'text';
  const followUps = value?.followUps ?? {};

  const [ideas, setIdeas] = useState<Record<string, IdeaSlot>>({});
  const [expanding, setExpanding] = useState<string | null>(null);
  const [expandNote, setExpandNote] = useState<Record<string, string | undefined>>({});

  /**
   * 参考写法的生成依据：第 3 步的对谁说什么 + 第 4 步切入点 + 第 5 步标题 + 这一段的职责。
   * 依据一变，基于旧候选采纳的写法就必须作废——否则会出现「新标题配着旧写法」。
   * 注意：段落名称不进依据，改名字不该让候选重生成（否则每敲一个字都清空一次）。
   */
  const upstreamBasis = useMemo(
    () => ({
      audience: ctx.audienceLabel,
      topic: `${ctx.topic?.big ?? ''}|${(ctx.topic?.subs ?? []).join(',')}`,
      subject: `${ctx.subject?.who.label ?? ''}|${ctx.subject?.what ?? ''}`,
      angle: angles.map((a) => a.id).join(',') || '(未选)',
      title: title?.text ?? '(未选)',
      model: `${prefs.baseUrl}#${prefs.model}`,
    }),
    [
      ctx.audienceLabel,
      ctx.topic?.big,
      ctx.topic?.subs,
      ctx.subject?.who.label,
      ctx.subject?.what,
      angles,
      title?.text,
      prefs.baseUrl,
      prefs.model,
    ],
  );

  function sectionBasis(section: ExpressionSection): BasisFields {
    return { ...upstreamBasis, structure: `${section.id}:${section.role}` };
  }

  const ctxKey = basisKeyOf(upstreamBasis);
  const structureKey = sections.map((s) => `${s.id}:${s.role}`).join('|');
  const sectionsKey = sections
    .map((s) => `${s.id}:${s.role}:${s.reference?.basisKey ?? ''}:${s.expansion?.basisKey ?? ''}`)
    .join('|');

  const genRef = useRef('');

  // 逐段生成参考写法。结构或上下文没变就不重生成：改段落名称不该把候选洗掉。
  useEffect(() => {
    if (!ctx.subject) return;
    const key = `${ctxKey}||${structureKey}`;
    if (genRef.current === key) return;
    genRef.current = key;

    let cancelled = false;
    const list = sections;
    void (async () => {
      for (let i = 0; i < list.length; i += 1) {
        const section = list[i];
        const res = await getSectionIdeas(
          { ...ctx, angles, title, section, position: i + 1, total: list.length },
          prefs,
        );
        if (cancelled) return;
        setIdeas((prev) => ({
          ...prev,
          [section.id]: { items: res.items, source: res.source, note: res.note, offset: 0, loading: false },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, structureKey]);

  /**
   * 依据变了 ⇒ 采纳过的参考写法/扩写立即作废，并把原因说清楚。
   * 只清候选推导出来的东西；用户自己敲进「这一段你要讲什么」的内容一律保留。
   */
  useEffect(() => {
    const pending = sections.filter(
      (s) =>
        (s.reference && s.reference.basisKey !== basisKeyOf(sectionBasis(s))) ||
        (s.expansion && s.expansion.basisKey !== basisKeyOf(sectionBasis(s))),
    );
    if (!pending.length) return;
    const first = pending[0];
    const oldKey = first.reference?.basisKey ?? first.expansion?.basisKey;
    onNotice(clearReason(LAYER, describeBasisChange(oldKey, sectionBasis(first))));
    onChange({
      sections: sections.map((s) => {
        const changed = s.reference?.basisKey !== basisKeyOf(sectionBasis(s)) || s.expansion?.basisKey !== basisKeyOf(sectionBasis(s));
        return changed ? { ...s, reference: null, expansion: null } : s;
      }),
      format,
      followUps,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionsKey, ctxKey]);

  function emit(next: Partial<ExpressionAnswer>) {
    onChange({
      sections: next.sections ?? sections,
      format: next.format ?? format,
      followUps: next.followUps ?? followUps,
    });
  }

  function patchSection(id: string, patch: Partial<ExpressionSection>) {
    emit({ sections: sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    emit({ sections: next });
  }

  function remove(id: string) {
    if (sections.length <= 1) return;
    emit({ sections: sections.filter((s) => s.id !== id) });
  }

  function addSection() {
    emit({
      sections: [
        ...sections,
        { id: `custom-${Date.now()}`, label: '新段落', role: '说明这一段负责什么', detail: '' },
      ],
    });
  }

  function changeFormat(next: OutputFormat) {
    const questions = FORMAT_FOLLOW_UPS[next] ?? [];
    const carried: Record<string, string> = {};
    for (const q of questions) carried[q] = followUps[q] ?? '';
    emit({ format: next, followUps: carried });
  }

  /** 采纳一条参考写法（再点一次取消）。采纳的是候选对象，所以候选换了它就必须作废。 */
  function adopt(section: ExpressionSection, idea: SectionIdea) {
    const same = section.reference?.id === idea.id;
    const reference: SectionReference | null = same
      ? null
      : {
          id: idea.id,
          approach: idea.approach,
          text: idea.text,
          source: idea.source,
          basisKey: basisKeyOf(sectionBasis(section)),
        };
    patchSection(section.id, { reference, expansion: same ? section.expansion ?? null : null });
  }

  function rotateSection(section: ExpressionSection) {
    const slot = ideas[section.id];
    if (!slot) return;
    // 换一批 = 这一段的候选换了一批，基于旧候选采纳的写法同时作废并说明原因
    if (section.reference || section.expansion) {
      onNotice(`你点了「换一批」，这一段的${LAYER}已经换了一批，原来的采纳作废，请重新选。`);
      patchSection(section.id, { reference: null, expansion: null });
    }
    if (slot.source === 'model') {
      setIdeas((prev) => ({ ...prev, [section.id]: { ...slot, loading: true } }));
      const index = sections.findIndex((s) => s.id === section.id);
      void getSectionIdeas(
        { ...ctx, angles, title, section, position: index + 1, total: sections.length },
        prefs,
      ).then((res) => {
        setIdeas((prev) => ({
          ...prev,
          [section.id]: { items: res.items, source: res.source, note: res.note, offset: 0, loading: false },
        }));
      });
      return;
    }
    setIdeas((prev) => ({
      ...prev,
      [section.id]: { ...slot, offset: (slot.offset + ROTATE_STEP) % Math.max(slot.items.length, 1) },
    }));
  }

  function expand(section: ExpressionSection) {
    setExpanding(section.id);
    const index = sections.findIndex((s) => s.id === section.id);
    void expandSection({ ...ctx, angles, title, section, position: index + 1, total: sections.length }, prefs).then(
      (res) => {
        const expansion: SectionExpansion = { ...res.item, basisKey: basisKeyOf(sectionBasis(section)) };
        setExpanding((cur) => (cur === section.id ? null : cur));
        setExpandNote((prev) => ({ ...prev, [section.id]: res.note }));
        patchSection(section.id, { expansion });
      },
    );
  }

  /** 扩写里的「这一段打算讲什么」正好就是这一步要填的东西，一键写进去 */
  function applyExpansionPlan(section: ExpressionSection) {
    if (!section.expansion) return;
    patchSection(section.id, { detail: section.expansion.plan });
  }

  function shownIdeas(slot: IdeaSlot | undefined): SectionIdea[] {
    if (!slot?.items.length) return [];
    if (slot.source === 'model') return slot.items.slice(0, VISIBLE);
    const n = slot.items.length;
    return Array.from({ length: Math.min(VISIBLE, n) }, (_, i) => slot.items[(i + slot.offset) % n]);
  }

  const questions = FORMAT_FOLLOW_UPS[format] ?? [];

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 6 步 · 表达</div>
        <h1>你准备用什么让对方理解你的判断？</h1>
        <p className="lede">
          你要顺着<strong>读者</strong>已经理解到的地方往下接：先给场景让他认出现象，
          再解释为什么值得在意，最后给出他能立刻用上的建议。
        </p>
        {ctx.subject && (
          <p className="quote">
            当前选题：对「{ctx.subject.who.label}」讲「{ctx.subject.what}」
            {title ? `；标题「${title.text}」` : ''}
          </p>
        )}
      </div>

      <h2>正文结构</h2>
      <p className="helper">
        结构先定顺序，下面每一段都会给你几条结合当前选题的<strong>参考写法</strong>。
      </p>

      <div className="stack">
        {sections.map((s, i) => {
          const slot = ideas[s.id];
          const shown = shownIdeas(slot);
          return (
            <div className="section-block" key={s.id}>
              <div className="rank-item">
                <span className="rank-num">{i + 1}</span>
                <span className="rank-body">
                  <input
                    type="text"
                    value={s.label}
                    aria-label={`第 ${i + 1} 段名称`}
                    onChange={(e) => patchSection(s.id, { label: e.target.value })}
                    style={{ fontWeight: 600, marginBottom: 6 }}
                  />
                  <div className="option-hint" style={{ marginBottom: 6 }}>
                    负责：{s.role}
                  </div>
                  <input
                    type="text"
                    value={s.detail}
                    placeholder="这一段你要讲什么（可留空）"
                    aria-label={`第 ${i + 1} 段要讲什么`}
                    onChange={(e) => patchSection(s.id, { detail: e.target.value })}
                  />
                </span>
                <span className="rank-controls">
                  <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === sections.length - 1}
                    aria-label="下移"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => remove(s.id)}
                    disabled={sections.length <= 1}
                    aria-label="删除这一段"
                  >
                    ×
                  </button>
                </span>
              </div>

              {/* 参考写法：不知道怎么下笔时的起点，不是成稿 */}
              <div className="ideas" data-section={s.id}>
                <div className="ideas-head">
                  <h3>第 {i + 1} 段的参考写法</h3>
                  <span className="tag">
                    {slot?.source === 'model' ? '模型生成' : '内置库 / 模板推导'}
                  </span>
                  {s.reference && <span className="tag tag-adopted">已采纳：{s.reference.approach}</span>}
                </div>
                <p className="helper">
                  这是<strong>参考不是成稿</strong>：可以点一条采纳，也可以照着全改——
                  怎么写这一段，最终由你决定。
                </p>

                {!ctx.subject && <div className="notice info">先回第 3 步定「对谁说什么」，这里才好给这一段的写法。</div>}
                {slot?.note && <div className="notice info">{slot.note}</div>}
                {!slot && ctx.subject && <div className="notice">正在生成参考写法…</div>}

                <div className="option-list">
                  {shown.map((idea) => {
                    const adopted = s.reference?.id === idea.id;
                    return (
                      <button
                        key={idea.id}
                        type="button"
                        className={`option idea-card${adopted ? ' selected' : ''}`}
                        aria-pressed={adopted}
                        onClick={() => adopt(s, idea)}
                      >
                        <span className="option-label">
                          <span className="check" aria-hidden="true" />
                          <span className="tag">{idea.approach}</span>
                          <span className={`tag source-tag source-${idea.source}`}>
                            {SOURCE_LABEL[idea.source]}
                          </span>
                        </span>
                        <span className="inspire-what">{idea.text}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn small" onClick={() => rotateSection(s)} disabled={slot?.loading}>
                    {slot?.loading ? '生成中…' : '换一批'}
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => expand(s)}
                    disabled={expanding === s.id}
                  >
                    {expanding === s.id ? '扩写中…' : '根据已定内容扩写这段'}
                  </button>
                </div>

                {expandNote[s.id] && <div className="notice info">{expandNote[s.id]}</div>}

                {s.expansion && (
                  <div className="expansion">
                    <p>
                      <strong>这一段打算讲什么：</strong>
                      {s.expansion.plan}
                    </p>
                    <p>
                      <strong>举什么例子：</strong>
                      {s.expansion.example}
                    </p>
                    <p>
                      <strong>给什么建议：</strong>
                      {s.expansion.advice}
                    </p>
                    <div className="actions" style={{ marginTop: 10 }}>
                      <span className={`tag source-tag source-${s.expansion.source}`}>
                        {SOURCE_LABEL[s.expansion.source]}
                      </span>
                      <button type="button" className="btn small" onClick={() => applyExpansionPlan(s)}>
                        把「打算讲什么」写进这一段
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" className="btn small" onClick={addSection}>
          + 加一段
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => emit({ sections: DEFAULT_SECTIONS.map((s) => ({ ...s, detail: '' })) })}
        >
          恢复默认三段
        </button>
      </div>

      <h2 style={{ marginTop: 24 }}>体裁</h2>
      <div className="option-list" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            className={`option${format === f ? ' selected' : ''}`}
            aria-pressed={format === f}
            onClick={() => changeFormat(f)}
          >
            <span className="option-label">
              <span className="check" aria-hidden="true" />
              {OUTPUT_FORMAT_LABEL[f]}
            </span>
          </button>
        ))}
      </div>

      {questions.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>{OUTPUT_FORMAT_LABEL[format]}还要想清楚</h2>
          <div className="stack">
            {questions.map((q) => (
              <div className="field" key={q} style={{ marginBottom: 0 }}>
                <label htmlFor={`fu-${q}`}>{q}</label>
                <input
                  id={`fu-${q}`}
                  type="text"
                  value={followUps[q] ?? ''}
                  onChange={(e) => emit({ followUps: { ...followUps, [q]: e.target.value } })}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
