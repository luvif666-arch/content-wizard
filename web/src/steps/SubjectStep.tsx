import { useEffect, useMemo, useState } from 'react';
import { INSPIRATION_PATTERNS, WHO_PRESETS } from '../presets';
import type { Inspiration } from '../presets';
import { SOURCE_LABEL, getInspirations } from '../lib/model';
import type { CandidateSource, ModelPrefs } from '../lib/model';
import type { SubjectAnswer, TopicAnswer } from '../types';
import StepQuote from './StepQuote';

interface Props {
  value: SubjectAnswer | null;
  topic: TopicAnswer | null;
  prefs: ModelPrefs;
  onChange: (v: SubjectAnswer) => void;
}

const VISIBLE = 4;

/** 第 3 步：选题——这次对谁说、说什么。两部分必须都填。 */
export default function SubjectStep({ value, topic, prefs, onChange }: Props) {
  const [customWho, setCustomWho] = useState(value?.who.id === 'custom' ? value.who.label : '');
  const [inspirations, setInspirations] = useState<Inspiration[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  /** 刚被点选填入的示例 id。用于提示用户「这是示例，可以改」，用户一动手就清掉。 */
  const [filledId, setFilledId] = useState<string | null>(null);

  const what = value?.what ?? '';
  const who = value?.who ?? null;
  const topicKey = `${topic?.big ?? ''}|${topic?.subs.join(',') ?? ''}`;

  function patch(next: Partial<SubjectAnswer>) {
    const merged: SubjectAnswer = {
      who: next.who ?? who ?? { id: '', label: '', hint: '' },
      what: next.what ?? what,
    };
    onChange(merged);
  }

  // 话题变了就重新取一批；换一批时本地轮换模板，不重复请求
  useEffect(() => {
    if (!topic?.big.trim()) {
      setInspirations([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getInspirations({ topic, subject: null, audienceLabel: '' }, prefs).then((res) => {
      if (cancelled) return;
      setInspirations(res.items);
      setSource(res.source);
      setNote(res.note);
      setOffset(0);
      setFilledId(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, prefs.apiKey, prefs.baseUrl, prefs.model]);

  /** 当前展示的 4 条：模型来源直接取前 4 条，模板来源按 offset 轮换 */
  const shown = useMemo(() => {
    if (!inspirations.length) return [];
    // 模型/联网来源无法本地轮换，直接取前几条
    if (source === 'model' || source === 'search') return inspirations.slice(0, VISIBLE);
    const n = inspirations.length;
    return Array.from({ length: Math.min(VISIBLE, n) }, (_, i) => inspirations[(i + offset) % n]);
  }, [inspirations, source, offset]);

  function rotate() {
    if (source === 'model' || source === 'search') {
      // 模型来源无法本地轮换，重新请求一次
      setLoading(true);
      void getInspirations({ topic, subject: null, audienceLabel: '' }, prefs).then((res) => {
        setInspirations(res.items);
        setSource(res.source);
        setNote(res.note);
        setLoading(false);
      });
      return;
    }
    setOffset((o) => (o + VISIBLE) % Math.max(inspirations.length, 1));
  }

  function applyInspiration(item: Inspiration) {
    setFilledId(item.id);
    onChange({
      who: { id: 'from-inspiration', label: item.whoLabel, hint: '来自灵感示例' },
      what: item.what,
    });
  }

  const missingWho = !who || !who.label;
  const missingWhat = !what.trim();

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 3 步 · 选题</div>
        <h1>这次你要对谁说什么？</h1>
        <p className="lede">
          你是创作者，这一步要定的是：<strong>你</strong>这次对着<strong>哪一个具体的人</strong>，
          讲<strong>哪一件具体的事</strong>。
        </p>
        {topic?.subs.length ? (
          <p className="quote">当前范围：{topic.subs.join('、')}（来自第 2 步）</p>
        ) : null}
      </div>

      <div className="field">
        <label>他是谁？先选一个处境类型</label>
        <p className="helper">他跟你的关系越具体，你越知道该讲什么。</p>
        <div className="option-list">
          {WHO_PRESETS.map((p) => {
            const selected = who?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`option${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => {
                  setFilledId(null);
                  patch({
                    who: {
                      id: p.id,
                      label: p.id === 'custom' ? customWho.trim() || '（待填写）' : p.label,
                      hint: p.hint,
                    },
                  });
                }}
              >
                <span className="option-label">
                  <span className="check" aria-hidden="true" />
                  {p.label}
                </span>
                <span className="option-hint">{p.hint}</span>
              </button>
            );
          })}
        </div>

        {who?.id === 'custom' && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="who-custom" className="sr-only">
              他自己描述
            </label>
            <input
              id="who-custom"
              type="text"
              value={customWho}
              placeholder="例：约过很多次，却始终进不了关系的人"
              onChange={(e) => {
                setCustomWho(e.target.value);
                patch({
                  who: { id: 'custom', label: e.target.value.trim() || '（待填写）', hint: '自己描述' },
                });
              }}
            />
          </div>
        )}
      </div>

      {/* 灵感示例：抽象的处境类型给不出具体的人和事，这里给结合当前话题的实例 */}
      {topic?.big.trim() && (
        <div className="inspire">
          <div className="inspire-head">
            <h2 style={{ margin: 0 }}>没头绪？从这些真实处境里挑一个</h2>
            <span className={`tag${source === 'search' ? ' tag-live' : ''}`}>{SOURCE_LABEL[source]}</span>
          </div>
          <p className="helper">
            点一条就能把「他是谁」和「你要讲什么」一起填上。<strong>它只是起点，填完随便改</strong>——
            你可以换成自己的经历，也可以只借它的角度。
          </p>

          {note && <div className="notice info">{note}</div>}
          {loading && !shown.length && <div className="notice">正在生成示例…</div>}

          <div className="option-list">
            {shown.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`option inspire-card${filledId === item.id ? ' selected' : ''}`}
                aria-pressed={filledId === item.id}
                onClick={() => applyInspiration(item)}
              >
                <span className="option-label">
                  <span className="check" aria-hidden="true" />
                  <span className="tag">{item.whoLabel}</span>
                </span>
                <span className="inspire-what">{item.what}</span>
              </button>
            ))}
          </div>

          <div className="actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn small" onClick={rotate} disabled={loading}>
              {loading ? '生成中…' : '换一批'}
            </button>
            <span className="helper" style={{ margin: 0 }}>
              覆盖 {INSPIRATION_PATTERNS.length} 种不同处境
            </span>
          </div>

          {filledId && (
            <div className="notice info">
              示例已填入下面两个框。你想怎么改都行——示例只是给你一个能往下想的起点。
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="subject-what">你要讲哪件具体的事？</label>
        <p className="helper">写成一句「给【谁】，讲【怎么 / 为什么】」的话，视角是你要对读者说什么。</p>
        <textarea
          id="subject-what"
          value={what}
          placeholder="例：怎么让这次约会聊得舒服，让对方愿意继续了解你"
          onChange={(e) => {
            setFilledId(null);
            patch({ what: e.target.value });
          }}
        />
        <p className="helper" style={{ marginTop: 6 }}>
          字数建议 10–40 字。太短会退回成话题，太长说明还没收窄。
        </p>
      </div>

      {(missingWho || missingWhat) && (
        <div className="notice warn">
          还差：
          {missingWho ? '「具体的人」' : ''}
          {missingWho && missingWhat ? ' 和 ' : ''}
          {missingWhat ? '「具体的事」' : ''}
          。两部分都填好才能进入下一步。
        </div>
      )}

      {!missingWho && !missingWhat && <StepQuote step="subject" />}
    </div>
  );
}
