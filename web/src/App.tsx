import { useCallback, useEffect, useMemo, useState } from 'react';
import AudienceStep from './steps/AudienceStep';
import TopicStep from './steps/TopicStep';
import SubjectStep from './steps/SubjectStep';
import AngleStep from './steps/AngleStep';
import TitleStep from './steps/TitleStep';
import ExpressionStep from './steps/ExpressionStep';
import BriefView from './steps/BriefView';
import { loadPrefs, savePrefs } from './lib/model';
import type { GenContext, ModelPrefs } from './lib/model';
import { readSharedState } from './lib/share';
import { STEP_META, STEP_ORDER, emptyState } from './types';
import type { StepId, WizardState } from './types';

const DRAFT_KEY = 'content-wizard.draft.v1';
const SNAP_KEY = 'content-wizard.snapshots.v1';

type Snapshots = Partial<Record<StepId, string>>;

/** 每一步依赖的上游数据。上游变了，这一步的答案就要重新确认。 */
function upstreamOf(step: StepId, s: WizardState): unknown {
  switch (step) {
    case 'audience':
      return null;
    case 'topic':
      return s.audience;
    case 'subject':
      return { audience: s.audience, topic: s.topic };
    case 'angle':
      return { audience: s.audience, topic: s.topic, subject: s.subject };
    case 'title':
      return {
        audience: s.audience,
        topic: s.topic,
        subject: s.subject,
        angles: s.angle?.selected.map((a) => a.id) ?? [],
      };
    case 'expression':
      return { subject: s.subject, title: s.title?.selected?.id ?? null };
  }
}

function isStepDone(step: StepId, s: WizardState): boolean {
  switch (step) {
    case 'audience':
      return !!s.audience && s.audience.label !== '（待填写）';
    case 'topic':
      return !!s.topic && s.topic.big.trim().length > 0 && s.topic.subs.length > 0;
    case 'subject':
      return !!s.subject && !!s.subject.who.label && s.subject.who.label !== '（待填写）' && s.subject.what.trim().length > 0;
    case 'angle':
      return !!s.angle && s.angle.selected.length > 0;
    case 'title':
      return !!s.title?.selected;
    case 'expression':
      return !!s.expression && s.expression.sections.length > 0;
  }
}

/** 这一步缺什么。返回 null 表示可以进入下一步。 */
function blockReason(step: StepId, s: WizardState): string | null {
  if (isStepDone(step, s)) return null;
  switch (step) {
    case 'audience':
      return '还没选这条内容给谁看。选一个，或者自己描述。';
    case 'topic':
      if (!s.topic?.big.trim()) return '还没填大类话题。';
      return '范围还圈得太大，选一个更小的子话题（或自己写一个）再继续。';
    case 'subject': {
      const whoOk = !!s.subject?.who.label && s.subject.who.label !== '（待填写）';
      const whatOk = !!s.subject?.what.trim();
      if (!whoOk && !whatOk) return '还差：「具体的人」和「具体的事」。';
      if (!whoOk) return '还差：「具体的人」。';
      return '还差：「具体的事」。';
    }
    case 'angle':
      return '还没选切入点。至少选 1 个入口。';
    case 'title':
      return '还没定标题。选一条，或者自己写一句。';
    case 'expression':
      return '正文结构不能为空，至少留一段。';
  }
}

function loadDraft(): WizardState {
  const shared = readSharedState();
  if (shared) return shared;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    return { ...emptyState(), ...parsed };
  } catch {
    return emptyState();
  }
}

function loadSnapshots(): Snapshots {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Snapshots;
  } catch {
    return {};
  }
}

