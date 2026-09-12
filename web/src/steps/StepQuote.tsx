import { STEP_ARTICLE_QUOTE } from '../types';
import type { StepId } from '../types';

interface Props {
  step: StepId;
}

/**
 * 步骤做完之后才出现的原文摘录。
 *
 * 为什么放在最后：这一步在解释「刚才那个问题在解决什么」，
 * 属于回看用的理论。放在选择之前会干扰判断——用户会先琢磨定义，而不是先回答自己真实的想法。
 */
export default function StepQuote({ step }: Props) {
  return (
    <div className="quote reveal">
      <span className="quote-tag">原文</span>
      {STEP_ARTICLE_QUOTE[step]}
    </div>
  );
}
