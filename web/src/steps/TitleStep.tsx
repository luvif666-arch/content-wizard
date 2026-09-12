import { useEffect, useMemo, useState } from 'react';
import { basisKeyOf, clearReason, describeBasisChange, optionStillOffered } from '../lib/candidates';
import { SOURCE_LABEL, getTitles } from '../lib/model';
import type { CandidateSource, GenContext, ModelPrefs } from '../lib/model';
import type { TitleAnswer, TitleOption } from '../types';

interface Props {
  value: TitleAnswer | null;
  ctx: GenContext;
  prefs: ModelPrefs;
  onChange: (v: TitleAnswer) => void;
  /** 候选重新生成、旧选择作废时调用（自己手写的标题不算「基于候选」，不会被清掉） */
  onInvalidate: (reason: string) => void;
}

const LAYER = '标题';

/** 第 5 步：标题。三种句式各 1 条，每条必须带生成理由；也可以自己写。 */
export default function TitleStep({ value, ctx, prefs, onChange, onInvalidate }: Props) {
  const [options, setOptions] = useState<TitleOption[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState('');
  const [batch, setBatch] = useState(0);

  const basis = useMemo(
    () => ({
      audience: ctx.audienceLabel,
      topic: `${ctx.topic?.big ?? ''}|${(ctx.topic?.subs ?? []).join(',')}`,
      subject: `${ctx.subject?.who.label ?? ''}|${ctx.subject?.what ?? ''}`,
      model: `${prefs.baseUrl}#${prefs.model}`,
    }),
    [ctx.audienceLabel, ctx.topic?.big, ctx.topic?.subs, ctx.subject?.who.label, ctx.subject?.what, prefs.baseUrl, prefs.model],
  );
  const genKey = basisKeyOf(basis);

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
  }, [genKey, batch]);

  const selected = value?.selected ?? null;
  /** 自己手写的标题：它的参照物是用户的判断，不是这批候选，所以不该被候选重生成清掉 */
  const isCustom = !!selected && selected.id.startsWith('custom-');

  const optionsKey = useMemo(() => options.map((o) => `${o.id}:${o.text}`).join('|'), [options]);
  // 同第 4 步：候选换了，基于旧候选选的标题立刻作废并说明原因；手写标题保留，交给「待确认」机制。
  // 依据记过就严格比对；没记过（旧草稿 / JSON 恢复）就看文案是否还在候选里，还在就补记依据。
  useEffect(() => {
    if (!optionsKey) return;
    const current = value?.selected;
    if (!current) return;
    if (current.id.startsWith('custom-')) return;
    if (value?.basisKey !== undefined) {
      if (value.basisKey === genKey) return;
      onInvalidate(clearReason(LAYER, describeBasisChange(value.basisKey, basis)));
      return;
    }
    if (optionStillOffered(current, options)) {
      onChange({ selected: current, basisKey: genKey });
      return;
    }
    onInvalidate(clearReason(LAYER, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, genKey]);

  function pickTitle(opt: TitleOption) {
    onChange({ selected: opt, basisKey: genKey });
  }

  function rotate() {
    if (!prefs.apiKey) {
      setNote('内置标题是按当前受众与选题推导的三种句式，没有更多批次；在「设置」里填上模型可以再生成一批。');
      return;
    }
    if (selected && !isCustom) {
      onInvalidate(`你点了「换一批」，候选已经重新生成，原来的${LAYER}作废，请重新选。`);
    }
    setBatch((b) => b + 1);
  }

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
          {SOURCE_LABEL[source]}
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
              onClick={() => pickTitle(opt)}
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

      <div className="actions">
        <button type="button" className="btn small" onClick={rotate} disabled={loading}>
          {loading ? '生成中…' : '换一批'}
        </button>
        <span className="helper" style={{ margin: 0 }}>
          换一批会重新生成候选，基于候选选的标题会同时清空（自己手写的那句会留下）。
        </span>
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
                basisKey: genKey,
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
    </div>
  );
}
