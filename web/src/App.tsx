import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AudienceStep from './steps/AudienceStep';
import TopicStep from './steps/TopicStep';
import SubjectStep from './steps/SubjectStep';
import AngleStep from './steps/AngleStep';
import TitleStep from './steps/TitleStep';
import ExpressionStep from './steps/ExpressionStep';
import BriefView from './steps/BriefView';
import DraftBox from './components/DraftBox';
import { loadPrefs, savePrefs } from './lib/model';
import type { GenContext, ModelPrefs } from './lib/model';
import { autoTitleOf, createDraft, loadStore, saveStore, withEdit } from './lib/drafts';
import type { Draft, DraftStore, Snapshots } from './lib/drafts';
import { readSharedState } from './lib/share';
import { STEP_META, STEP_ORDER, doneCount, isStepDone } from './types';
import type { StepId, WizardState } from './types';

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

/** 首屏启动：分享链接进来的人先拿到一份「别人给的草稿」，自己的草稿一份不动 */
function bootStore(): DraftStore {
  const base = loadStore();
  const shared = readSharedState();
  if (!shared) return base;
  const incoming = createDraft(shared);
  // 只是为了给分享链接兜底而自动建出来的空草稿，没必要挤在列表里
  const mine = base.drafts.filter((d) => doneCount(d.state) > 0);
  return { version: 1, activeId: incoming.id, drafts: [incoming, ...mine] };
}

