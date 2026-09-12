// 草稿箱的持久化层。
//
// 存储模型：一份 key 下存「多份草稿 + 当前打开的是哪一份」。
// 旧版本只有一份草稿（content-wizard.draft.v1 / content-wizard.snapshots.v1），
// 首次读取时把它迁移成草稿箱里的第一份，用户的半成品不会因为升级而丢。

import { STEP_ORDER, doneCount, emptyState } from '../types';
import type { ExpressionSection, StepId, WizardState } from '../types';

/** 每一步「已确认」时上游的模样。上游一变，这一步就标待确认。 */
export type Snapshots = Partial<Record<StepId, string>>;

export interface Draft {
  id: string;
  /** 展示用标题。autoTitle 为 true 时，随「大方向 + 子话题」自动更新 */
  title: string;
  /** 是否仍跟随自动标题；用户重命名后置 false，不再被自动覆盖 */
  autoTitle: boolean;
  createdAt: number;
  updatedAt: number;
  state: WizardState;
  snapshots: Snapshots;
}

export interface DraftStore {
  version: 1;
  /** 当前打开的草稿 id */
  activeId: string;
  drafts: Draft[];
}

const STORE_KEY = 'content-wizard.drafts.v1';
const LEGACY_DRAFT_KEY = 'content-wizard.draft.v1';
const LEGACY_SNAP_KEY = 'content-wizard.snapshots.v1';

export function newId(prefix = 'd'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 自动标题 = 大方向 + 子话题。
 * 话题都没填时用「未命名草稿」，让草稿箱里不会出现空标题的条目。
 */
export function autoTitleOf(state: WizardState): string {
  const big = state.topic?.big.trim() ?? '';
  const subs = (state.topic?.subs ?? []).map((s) => s.trim()).filter(Boolean);
  if (big && subs.length) return `${big} · ${subs.join(' / ')}`;
  if (big) return big;
  return '未命名草稿';
}

/** 「已完成几步」，用于草稿箱上的 3/6 进度 */
export function draftProgress(draft: Draft): string {
  return `${doneCount(draft.state)}/${STEP_ORDER.length}`;
}

/** 按当前状态刷新标题（仅在 autoTitle 时生效） */
export function retitleDraft(draft: Draft, state: WizardState): Draft {
  return draft.autoTitle ? { ...draft, title: autoTitleOf(state) } : draft;
}

export function createDraft(state?: WizardState, snapshots?: Snapshots): Draft {
  const s = state ?? emptyState();
  const now = Date.now();
  return {
    id: newId(),
    title: autoTitleOf(s),
    autoTitle: true,
    createdAt: now,
    updatedAt: now,
    state: s,
    snapshots: snapshots ?? {},
  };
}

/** 把任意来源（localStorage / 导入）的状态补齐成完整的 WizardState，缺字段不报错 */
export function normalizeState(raw: unknown): WizardState {
  const base = emptyState();
  if (typeof raw !== 'object' || raw === null) return base;
  const r = raw as Partial<WizardState>;
  const state: WizardState = {
    audience: r.audience ?? base.audience,
    topic: r.topic ?? base.topic,
    subject: r.subject ?? base.subject,
    angle: r.angle ?? base.angle,
    title: r.title ?? base.title,
    expression: r.expression ?? base.expression,
  };
  if (state.expression) {
    const sections: ExpressionSection[] = (state.expression.sections ?? []).map((s, i) => ({
      id: typeof s.id === 'string' && s.id ? s.id : `section-${i}`,
      label: typeof s.label === 'string' ? s.label : `第 ${i + 1} 段`,
      role: typeof s.role === 'string' ? s.role : '',
      detail: typeof s.detail === 'string' ? s.detail : '',
      reference: s.reference ?? null,
      expansion: s.expansion ?? null,
    }));
    state.expression = {
      sections,
      format: state.expression.format ?? 'text',
      followUps: state.expression.followUps ?? {},
    };
  }
  return state;
}

function normalizeSnapshots(raw: unknown): Snapshots {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Snapshots = {};
  for (const step of STEP_ORDER) {
    const v = (raw as Record<string, unknown>)[step];
    if (typeof v === 'string') out[step] = v;
  }
  return out;
}

function normalizeDraft(raw: unknown): Draft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<Draft>;
  if (typeof r.id !== 'string' || !r.id) return null;
  const state = normalizeState(r.state);
  const now = Date.now();
  return {
    id: r.id,
    title: typeof r.title === 'string' && r.title.trim() ? r.title : autoTitleOf(state),
    autoTitle: r.autoTitle !== false,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    state,
    snapshots: normalizeSnapshots(r.snapshots),
  };
}

/** 首次使用时的迁移：把旧版单份草稿读成草稿箱里的第一份 */
function migrateLegacy(): Draft | null {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
    const snapRaw = localStorage.getItem(LEGACY_SNAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    // 旧版把「一次都没填过」的空草稿也写进了 localStorage，这种情况不迁移，直接给一份干净的
    const state = normalizeState(parsed);
    const hasAny = STEP_ORDER.some((s) => state[s] !== null);
    if (!hasAny) return null;
    let snapshots: Snapshots = {};
    if (snapRaw) {
      try {
        snapshots = normalizeSnapshots(JSON.parse(snapRaw));
      } catch {
        snapshots = {};
      }
    }
    return { ...createDraft(state, snapshots), id: newId('legacy') };
  } catch {
    return null;
  }
}

export function loadStore(): DraftStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DraftStore>;
      const drafts = Array.isArray(parsed.drafts)
        ? parsed.drafts.map(normalizeDraft).filter((d): d is Draft => d !== null)
        : [];
      if (drafts.length) {
        const activeId = drafts.some((d) => d.id === parsed.activeId) ? (parsed.activeId as string) : drafts[0].id;
        return { version: 1, activeId, drafts };
      }
    }
  } catch {
    // 存储损坏或隐私模式：落到下面的全新草稿，不让用户卡在白屏
  }

  const migrated = migrateLegacy();
  const first = migrated ?? createDraft();
  return { version: 1, activeId: first.id, drafts: [first] };
}

export function saveStore(store: DraftStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // localStorage 不可用（隐私模式）时静默降级：本次会话仍然可用，只是不落盘
  }
}

/** 把当前编辑内容写回草稿（自动保存，不需要用户点保存） */
export function withEdit(draft: Draft, state: WizardState, snapshots: Snapshots): Draft {
  return retitleDraft({ ...draft, state, snapshots, updatedAt: Date.now() }, state);
}

/** 「最后编辑时间」的相对说法。超过一天就给日期，避免「3 天前」这种模糊表述 */
export function formatEditedAt(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = `${sameYear ? '' : `${d.getFullYear()}-`}${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