export default function App() {
  const [state, setState] = useState<WizardState>(() => loadDraft());
  const [snapshots, setSnapshots] = useState<Snapshots>(() => loadSnapshots());
  const [index, setIndex] = useState(0);
  const [showBrief, setShowBrief] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState<ModelPrefs>(() => loadPrefs());
  const [toast, setToast] = useState<string | null>(null);
  /** 拦截提示必须绑定到具体步骤，否则换页后会显示上一页的原因（误导用户） */
  const [block, setBlock] = useState<{ step: StepId; msg: string } | null>(null);

  const step = STEP_ORDER[index];

  // 草稿落盘：刷新不丢
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch {
      // 隐私模式下写不进去，不影响使用
    }
  }, [state]);

  useEffect(() => {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snapshots));
    } catch {
      // 同上
    }
  }, [snapshots]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // 调试钩子：只在 URL 带 ?debug=1 时暴露失效判定的中间值，便于自动化验收与排查。
  // 默认不挂载，公开页面上不会存在这个全局对象。只读，不改变任何行为。
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    const staleFlags: Record<string, boolean> = {};
    for (const s of STEP_ORDER) {
      const saved = snapshots[s];
      staleFlags[s] = saved !== undefined && saved !== JSON.stringify(upstreamOf(s, state));
    }
    (window as unknown as Record<string, unknown>).__wizardDebug = {
      upstream: Object.fromEntries(STEP_ORDER.map((s) => [s, JSON.stringify(upstreamOf(s, state))])),
      snapshots,
      index,
      staleFlags,
    };
  }, [state, snapshots, index]);

  const isStaleAt = useCallback(
    (target: StepId): boolean => {
      // 判据是「这一步有没有被确认过的快照」：
      // 没有快照 = 用户没走到过这一步，不报待确认（避免刚起步就满屏警告）；
      // 有快照 = 用户确实基于当时的上游做过选择，一旦上游变了就必须提醒。
      // 刻意不用「本次会话走到哪」，否则刷新后会把已确认的下游静默当成有效答案。
      const saved = snapshots[target];
      if (saved === undefined) return false;
      return saved !== JSON.stringify(upstreamOf(target, state));
    },
    [snapshots, state],
  );
  const downstreamStale = useMemo(
    () => STEP_ORDER.filter((s) => STEP_ORDER.indexOf(s) > index && isStaleAt(s)),
    [index, isStaleAt],
  );

  /** 把这一步依赖的上游记为「已确认」，清掉待确认标记 */
  function confirmStep(target: StepId) {
    setSnapshots((prev) => ({ ...prev, [target]: JSON.stringify(upstreamOf(target, state)) }));
  }

  function setPart<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
    setBlock(null);
  }

  function goTo(next: number) {
    setBlock(null);
    const clamped = Math.max(0, Math.min(STEP_ORDER.length - 1, next));
    setIndex(clamped);
    setShowBrief(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleNext() {
    if (index === STEP_ORDER.length - 1) {
      setShowBrief(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const reason = blockReason(step, state);
    if (reason) {
      setBlock({ step, msg: reason });
      return;
    }
    confirmStep(step);
    goTo(index + 1);
  }

  function handlePrev() {
    if (showBrief) {
      setShowBrief(false);
      setIndex(STEP_ORDER.length - 1);
      return;
    }
    goTo(index - 1);
  }

  /**
   * 把导入的 JSON 变成当前草稿。
   * 快照按「已随这份 JSON 一起被确认」重建：导入的每一步本身就是用户当时确认过的结果，
   * 若清空快照，用户一进来就会看到满屏「待确认」，反而分不清哪一步真需要改。
   * 未导入的步骤保持没有快照，这样走到那里时按正常流程填写即可。
   */
  function importState(next: WizardState) {
    setState(next);
    setBlock(null);
    setShowBrief(false);
    const rebuilt: Snapshots = {};
    for (const s of STEP_ORDER) {
      if (next[s] !== null) rebuilt[s] = JSON.stringify(upstreamOf(s, next));
    }
    setSnapshots(rebuilt);
    const doneCount = STEP_ORDER.filter((s) => isStepDone(s, next)).length;
    setIndex(Math.max(0, Math.min(STEP_ORDER.length - 1, doneCount)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function restart() {    setState(emptyState());
    setSnapshots({});
    setIndex(0);
    setShowBrief(false);
    setBlock(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(SNAP_KEY);
    } catch {
      // 忽略
    }
    setToast('已清空草稿，可以重新开始');
  }

  const audienceLabel = state.audience?.label ?? '读者';
  const ctx: GenContext = {
    topic: state.topic,
    subject: state.subject,
    audienceLabel,
  };

  const completedCount = STEP_ORDER.filter((s) => isStepDone(s, state)).length;
  const currentStale = isStaleAt(step);
  const stepBlock = blockReason(step, state);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            内容创作向导
            <small>从一个大方向，收敛到对谁说什么</small>
          </div>
          <span className="progress">
            {showBrief ? '简报' : `${STEP_META[step].index}/6`} · 已完成 {completedCount}/6
          </span>
          <button type="button" className="linkbtn" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>

        <nav className="stepper" aria-label="步骤进度">
          {STEP_ORDER.map((s, i) => {
            const meta = STEP_META[s];
            // 不能跳过步骤：只能跳到「已经走到过」的位置，或前面的步骤都已填完的位置
            const reachable =
              i <= index || STEP_ORDER.slice(0, i).every((p) => isStepDone(p, state)) || isStepDone(s, state);
            const stale = isStaleAt(s);
            const classes = ['step-pill'];
            if (i === index && !showBrief) classes.push('current');
            if (isStepDone(s, state)) classes.push('done');
            if (stale) classes.push('stale');
            return (
              <button
                key={s}
                type="button"
                className={classes.join(' ')}
                disabled={!reachable}
                aria-current={i === index && !showBrief ? 'step' : undefined}
                title={stale ? `${meta.layer}：上游已改动，需重新确认` : meta.question}
                onClick={() => {
                  if (!isStepDone(s, state)) {
                    const why = blockReason(s, state);
                    if (why) setBlock({ step: s, msg: why });
                  }
                  goTo(i);
                }}
              >
                <span className="num">{isStepDone(s, state) && !stale ? '✓' : meta.index}</span>
                {meta.layer}
                {stale && <span className="stale-mark">待确认</span>}
              </button>
            );
          })}
        </nav>
      </header>

      <main>
        {showBrief ? (
          <BriefView
            state={state}
            onBack={() => goTo(STEP_ORDER.length - 1)}
            onRestart={restart}
            onToast={setToast}
            onImport={importState}
          />
        ) : (
          <>
            {currentStale && (
              <div className="stale-banner">
                <span className="grow">
                  <strong>待确认：</strong>你改动了上游的答案，这一步的旧选择可能已经不成立了。看完上面的当前内容，确认或重选后再继续。
                </span>
                <button type="button" className="btn small" onClick={() => confirmStep(step)}>
                  沿用当前答案，继续
                </button>
              </div>
            )}

            {step === 'audience' && (
              <AudienceStep value={state.audience} onChange={(v) => setPart('audience', v)} />
            )}
            {step === 'topic' && (
              <TopicStep value={state.topic} prefs={prefs} onChange={(v) => setPart('topic', v)} />
            )}
            {step === 'subject' && (
              <SubjectStep value={state.subject} topic={state.topic} onChange={(v) => setPart('subject', v)} />
            )}
            {step === 'angle' && (
              <AngleStep value={state.angle} ctx={ctx} prefs={prefs} onChange={(v) => setPart('angle', v)} />
            )}
            {step === 'title' && (
              <TitleStep value={state.title} ctx={ctx} prefs={prefs} onChange={(v) => setPart('title', v)} />
            )}
            {step === 'expression' && (
              <ExpressionStep value={state.expression} onChange={(v) => setPart('expression', v)} />
            )}

            {block && block.step === step && <div className="notice error">{block.msg}</div>}

            {(!block || block.step !== step) && downstreamStale.length > 0 && (
              <div className="notice info">
                接下来这几步已经标记为「待确认」，因为上游变了：
                {downstreamStale.map((s) => STEP_META[s].layer).join('、')}。
              </div>
            )}

            {(!block || block.step !== step) && stepBlock && (
              <div className="notice info">提示：{stepBlock}</div>
            )}

            <div className="actions">
              <button type="button" className="btn primary" onClick={handleNext} disabled={!!stepBlock}>
                {index === STEP_ORDER.length - 1 ? '生成创作简报' : '下一步'}
              </button>
              {index > 0 && (
                <button type="button" className="btn" onClick={handlePrev}>
                  上一步
                </button>
              )}
              {index === STEP_ORDER.length - 1 && completedCount >= 2 && (
                <button type="button" className="btn ghost" onClick={() => setShowBrief(true)}>
                  直接看简报（未完成的部分会标出）
                </button>
              )}
            </div>
          </>
        )}
      </main>

      {settingsOpen && (
        <SettingsModal
          prefs={prefs}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            setPrefs(next);
            savePrefs(next);
            setSettingsOpen(false);
            setToast('设置已保存到本机');
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function SettingsModal({
  prefs,
  onClose,
  onSave,
}: {
  prefs: ModelPrefs;
  onClose: () => void;
  onSave: (p: ModelPrefs) => void;
}) {
  const [draft, setDraft] = useState<ModelPrefs>(prefs);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="设置" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <p className="lede">
          模型是可选项：不填也能完整走完六步，所有候选来自内置预设库。填写后，子话题 / 切入点 / 标题会改由你配置的模型生成，调用失败自动回退。
        </p>

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="prefs-base">API Base URL</label>
          <input
            id="prefs-base"
            type="text"
            value={draft.baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="prefs-model">模型名</label>
          <input
            id="prefs-model"
            type="text"
            value={draft.model}
            placeholder="gpt-4o-mini"
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="prefs-key">API Key</label>
          <input
            id="prefs-key"
            type="text"
            value={draft.apiKey}
            placeholder="留空 = 只用内置预设库"
            autoComplete="off"
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />
          <p className="helper">
            只存在这台设备的 localStorage，不会上传到任何第三方；请求由浏览器直接发往你填写的 Base URL。
          </p>
        </div>

        <div className="actions">
          <button type="button" className="btn primary" onClick={() => onSave(draft)}>
            保存
          </button>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setDraft({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' })}
          >
            清空模型配置
          </button>
        </div>
      </div>
    </div>
  );
}
