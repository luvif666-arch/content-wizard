import { useEffect, useState } from 'react';
import { getAngles } from '../lib/model';
import type { CandidateSource, GenContext, ModelPrefs } from '../lib/model';
import type { AngleAnswer, AngleOption } from '../types';

interface Props {
  value: AngleAnswer | null;
  ctx: GenContext;
  prefs: ModelPrefs;
  onChange: (v: AngleAnswer) => void;
}

const MAX_ANGLES = 3;

/**
 * 切入点与选题目标的一致性校验。
 * 文章原话：切入点只负责把人带进来，后面的内容要继续完成你原来选定的目标。
 * 这里做的是弱校验——只判断选中的切入点是否都停留在「信息型」，缺一个回到目标的桥。
 */
function checkConsistency(selected: AngleOption[], subjectWhat: string): string | null {
  if (!selected.length || !subjectWhat.trim()) return null;
  const informationalOnly = new Set(['misconception', 'cost', 'comparison']);
  const allInformational = selected.every((a) => informationalOnly.has(a.id));
  if (!allInformational) return null;
  return `你选的都是“把话说清楚”类型的入口（误区 / 踩坑 / 对比）。它们能吸引人进来，但本身不指向结论——正文里必须明确回到「${subjectWhat}」，否则这篇会变成另一篇内容。`;
}

/** 第 4 步：切入点。6 类各给一个结合当前选题的候选，选 1–3 个并排序。 */
export default function AngleStep({ value, ctx, prefs, onChange }: Props) {
  const [options, setOptions] = useState<AngleOption[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const selected = value?.selected ?? [];

  useEffect(() => {
    let cancelled = false;
    if (!ctx.subject) return;
    setLoading(true);
    void getAngles(ctx, prefs).then((res) => {
      if (cancelled) return;
      setOptions(res.items);
      setSource(res.source);
      setNote(res.note);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // 上游选题一改，候选必须重新生成，否则文案会和当前选题对不上
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ctx.subject?.who.label,
    ctx.subject?.what,
    ctx.topic?.subs.join(','),
    ctx.audienceLabel,
    prefs.apiKey,
    prefs.baseUrl,
    prefs.model,
  ]);

  function emit(next: AngleOption[]) {
    onChange({ selected: next, consistencyAcknowledged: value?.consistencyAcknowledged ?? false });
  }

  function toggle(opt: AngleOption) {
    const has = selected.some((a) => a.id === opt.id);
    if (has) {
      emit(selected.filter((a) => a.id !== opt.id));
      return;
    }
    if (selected.length >= MAX_ANGLES) return;
    emit([...selected, opt]);
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
  }

  const warning = checkConsistency(selected, ctx.subject?.what ?? '');

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 4 步 · 切入点</div>
        <h1>这次从哪里开始聊？</h1>
        <p className="lede">
          选题决定<strong>说什么</strong>，切入点决定<strong>从哪句话开始</strong>。
          你要挑的是「第一句从哪切进去」，让读者愿意继续听下去。
        </p>
        {ctx.subject && (
          <p className="quote">
            当前选题：你（创作者）要对「{ctx.subject.who.label}」，讲「{ctx.subject.what}」
          </p>
        )}
      </div>

      {note && <div className="notice info">{note}</div>}
      {loading && <div className="notice">正在生成切入点候选…</div>}

      <h2>
        选 1–{MAX_ANGLES} 个入口
        <span className="tag" style={{ marginLeft: 8 }}>
          {source === 'model' ? '模型生成' : '内置规则'}
        </span>
        <span className="tag" style={{ marginLeft: 6 }}>
          已选 {selected.length}/{MAX_ANGLES}
        </span>
      </h2>

      <div className="option-list">
        {options.map((opt) => {
          const isSelected = selected.some((a) => a.id === opt.id);
          const blocked = !isSelected && selected.length >= MAX_ANGLES;
          return (
            <button
              key={opt.id}
              type="button"
              className={`option${isSelected ? ' selected' : ''}`}
              style={blocked ? { opacity: 0.5 } : undefined}
              aria-pressed={isSelected}
              disabled={blocked}
              onClick={() => toggle(opt)}
            >
              <span className="option-label">
                <span className="check" aria-hidden="true" />
                {opt.label}
              </span>
              <span className="option-hint">{opt.text}</span>
            </button>
          );
        })}
      </div>

      {selected.length > 0 && (
        <>
          <h2 style={{ marginTop: 22 }}>决定顺序：先讲哪个入口</h2>
          <div className="stack">
            {selected.map((a, i) => (
              <div className="rank-item" key={a.id}>
                <span className="rank-num">{i + 1}</span>
                <span className="rank-body">
                  <strong>{a.label}</strong>
                  <div className="option-hint">{a.text}</div>
                </span>
                <span className="rank-controls">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`把${a.label}上移`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === selected.length - 1}
                    aria-label={`把${a.label}下移`}
                  >
                    ↓
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {warning && !value?.consistencyAcknowledged && (
        <div className="notice warn">
          <strong>一致性提醒：</strong>
          {warning}
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn small"
              onClick={() => onChange({ selected, consistencyAcknowledged: true })}
            >
              我知道了，正文会回到选题目标
            </button>
          </div>
        </div>
      )}

      {warning && value?.consistencyAcknowledged && (
        <div className="notice info">已确认：正文会从切入点回到「{ctx.subject?.what}」这个目标。</div>
      )}
    </div>
  );
}
