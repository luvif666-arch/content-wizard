import { useState } from 'react';
import { WHO_PRESETS } from '../presets';
import type { SubjectAnswer, TopicAnswer } from '../types';

interface Props {
  value: SubjectAnswer | null;
  topic: TopicAnswer | null;
  onChange: (v: SubjectAnswer) => void;
}

/** 第 3 步：选题——这次对谁说、说什么。两部分必须都填。 */
export default function SubjectStep({ value, topic, onChange }: Props) {
  const [customWho, setCustomWho] = useState(value?.who.id === 'custom' ? value.who.label : '');
  const what = value?.what ?? '';
  const who = value?.who ?? null;

  function patch(next: Partial<SubjectAnswer>) {
    const merged: SubjectAnswer = {
      who: next.who ?? who ?? { id: '', label: '', hint: '' },
      what: next.what ?? what,
    };
    onChange(merged);
  }

  const missingWho = !who || !who.label;
  const missingWhat = !what.trim();

  return (
    <div>
      <div className="step-head">
        <div className="eyebrow">第 3 步 · 选题</div>
        <h1>这次你要对谁说什么？</h1>
        <p className="lede">这里面得有一个具体的人，也有一件具体的事。</p>
        {topic?.subs.length ? (
          <p className="quote">当前范围：{topic.subs.join('、')}（来自第 2 步）</p>
        ) : null}
      </div>

      <div className="field">
        <label>具体的人</label>
        <p className="helper">同一个话题，对着不同处境的人讲，讲法必然不同。</p>
        <div className="option-list">
          {WHO_PRESETS.map((p) => {
            const selected = who?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`option${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() =>
                  patch({
                    who: {
                      id: p.id,
                      label: p.id === 'custom' ? customWho.trim() || '（待填写）' : p.label,
                      hint: p.hint,
                    },
                  })
                }
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

      <div className="field">
        <label htmlFor="subject-what">具体的事</label>
        <p className="helper">写成一句“给【谁】，讲【怎么 / 为什么】”的话。</p>
        <textarea
          id="subject-what"
          value={what}
          placeholder="例：怎么让这次约会聊得舒服，让对方愿意继续了解你"
          onChange={(e) => patch({ what: e.target.value })}
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
    </div>
  );
}
