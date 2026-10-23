import { useState } from 'react';
import type { AppState } from '../shared/types.ts';

export function SessionDrawer({
  state,
  close,
  create,
  open,
  rename,
  remove,
  disabled,
}: {
  state: AppState;
  disabled: boolean;
  close(): void;
  create(): void;
  open(id: string): void;
  rename(id: string, title: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}) {
  const [action, setAction] = useState<{ id: string; type: 'rename' | 'delete' } | null>(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <>
      <button className="drawer-dim" aria-label="セッション一覧を閉じる" onClick={close} />
      <aside className="session-drawer" aria-label="セッション一覧">
        <div className="drawer-head">
          <div>
            <small>CONVERSATIONS</small>
            <h2>SESSION</h2>
          </div>
          <button onClick={close} aria-label="閉じる">
            ×
          </button>
        </div>
        <button className="new-session" onClick={create} disabled={disabled || pending}>
          ＋ NEW SESSION
        </button>
        <div className="session-list">
          {!state.sessions.length && (
            <p className="hint">最初のメッセージを送ると、会話がここに保存されます。</p>
          )}
          {state.sessions.map((session) => {
            const image = session.character.expressions.find(
              (item) => item.id === session.character.defaultExpression,
            )?.image;
            return (
              <div
                className={`session-row ${session.id === state.currentId ? 'selected' : ''}`}
                key={session.id}
              >
                <button
                  className="session-item"
                  onClick={() => open(session.id)}
                  disabled={disabled || pending}
                >
                  <span className="mini-avatar">
                    {image ? <img src={image} alt="" /> : session.character.name.slice(0, 1)}
                  </span>
                  <span>
                    <b>{session.title}</b>
                    <small>
                      {new Date(session.updatedAt).toLocaleString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </span>
                </button>
                <button
                  className="session-menu"
                  aria-label={`${session.title}の名前変更と削除`}
                  disabled={pending}
                  onClick={() => {
                    setTitle(session.title);
                    setAction(
                      action?.id === session.id ? null : { id: session.id, type: 'rename' },
                    );
                  }}
                >
                  ⋯
                </button>
                {action?.id === session.id && (
                  <div className="session-actions">
                    {action.type === 'rename' ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          setPending(true);
                          void rename(session.id, title)
                            .then((ok) => {
                              if (ok) setAction(null);
                            })
                            .finally(() => setPending(false));
                        }}
                      >
                        <input
                          aria-label="セッション名"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          maxLength={120}
                          required
                          autoFocus
                        />
                        <div>
                          <button disabled={pending}>名前を保存</button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setAction({ id: session.id, type: 'delete' })}
                          >
                            削除…
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <p>この会話を削除しますか？</p>
                        <button
                          disabled={pending}
                          onClick={() => {
                            setPending(true);
                            void remove(session.id)
                              .then((ok) => {
                                if (ok) setAction(null);
                              })
                              .finally(() => setPending(false));
                          }}
                        >
                          削除する
                        </button>
                        <button disabled={pending} onClick={() => setAction(null)}>
                          戻る
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
