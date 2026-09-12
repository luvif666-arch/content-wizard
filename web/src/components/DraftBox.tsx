import { useState } from 'react';
import { draftProgress, formatEditedAt } from '../lib/drafts';
import type { Draft } from '../lib/drafts';

interface Props {
  drafts: Draft[];
  activeId: string;
  /** 窄屏时草稿箱是抽屉：true 才展开。宽屏下这个类名不起作用。 */
  open: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * 右侧草稿箱。
 * 设计要点：
 *  - 每一步都自动存进当前草稿，所以这一栏没有任何「保存」按钮；
 *  - 删除必须二次确认（删掉就找不回来了）；
 *  - 窄屏下折叠成抽屉，不挤占六步主流程。
 */
export default function DraftBox({
  drafts,
  activeId,
  open,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const now = Date.now();

  function startRename(d: Draft) {
    setConfirming(null);
    setRenaming(d.id);
    setTitleDraft(d.title);
  }

  function commitRename(id: string) {
    onRename(id, titleDraft);
    setRenaming(null);
  }

  return (
    <aside className={`draftbox${open ? ' open' : ''}`} aria-label="草稿箱">
      <div className="draftbox-head">
        <h2>
          草稿箱
          <span className="tag" style={{ marginLeft: 6 }}>
            {drafts.length}
          </span>
        </h2>
        <button type="button" className="linkbtn draftbox-close" onClick={onClose} aria-label="收起草稿箱">
          收起
        </button>
      </div>
      <p className="helper draftbox-hint">
        每写一步都会自动存进当前这份草稿，不用点保存。六步走完导出简报后，草稿也留在这里，删不删由你决定。
      </p>
      <button type="button" className="btn new draftbox-new" onClick={onCreate}>
        ＋ 新建草稿
      </button>

      <ul className="draft-list">
        {drafts.map((d) => {
          const isActive = d.id === activeId;
          const isRenaming = renaming === d.id;
          const isConfirming = confirming === d.id;
          return (
            <li key={d.id} className={`draft-card${isActive ? ' active' : ''}`} data-draft-id={d.id}>
              {isRenaming ? (
                <div className="draft-rename">
                  <label className="sr-only" htmlFor={`rename-${d.id}`}>
                    草稿名称
                  </label>
                  <input
                    id={`rename-${d.id}`}
                    type="text"
                    value={titleDraft}
                    autoFocus
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(d.id);
                      }
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                  <div className="draft-card-actions">
                    <button type="button" className="btn small accent" onClick={() => commitRename(d.id)}>
                      保存名称
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setRenaming(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="draft-open"
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => onOpen(d.id)}
                  >
                    <span className="draft-title">{d.title}</span>
                    <span className="draft-meta">
                      已完成 {draftProgress(d)} · 最后编辑 {formatEditedAt(d.updatedAt, now)}
                    </span>
                    {isActive && <span className="tag draft-current">当前打开</span>}
                  </button>

                  {isConfirming ? (
                    <div className="draft-confirm" role="alert">
                      <span className="draft-confirm-text">删除「{d.title}」？删了就找不回来了。</span>
                      <div className="draft-card-actions">
                        <button
                          type="button"
                          className="btn small danger"
                          onClick={() => {
                            setConfirming(null);
                            onDelete(d.id);
                          }}
                        >
                          确认删除
                        </button>
                        <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="draft-card-actions">
                      <button type="button" className="btn small" onClick={() => startRename(d)}>
                        重命名
                      </button>
                      <button type="button" className="btn small" onClick={() => setConfirming(d.id)}>
                        删除
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
