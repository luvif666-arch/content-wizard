import { useEffect, useRef, useState } from 'react';
import { getSubtopics } from '../lib/model';
import type { CandidateSource, ModelPrefs } from '../lib/model';
import type { TopicAnswer } from '../types';

interface Props {
  value: TopicAnswer | null;
  prefs: ModelPrefs;
  onChange: (v: TopicAnswer) => void;
}

const MAX_SUBS = 2;

/** 第 2 步：话题。自由输入大类，系统给候选子话题卡片，最多选 2 个，也允许自己写。 */
export default function TopicStep({ value, prefs, onChange }: Props) {
  const [big, setBig] = useState(value?.big ?? '');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [customSub, setCustomSub] = useState('');
  const reqId = useRef(0);

  const subs = value?.subs ?? [];

  async function generate(raw: string, silent = false) {
    const key = raw.trim();
    const mine = ++reqId.current;
    if (!key) {
      setCandidates([]);
      setNote(undefined);
      return;
    }
    if (!silent) setLoading(true);
    const result = await getSubtopics(key, prefs);
    if (mine !== reqId.current) return; // 丢弃过期响应
    setCandidates(result.items);
    setSource(result.source);
    setNote(result.note);
    setLoading(false);
  }

  // 输入停顿 400ms 后自动给候选，避免每敲一个字都请求
  useEffect(() => {
    if (!big.trim()) {
      setCandidates([]);
      return;
    }
    const t = setTimeout(() => void generate(big, true), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big, prefs.apiKey, prefs.baseUrl, prefs.model]);

  function toggleSub(sub: string) {
    const has = subs.includes(sub);
    if (!has && subs.length >= MAX_SUBS) return;
    const next = has ? subs.filter((s) => s !== sub) : [...subs, sub];
    onChange({ big: big.trim(), subs: next });
  }

  function addCustomSub() {
    const s = customSub.trim();
    if (!s || subs.includes(s) || subs.length >= MAX_SUBS) return;
    onChange({ big: big.trim(), subs: [...subs, s] });
    setCustomSub('');
  }

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 2 步 · 话题</div>
        <h1>你想聊哪个大方向？</h1>
        <p className="lede">
          话题只决定讨论范围。范围圈好了，下一步才有东西可以收窄。
        </p>
        <p className="quote">
          “我今天想做一条情感内容” —— 范围有了，但我还是不知道你准备讲什么。
        </p>
      </div>

      <div className="field">
        <label htmlFor="topic-big">大类话题</label>
        <p className="helper">例：情感 / 职场 / AI / 健康 / 消费 / 自媒体</p>
        <div className="grid-2">
          <input
            id="topic-big"
            type="text"
            value={big}
            placeholder="输入一个大方向"
            onChange={(e) => {
              const nextBig = e.target.value;
              setBig(nextBig);
              // 必须回写父状态：否则「是否填过大类话题」判断不到，下一步会被误判为未填写
              onChange({ big: nextBig, subs: value?.subs ?? [] });
            }}
          />
          <button type="button" className="btn" onClick={() => void generate(big)} disabled={!big.trim() || loading}>
            {loading ? '生成中…' : '换一批候选'}
          </button>
        </div>
      </div>

      {note && <div className="notice info">{note}</div>}

      {big.trim() && (
        <>
          <h2>
            收窄到哪一部分？
            <span className="tag" style={{ marginLeft: 8 }}>
              {source === 'model' ? '模型生成' : '内置预设'}
            </span>
            <span className="tag" style={{ marginLeft: 6 }}>
              已选 {subs.length}/{MAX_SUBS}
            </span>
          </h2>

          {loading && !candidates.length && <div className="notice">正在生成候选…</div>}

          {!loading && !candidates.length && (
            <div className="notice warn">
              这个话题暂时没有候选，可以直接在下面自己写一个更小的分支。
            </div>
          )}

          <div className="option-list two-col">
            {candidates.map((sub) => {
              const selected = subs.includes(sub);
              const blocked = !selected && subs.length >= MAX_SUBS;
              return (
                <button
                  key={sub}
                  type="button"
                  className={`option${selected ? ' selected' : ''}`}
                  style={blocked ? { opacity: 0.5 } : undefined}
                  aria-pressed={selected}
                  disabled={blocked}
                  onClick={() => toggleSub(sub)}
                >
                  <span className="option-label">
                    <span className="check" aria-hidden="true" />
                    {sub}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="topic-custom">自己想一个更小的分支</label>
            <div className="grid-2">
              <input
                id="topic-custom"
                type="text"
                value={customSub}
                placeholder="例：见过一次之后，怎么判断对方有没有兴趣"
                onChange={(e) => setCustomSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomSub();
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={addCustomSub}
                disabled={!customSub.trim() || subs.length >= MAX_SUBS}
              >
                添加
              </button>
            </div>
          </div>

          {subs.length > 0 && (
            <p className="lede">
              已选范围：<strong>{subs.join('、')}</strong>
            </p>
          )}
        </>
      )}
    </div>
  );
}