export default function App() {
  const [store, setStore] = useState<DraftStore>(() => bootStore());
  const [index, setIndex] = useState(0);
  const [showBrief, setShowBrief] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [prefs, setPrefs] = useState<ModelPrefs>(() => loadPrefs());
  const [toast, setToast] = useState<string | null>(null);
  /** 拦截提示必须绑定到具体步骤，否则换页后会显示上一页的原因（误导用户） */
  const [block, setBlock] = useState<{ step: StepId; msg: string } | null>(null);
  /**
   * 「候选重新生成 ⇒ 旧选择作废」的说明。
   * 与「待确认」是两件不同的事：待确认保留用户的答案让他决定要不要沿用；
   * 这里选项本身换了，答案已经清空，必须把原因摆出来，不能静默。
   */
  const [resetNotice, setResetNotice] = useState<{ step: StepId; msg: string } | null>(null);

  const active: Draft = store.drafts.find((d) => d.id === store.activeId) ?? store.drafts[0];
  const state = active.state;
  const snapshots = active.snapshots;
  const step = STEP_ORDER[index];

  // 分享链接消费一次就把 hash 擦掉，免得刷新时又落一份新草稿
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (window.location.hash.includes('s=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  // 草稿箱落盘：每一步的改动都会自动写进当前草稿，刷新不丢
  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /** 只改当前草稿，其余草稿一个字节都不碰——这是「两份互不干扰」的落点 */
  const updateActive = useCallback((fn: (d: Draft) => Draft) => {
    setStore((prev) => {
      const idx = prev.drafts.findIndex((d) => d.id === prev.activeId);
      if (idx < 0) return prev;
      const next = fn(prev.drafts[idx]);
      if (next === prev.drafts[idx]) return prev;
      const drafts = [...prev.drafts];
      drafts[idx] = next;
      return { ...prev, drafts };
    });
  }, []);

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
      step,
      resetNotice,
      activeDraftId: active.id,
      drafts: store.drafts.map((d) => ({
        id: d.id,
        title: d.title,
        autoTitle: d.autoTitle,
        done: doneCount(d.state),
        updatedAt: d.updatedAt,
        active: d.id === active.id,
      })),
    };
  }, [state, snapshots, index, step, resetNotice, active.id, store.drafts]);

  const isStaleAt = useCallback(
    (target: StepId): boolean => {
      // 判据是「这一步有没有被确认过的快照」：
      // 没有快照 = 用户没走到过这一步，不报待确认（避免刚起步就满屏警告）；
      // 有快照 = 用户确实基于当时的上游做过选择，一旦上游变了就必须提醒。
      // 刻意不用「本次会话走到哪」，否则刷新后会把已确认的下游静默当成有效答案。
      const saved = snapshots[target];
      if (saved === undefined) return false;
      // 答案已经被清空的步骤没有「要不要沿用」的问题：没答案就不用待确认，
      // 否则会和「已清空，请重新选」的说明叠在一起，让用户以为答案还在。
      if (!isStepDone(target, state)) return false;
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
    updateActive((d) => ({
      ...d,
      snapshots: { ...d.snapshots, [target]: JSON.stringify(upstreamOf(target, d.state)) },
    }));
  }

  /**
   * 候选重新生成、旧选择作废：清空这一步的答案，同时撤掉它的「已确认」快照。
   * 快照必须一起撤：答案已经没了，再标「待确认」会把用户引到一个空的当前答案上。
   */
  function invalidateStep(target: StepId, reason: string) {
    updateActive((d) => {
      const next: Snapshots = { ...d.snapshots };
      delete next[target];
      return withEdit(d, { ...d.state, [target]: null }, next);
    });
    setBlock(null);
    setResetNotice({ step: target, msg: reason });
  }

  function setPart<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    updateActive((d) => withEdit(d, { ...d.state, [key]: value }, d.snapshots));
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

  /** 换草稿时界面必须一起回到一致的位置，不能停在上一份的简报或提示上 */
  function resetViewFor(draft: Draft) {
    const done = doneCount(draft.state);
    setIndex(Math.max(0, Math.min(STEP_ORDER.length - 1, done)));
    setShowBrief(false);
    setBlock(null);
    setResetNotice(null);
  }

  /**
   * 新建草稿：当前这份原样留在草稿箱里。
   * 用户原来卡在这里——没做完想换个话题，却没有办法把手上的半成品存下来。
   */
  function newDraft() {
    const fresh = createDraft();
    setStore((prev) => ({ version: 1, activeId: fresh.id, drafts: [fresh, ...prev.drafts] }));
    setIndex(0);
    setShowBrief(false);
    setBlock(null);
    setResetNotice(null);
    setDraftOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setToast('已新建一份草稿，刚才那份留在草稿箱里');
  }

  function openDraft(id: string) {
    const target = store.drafts.find((d) => d.id === id);
    if (!target) return;
    setStore((prev) => ({ ...prev, activeId: id }));
    resetViewFor(target);
    setDraftOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renameDraft(id: string, title: string) {
    const clean = title.trim();
    setStore((prev) => ({
      ...prev,
      drafts: prev.drafts.map((d) =>
        d.id === id
          ? clean
            ? { ...d, title: clean, autoTitle: false, updatedAt: Date.now() }
            : { ...d, title: autoTitleOf(d.state), autoTitle: true, updatedAt: Date.now() }
          : d,
      ),
    }));
    setToast(clean ? '已重命名（之后不再自动改名）' : '名称已留空，改回自动标题');
  }

  function deleteDraft(id: string) {
    const wasActive = store.activeId === id;
    const remaining = store.drafts.filter((d) => d.id !== id);
    const drafts = remaining.length ? remaining : [createDraft()];
    const activeId = wasActive ? drafts[0].id : store.activeId;
    setStore({ version: 1, activeId, drafts });
    if (wasActive) resetViewFor(drafts[0]);
    setToast('已删除这份草稿');
  }

  /**
   * 把导入的 JSON 变成当前草稿。
   * 快照按「已随这份 JSON 一起被确认」重建：导入的每一步本身就是用户当时确认过的结果，
   * 若清空快照，用户一进来就会看到满屏「待确认」，反而分不清哪一步真需要改。
   * 未导入的步骤保持没有快照，这样走到那里时按正常流程填写即可。
   */
  function importState(next: WizardState) {
    updateActive((d) => withEdit(d, next, {}));
    const rebuilt: Snapshots = {};
    for (const s of STEP_ORDER) {
      if (next[s] !== null) rebuilt[s] = JSON.stringify(upstreamOf(s, next));
    }
    updateActive((d) => ({ ...d, snapshots: rebuilt }));
    setBlock(null);
    setShowBrief(false);
    setResetNotice(null);
    const done = doneCount(next);
    setIndex(Math.max(0, Math.min(STEP_ORDER.length - 1, done)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const audienceLabel = state.audience?.label ?? '读者';
  const ctx: GenContext = {
    topic: state.topic,
    subject: state.subject,
    audienceLabel,
  };

  const completedCount = doneCount(state);
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
          <button type="button" className="btn small new topbar-new" onClick={newDraft}>
            ＋ 新建草稿
          </button>
          <button
            type="button"
            className="linkbtn draft-toggle"
            aria-expanded={draftOpen}
            aria-controls="draftbox"
            onClick={() => setDraftOpen((o) => !o)}
          >
            草稿箱 {store.drafts.length}
          </button>
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

      <div className="workspace">
        <main>
          {showBrief ? (
            <BriefView
              key={active.id}
              state={state}
              onBack={() => goTo(STEP_ORDER.length - 1)}
              onNewDraft={newDraft}
              onToast={setToast}
              onImport={importState}
            />
          ) : (
            /* key 绑定当前草稿：切草稿时整棵子树重挂载，步骤组件里的临时状态不会串到另一份草稿上 */
            <div className="wizard-col" key={active.id}>
              {resetNotice && resetNotice.step === step && (
                <div className="notice warn reset-banner" role="status">
                  <span className="grow">{resetNotice.msg}</span>
                  <button type="button" className="btn small" onClick={() => setResetNotice(null)}>
                    知道了
                  </button>
                </div>
              )}

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
                <TopicStep
                  value={state.topic}
                  prefs={prefs}
                  onChange={(v) => setPart('topic', v)}
                  onNotice={(reason) => setResetNotice({ step: 'topic', msg: reason })}
                />
              )}
              {step === 'subject' && (
                <SubjectStep
                  value={state.subject}
                  topic={state.topic}
                  prefs={prefs}
                  onChange={(v) => setPart('subject', v)}
                />
              )}
              {step === 'angle' && (
                <AngleStep
                  value={state.angle}
                  ctx={ctx}
                  prefs={prefs}
                  onChange={(v) => setPart('angle', v)}
                  onInvalidate={(reason) => invalidateStep('angle', reason)}
                />
              )}
              {step === 'title' && (
                <TitleStep
                  value={state.title}
                  ctx={ctx}
                  prefs={prefs}
                  onChange={(v) => setPart('title', v)}
                  onInvalidate={(reason) => invalidateStep('title', reason)}
                />
              )}
              {step === 'expression' && (
                <ExpressionStep
                  value={state.expression}
                  ctx={ctx}
                  angles={state.angle?.selected ?? []}
                  title={state.title?.selected ?? null}
                  prefs={prefs}
                  onChange={(v) => setPart('expression', v)}
                  onNotice={(reason) => setResetNotice({ step: 'expression', msg: reason })}
                />
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
            </div>
          )}
        </main>

        <DraftBox
          drafts={store.drafts}
          activeId={active.id}
          open={draftOpen}
          onOpen={openDraft}
          onCreate={newDraft}
          onRename={renameDraft}
          onDelete={deleteDraft}
          onClose={() => setDraftOpen(false)}
        />
      </div>

      {draftOpen && <div className="drawer-backdrop" onClick={() => setDraftOpen(false)} aria-hidden="true" />}

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
          模型是可选项：不填也能完整走完六步，所有候选来自内置预设库。填写后，子话题 / 切入点 / 标题 / 第 6 步的参考写法会改由你配置的模型生成，调用失败自动回退。
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
