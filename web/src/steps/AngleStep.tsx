import { useEffect, useMemo, useState } from 'react';
import { basisKeyOf, clearReason, describeBasisChange, optionStillOffered } from '../lib/candidates';
import { SOURCE_LABEL, getAngles } from '../lib/model';
import type { CandidateSource, GenContext, ModelPrefs } from '../lib/model';
import type { AngleAnswer, AngleOption } from '../types';

interface Props {
  value: AngleAnswer | null;
  ctx: GenContext;
  prefs: ModelPrefs;
  onChange: (v: AngleAnswer) => void;
  /** 候选重新生成、旧选择作废时调用：由 App 统一清空这一步的答案与「已确认」快照，并把原因显示给用户 */
  onInvalidate: (reason: string) => void;
}

const MAX_ANGLES = 3;
const LAYER = '切入点';

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
export default function AngleStep({ value, ctx, prefs, onChange, onInvalidate }: Props) {
  const [options, setOptions] = useState<AngleOption[]>([]);
  const [source, setSource] = useState<CandidateSource>('preset');
  const [note, setNote] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  /** 换一批的批次号：只用来触发重新生成，不参与「依据」判定 */
  const [batch, setBatch] = useState(0);

  const selected = value?.selected ?? [];

  // 这批候选是按什么生成出来的。上游里任何会影响切入点文案的字段都要算进来。
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
    // 上游选题一改，或用户点了「换一批」，候选都必须重新生成，否则文案会和当前选题对不上
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genKey, batch]);

  /**
   * 候选一重生成，基于旧候选的选择就必须立刻作废——不能等用户手动取消。
   * 直接清空（不是标「待确认」）：待确认是留给「已经确认过、上游动了」的下游步骤的；
   * 这里选项本身换了，旧答案连参照物都没有，保留只会变成误导。
   *
   * 判据分两种：
   *  - 这一步的选择是本次在应用里做的 ⇒ 记过依据，依据对不上就直接清空（不看文案是否碰巧相同，
   *    因为「上游动了」本身就意味着这批候选已经不是用户当初挑的那一批）；
   *  - 没有记录依据（旧版草稿 / 从 JSON 恢复 / 分享链接进来）⇒ 退化为「文案还在不在候选里」，
   *    还在就认它仍然成立并补记依据，不在才清空。导入的数据不该一进来就被判废。
   */
  const optionsKey = useMemo(() => options.map((o) => `${o.id}:${o.text}`).join('|'), [options]);
  useEffect(() => {
    if (!optionsKey) return;
    const current = value?.selected ?? [];
    if (!current.length) return;
    if (value?.basisKey !== undefined) {
      if (value.basisKey === genKey) return;
      onInvalidate(clearReason(LAYER, describeBasisChange(value.basisKey, basis)));
      return;
    }
    if (current.every((a) => optionStillOffered(a, options))) {
      onChange({
        selected: current,
        consistencyAcknowledged: value?.consistencyAcknowledged ?? false,
        basisKey: genKey,
      });
      return;
    }
    onInvalidate(clearReason(LAYER, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, genKey]);

  function emit(next: AngleOption[]) {
    onChange({ selected: next, consistencyAcknowledged: value?.consistencyAcknowledged ?? false, basisKey: genKey });
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

  /** 换一批：候选会整批换掉，所以旧选择同时作废并说明原因 */
  function rotate() {
    if (!prefs.apiKey) {
      setNote('内置候选是按当前选题推导出的六类入口，没有更多批次；在「设置」里填上模型可以按选题再生成一批。');
      return;
    }
    if (selected.length) {
      onInvalidate(`你点了「换一批」，候选已经重新生成，原来的${LAYER}作废，请重新选。`);
    }
    setBatch((b) => b + 1);
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
          {SOURCE_LABEL[source]}
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

      <div className="actions">
        <button type="button" className="btn small" onClick={rotate} disabled={loading}>
          {loading ? '生成中…' : '换一批'}
        </button>
        <span className="helper" style={{ margin: 0 }}>
          换一批会重新生成候选，已选的入口会同时清空。
        </span>
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
              onClick={() => onChange({ selected, consistencyAcknowledged: true, basisKey: genKey })}
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
