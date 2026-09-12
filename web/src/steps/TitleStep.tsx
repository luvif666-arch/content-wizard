import { useEffect, useState } from 'react';
import { getTitles } from '../lib/model';
import type { CandidateSource, GenContext, ModelPrefs } from '../lib/model';
import type { TitleAnswer, TitleOption } from '../types';
import StepQuote from './StepQuote';

interface Props {
  value: TitleAnswer | null;
  ctx: GenContext;
  prefs: ModelPrefs;
  onChange: (v: TitleAnswer) => void;
}

/** 第 5 步：标题。三种句式各 1 条，每条必须带生成理由；也可以自己写。 */
export default function TitleStep({ value, ctx, prefs, onChange }: Props) {
  const [options, setOptions] = useState<TitleOption[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState('');

  const key = `${ctx.audienceLabel}|${ctx.subject?.who.label ?? ''}|${ctx.subject?.what ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    if (!ctx.subject) return;
    setLoading(true);
    void getTitles(ctx, prefs).then((res) => {
      if (cancelled) return;
      setOptions(res.items);
      setSource(res.source);
      setNote(res.note);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, prefs.apiKey, prefs.baseUrl, prefs.model]);

  const selected = value?.selected ?? null;

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 5 步 · 标题</div>
        <h1>用哪句话开启这段对话？</h1>
        <p className="lede">
          这句话是<strong>你</strong>对<strong>读者</strong>说的第一句话。判断标准只有一个：他会不会觉得
          「这说的就是我」而愿意点进来。
        </p>
      </div>

      {note && <div className="notice info">{note}</div>}
      {loading && <div className="notice">正在生成标题候选…</div>}

      <h2>
        候选
        <span className="tag" style={{ marginLeft: 8 }}>
          {source === 'model' ? '模型生成' : '内置句式'}
        </span>
      </h2>

      <div className="option-list">
        {options.map((opt) => {
          const isSelected = selected?.id === opt.id && selected.text === opt.text;
          return (
            <button
              key={opt.id}
              type="button"
              className={`option${isSelected ? ' selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onChange({ selected: opt })}
            >
              <span className="option-label">
                <span className="check" aria-hidden="true" />
                <span className="tag">{opt.kind}</span>
                <span>{opt.text}</span>
              </span>
              <span className="option-implies">为什么是它：{opt.reason}</span>
            </button>
          );
        })}
      </div>

      <div className="field" style={{ marginTop: 18 }}>
        <label htmlFor="title-custom">或者自己写一句</label>
        <div className="grid-2">
          <input
            id="title-custom"
            type="text"
            value={custom}
            placeholder="例：第一次约会，找个能好好说话的地方。"
            onChange={(e) => setCustom(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={!custom.trim()}
            onClick={() =>
              onChange({
                selected: {
                  id: `custom-${Date.now()}`,
                  kind: '自己写的',
                  text: custom.trim(),
                  reason: `这是你自己写的一句。判断标准：它能不能让「${ctx.audienceLabel || '你想对话的人'}」看出这跟自己有关、并且愿意点进来。`,
                },
              })
            }
          >
            用这句
          </button>
        </div>
      </div>

      {selected && (
        <div className="panel">
          <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>当前选定</h3>
          <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{selected.text}</p>
          <p className="lede" style={{ margin: 0 }}>
            {selected.reason}
          </p>
        </div>
      )}

      {selected && <StepQuote step="title" />}
    </div>
  );
}
