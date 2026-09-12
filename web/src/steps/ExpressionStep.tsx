import { DEFAULT_SECTIONS, FORMAT_FOLLOW_UPS } from '../presets';
import { OUTPUT_FORMAT_LABEL } from '../types';
import type { ExpressionAnswer, ExpressionSection, OutputFormat } from '../types';

interface Props {
  value: ExpressionAnswer | null;
  onChange: (v: ExpressionAnswer) => void;
}

const FORMATS: OutputFormat[] = ['text', 'video', 'carousel'];

/** 第 6 步：表达。默认三段结构，可增删改序；再选体裁，按体裁追加追问。 */
export default function ExpressionStep({ value, onChange }: Props) {
  const sections: ExpressionSection[] = value?.sections?.length
    ? value.sections
    : DEFAULT_SECTIONS.map((s) => ({ ...s, detail: '' }));
  const format: OutputFormat = value?.format ?? 'text';
  const followUps = value?.followUps ?? {};

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
      </div>

      <h2>正文结构</h2>
      <div className="stack">
        {sections.map((s, i) => (
          <div className="rank-item" key={s.id}>
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
        ))}
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
