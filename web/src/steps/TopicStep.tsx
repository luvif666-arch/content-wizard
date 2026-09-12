import { useEffect, useRef, useState } from 'react';
import { SOURCE_LABEL, getSubtopics } from '../lib/model';
import type { CandidateSource, ModelPrefs } from '../lib/model';
import type { TopicAnswer } from '../types';

interface Props {
  value: TopicAnswer | null;
  prefs: ModelPrefs;
  onChange: (v: TopicAnswer) => void;
  /** 候选重生成后清掉了已选范围时，把原因交给外层显示（清空由本步自己做，不整步重置） */
  onNotice: (reason: string) => void;
}

const MAX_SUBS = 2;
const LAYER = '子话题';

/** 第 2 步：话题。自由输入大类，系统给候选子话题卡片，最多选 2 个，也允许自己写。 */
export default function TopicStep({ value, prefs, onChange, onNotice }: Props) {
  const [big, setBig] = useState(value?.big ?? '');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [customSub, setCustomSub] = useState('');
  const reqId = useRef(0);

  const subs = value?.subs ?? [];
  const basisKey = big.trim();

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

  /**
   * 大方向一改，子话题候选就换了一批：原来选的子话题必须立即作废并说明原因。
   * 与第 4/5/6 步同一把尺子——只是这里清的是本步自己的字段，
   * 所以由本步清空、只把说明交给外层（整步重置会把用户刚敲的大方向一起弄丢）。
   * 没有记过依据的（旧草稿 / 从 JSON 恢复 / 分享链接）补记依据即可，不动他已选的范围。
   */
  useEffect(() => {
    const saved = value?.basisKey;
    if (saved === undefined) {
      if (subs.length) onChange({ big: basisKey, subs, basisKey });
      return;
    }
    if (saved === basisKey) return;
    if (!subs.length) {
      onChange({ big: basisKey, subs, basisKey });
      return;
    }
    onChange({ big: basisKey, subs: [], basisKey });
    onNotice(`大方向改了，原来选的${LAYER}已经不适用，已清空，请重新选。`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basisKey, value?.basisKey, subs.length]);

  function toggleSub(sub: string) {
    const has = subs.includes(sub);
    if (!has && subs.length >= MAX_SUBS) return;
    const next = has ? subs.filter((s) => s !== sub) : [...subs, sub];
    onChange({ big: big.trim(), subs: next, basisKey });
  }

  function addCustomSub() {
    const s = customSub.trim();
    if (!s || subs.includes(s) || subs.length >= MAX_SUBS) return;
    onChange({ big: big.trim(), subs: [...subs, s], basisKey });
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
              // 必须回写父状态：否则「是否填过大类话题」判断不到，下一步会被误判为未填写。
              // basisKey 留旧值：真正的清空判定交给上面那个 effect，避免在这里漏掉说明。
              onChange({ big: nextBig, subs: value?.subs ?? [], basisKey: value?.basisKey });
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
              {SOURCE_LABEL[source]}
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
        </>
      )}

      {/* 已选范围做成可删除的标签：
          候选列表会随输入变化，自定义添加的分支原本没有任何删除入口，
          用户一旦加错就再也去不掉。所以删减统一在这里做。 */}
      {subs.length > 0 && (
        <div className="chosen">
          <div className="chosen-head">
            <span className="chosen-title">已选范围</span>
            <span className="tag">
              {subs.length}/{MAX_SUBS}
            </span>
            <button type="button" className="linkbtn chosen-clear" onClick={() => onChange({ big: big.trim(), subs: [], basisKey })}>
              清空
            </button>
          </div>
          <div className="chips">
            {subs.map((sub) => (
              <span className="chip" key={sub}>
                {sub}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`去掉「${sub}」`}
                  title={`去掉「${sub}」`}
                  onClick={() => toggleSub(sub)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
