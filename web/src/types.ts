// 向导的领域模型。字段设计对应文章里的六层：关系 / 话题 / 选题 / 切入点 / 标题 / 表达。

/**
 * 候选内容的来源。放在领域模型里而不是适配层里：
 * 第 4 / 5 / 6 步的答案需要记住「这条选择是基于哪一批候选做的」，来源标签也要跟着走。
 * 界面必须如实区分，没有联网检索能力就不许标成联网。
 */
export type CandidateSource = 'preset' | 'template' | 'model' | 'search';

/** 第 1 步：这条内容给谁看 */
export interface AudienceAnswer {
  /** 预设选项 id；自定义时为 'custom' */
  id: string;
  /** 展示用文案（自定义时为用户输入） */
  label: string;
  /** 这个选择意味着什么样的语境 */
  implies: string;
}

/** 第 2 步：讨论范围 */
export interface TopicAnswer {
  /** 用户输入的大方向，如「情感」 */
  big: string;
  /** 选中的子话题，最多 2 个 */
  subs: string[];
  /**
   * 这批子话题候选是按哪个大方向生成的。
   * 大方向一改，候选就换了一批，原来选的子话题必须作废——否则会出现「新方向配着旧分支」。
   */
  basisKey?: string;
}

/** 第 3 步：选题——对谁说什么 */
export interface SubjectAnswer {
  /** 具体的人 */
  who: { id: string; label: string; hint: string };
  /** 具体的事 */
  what: string;
}

/** 第 4 步：切入点 */
export interface AngleOption {
  id: string;
  label: string;
  /** 结合当前选题生成的具体切入点文案 */
  text: string;
}

export interface AngleAnswer {
  /** 按用户排序排列的切入点 */
  selected: AngleOption[];
  /** 用户已确认「切入点确实通向选题目标」 */
  consistencyAcknowledged: boolean;
  /**
   * 这批候选是按什么上下文生成的。
   * 上游改了、或用户点了「换一批」，它就和当前上下文对不上——据此判定旧选择作废。
   * 老草稿没有这个字段，此时退化为「文案是否还在候选里」的比对。
   */
  basisKey?: string;
}

/** 第 5 步：标题 */
export interface TitleOption {
  id: string;
  /** 句式名：问题式 / 判断式 / 共鸣式 */
  kind: string;
  text: string;
  /** 这句标题在邀请谁进来、为什么他会想点开 */
  reason: string;
}

export interface TitleAnswer {
  selected: TitleOption | null;
  /** 同 AngleAnswer.basisKey：候选换了，基于旧候选选的标题就不能留 */
  basisKey?: string;
}

/** 第 6 步：表达 */
export interface ExpressionSection {
  id: string;
  label: string;
  /** 这一段在表达里负责什么 */
  role: string;
  /** 用户可补充这段要讲什么 */
  detail: string;
  /**
   * 用户采纳的「参考写法」。它不是成稿，只是这一段可以怎么写的参照。
   * 带 basisKey：候选一重生成，这条采纳就必须作废，否则会出现「新选题配旧写法」。
   */
  reference?: SectionReference | null;
  /** 「根据已定内容扩写这段」的结果，同样随候选作废 */
  expansion?: SectionExpansion | null;
}

/** 一条参考写法：结合第 3 步选题 / 第 4 步切入点 / 第 5 步标题推导出来的「这一段怎么写」 */
export interface SectionReference {
  id: string;
  /** 入手角度，如「从读者的处境开始」 */
  approach: string;
  text: string;
  source: CandidateSource;
  /** 生成依据；与当前依据不一致即作废 */
  basisKey: string;
}

/** 参考写法的展开：这一段打算讲什么 / 举什么例子 / 给什么建议 */
export interface SectionExpansion {
  /** 这一段打算讲什么 */
  plan: string;
  /** 举什么例子（例子要用户自己填，不给编） */
  example: string;
  /** 给什么建议 */
  advice: string;
  source: CandidateSource;
  basisKey: string;
}

export type OutputFormat = 'text' | 'video' | 'carousel';

export interface ExpressionAnswer {
  sections: ExpressionSection[];
  format: OutputFormat;
  /** 体裁追加的追问，key 为追问项 */
  followUps: Record<string, string>;
}

/** 完整的向导状态 */
export interface WizardState {
  audience: AudienceAnswer | null;
  topic: TopicAnswer | null;
  subject: SubjectAnswer | null;
  angle: AngleAnswer | null;
  title: TitleAnswer | null;
  expression: ExpressionAnswer | null;
}

export type StepId = 'audience' | 'topic' | 'subject' | 'angle' | 'title' | 'expression';

export const STEP_ORDER: StepId[] = ['audience', 'topic', 'subject', 'angle', 'title', 'expression'];

export const STEP_META: Record<StepId, { index: number; layer: string; question: string }> = {
  audience: { index: 1, layer: '关系', question: '这条内容是给谁看的？' },
  topic: { index: 2, layer: '话题', question: '你想聊哪个大方向？' },
  subject: { index: 3, layer: '选题', question: '这次你要对谁说什么？' },
  angle: { index: 4, layer: '切入点', question: '这次从哪里开始聊？' },
  title: { index: 5, layer: '标题', question: '用哪句话开启这段对话？' },
  expression: { index: 6, layer: '表达', question: '你准备用什么让对方理解你的判断？' },
};

export const OUTPUT_FORMAT_LABEL: Record<OutputFormat, string> = {
  text: '图文',
  video: '口播视频',
  carousel: '多图轮播',
};

export function emptyState(): WizardState {
  return {
    audience: null,
    topic: null,
    subject: null,
    angle: null,
    title: null,
    expression: null,
  };
}

/** 这一步是否已经填完（用于「已完成几步」与「能否进入下一步」） */
export function isStepDone(step: StepId, s: WizardState): boolean {
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

/** 走完了几步（0–6） */
export function doneCount(s: WizardState): number {
  return STEP_ORDER.filter((step) => isStepDone(step, s)).length;
}
