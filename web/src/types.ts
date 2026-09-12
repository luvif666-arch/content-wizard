// 向导的领域模型。字段设计对应文章里的六层：关系 / 话题 / 选题 / 切入点 / 标题 / 表达。

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
}

/** 第 6 步：表达 */
export interface ExpressionSection {
  id: string;
  label: string;
  /** 这一段在表达里负责什么 */
  role: string;
  /** 用户可补充这段要讲什么 */
  detail: string;
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

/**
 * 每一步对应的原文摘录，取自 docs/flow.json 的 articleMapping。
 * 用途：告诉用户这一步在解决什么。刻意在「用户做完这一步之后」才出现，
 * 避免在选择之前用理论干扰判断。
 */
export const STEP_ARTICLE_QUOTE: Record<StepId, string> = {
  audience: '你跟一个刚认识的人吃饭，会先抿一下你们大概能打成什么关系。',
  topic: '话题给了我们一个讨论的方向……但如果你说"我今天想做一条情感内容"，我还是不知道你准备讲什么。',
  subject: '这里面得有一个具体的人，也有一件具体的事。',
  angle: '同一个选题，换一个切入点，需要准备的例子、信息和表达顺序都会跟着变。',
  title: '标题最重要的地方，是让对的人愿意进入这段对话。',
  expression: '知道对方现在理解到哪里，然后把下一步接给他。',
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
