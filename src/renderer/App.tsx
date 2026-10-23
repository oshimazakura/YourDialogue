import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../shared/types.ts';
import { defaultCharacter } from '../shared/character.ts';
import { CharactersPanel } from './CharactersPanel.tsx';
import { CharacterScene } from './CharacterScene.tsx';
import { Dialogue } from './Dialogue.tsx';
import { conversationView } from './conversation-view.ts';
import { Configuration, Backlog, type ConfigCategory } from './Panels.tsx';
import { SessionDrawer } from './SessionDrawer.tsx';
import { PhoneView } from './PhoneView.tsx';

type Panel = 'phone' | 'backlog' | null;
type Screen = 'vn' | 'config' | 'character';

function Modal({
  title,
  children,
  close,
}: {
  title: 'PHONE' | 'BACKLOG';
  children: ReactNode;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`overlay-panel panel-${title.toLowerCase()}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
    >
      <div className="overlay-inner">
        {title === 'PHONE' && (
          <div className="phone-status">
            {new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            <span>● ● ▰</span>
          </div>
        )}
        <header className="panel-header">
          <div>
            {title === 'BACKLOG' && <small>CONVERSATION HISTORY</small>}
            <h2>{title}</h2>
          </div>
          <button onClick={close} aria-label="閉じる">
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
function SystemScreen({
  screen,
  navigate,
  children,
}: {
  screen: 'config' | 'character';
  navigate(screen: Screen): void;
  children: ReactNode;
}) {
  return (
    <section
      className="system-screen"
      aria-label={screen === 'config' ? '設定' : 'キャラクター管理'}
    >
      <aside className="system-sidebar">
        <div className="sys-brand">◉ YourDialogue</div>
        <nav>
          <button
            className={screen === 'config' ? 'selected' : ''}
            onClick={() => navigate('config')}
          >
            設定
          </button>
          <button
            className={screen === 'character' ? 'selected' : ''}
            onClick={() => navigate('character')}
          >
            キャラクター
          </button>
        </nav>
        <button className="return" onClick={() => navigate('vn')}>
          ← 会話に戻る
        </button>
      </aside>
      <div className="system-main">{children}</div>
    </section>
  );
}
export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('vn');
  const [category, setCategory] = useState<ConfigCategory>('ai');
  const [panel, setPanel] = useState<Panel>(null);
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const [expression, setExpression] = useState(defaultCharacter.defaultExpression);
  const [phoneRead, setPhoneRead] = useState(0);
  const [characterDirty, setCharacterDirty] = useState(false);
  const sendLock = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!window.dialogue) {
      setError('Electronアプリとして起動してください（npm run dev）。');
      return;
    }
    let live = true;
    const unsubscribe = window.dialogue.onState((next) => {
      if (live) setState(next);
    });
    void window.dialogue
      .getState()
      .then((next) => {
        if (live) setState(next);
      })
      .catch((reason) => setError(String(reason)));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const session =
    state?.currentSession ?? state?.sessions.find((item) => item.id === state.currentId);
  const character = session?.character ?? state?.characters?.[0] ?? defaultCharacter;
  const {
    latestUser,
    latestAssistant: message,
    displayMessage,
    awaitingReply,
    replyReceived,
  } = conversationView(session?.messages ?? [], !!state?.busy);
  const persisted = !!session && !!state?.sessions.some((item) => item.id === session.id);
  const phoneItems =
    session?.messages.flatMap((item) =>
      item.segments
        .filter((segment) => segment.type === 'phone')
        .map((segment, index) => ({
          ...segment,
          id: `${item.id}-${index}`,
          createdAt: item.createdAt,
        })),
    ) ?? [];
  useEffect(() => {
    setPhoneRead(0);
    setDraft('');
  }, [session?.id]);
  useEffect(() => {
    if (panel === 'phone') setPhoneRead(phoneItems.length);
  }, [panel, phoneItems.length]);
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setError('');
    try {
      await operation();
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(reason),
      );
      return false;
    }
  }, []);
  const navigate = (next: Screen) => {
    if (next === screen) return;
    if (
      screen === 'character' &&
      characterDirty &&
      !window.confirm('保存していないキャラクター設定を破棄しますか？')
    )
      return;
    setCharacterDirty(false);
    setScreen(next);
    setPanel(null);
    setDrawer(false);
  };
  useEffect(() => {
    if (!state?.diagnosticsEnabled) return;
    const report = () => {
      void window.dialogue
        .reportUi({
          source: 'app',
          sessionId: session?.id ?? null,
          messageId: message?.id ?? null,
          panel: screen !== 'vn' ? screen : (panel ?? (drawer ? 'session' : null)),
          busy: state.busy,
          sending,
          error: error || null,
          phoneItems: phoneItems.length,
          sessionPersisted: persisted,
        })
        .catch(() => {});
    };
    report();
    const timer = window.setInterval(report, 3000);
    return () => window.clearInterval(timer);
  }, [
    state?.diagnosticsEnabled,
    state?.busy,
    session?.id,
    message?.id,
    screen,
    panel,
    drawer,
    sending,
    error,
    phoneItems.length,
    persisted,
  ]);
  useEffect(() => {
    if (!state?.diagnosticsEnabled) return;
    const failure = (event: ErrorEvent) => {
      void window.dialogue.reportUi({ source: 'app', error: event.message }).catch(() => {});
    };
    const rejection = (event: PromiseRejectionEvent) => {
      void window.dialogue.reportUi({ source: 'app', error: String(event.reason) }).catch(() => {});
    };
    window.addEventListener('error', failure);
    window.addEventListener('unhandledrejection', rejection);
    return () => {
      window.removeEventListener('error', failure);
      window.removeEventListener('unhandledrejection', rejection);
    };
  }, [state?.diagnosticsEnabled]);
  const copy = (text: string) => {
    void run(async () => {
      await window.dialogue.copyText(text);
      setNotice('コピーしました');
    });
  };
  const playSound = () => {
    if (!state?.settings.sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      const oscillator = audio.current.createOscillator();
      const gain = audio.current.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, audio.current.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(990, audio.current.currentTime + 0.08);
      gain.gain.setValueAtTime(0.05, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.current.currentTime + 0.16);
      oscillator.connect(gain);
      gain.connect(audio.current.destination);
      oscillator.start();
      oscillator.stop(audio.current.currentTime + 0.16);
    } catch {
      /* Sound must not block sending. */
    }
  };
  const submit = async () => {
    if (sendLock.current || state?.busy || !draft.trim() || !session) return;
    if (!state?.settings.model) {
      navigate('config');
      setCategory('ai');
      return;
    }
    sendLock.current = true;
    setSending(true);
    playSound();
    const text = draft;
    await new Promise((resolve) => setTimeout(resolve, 220));
    const ok = await run(() => window.dialogue.send(text));
    if (ok) setDraft('');
    sendLock.current = false;
    setSending(false);
    input.current?.focus();
  };
  const newSession = useCallback(() => {
    void run(async () => {
      await window.dialogue.createSession();
      setPanel(null);
      setDrawer(false);
      setScreen('vn');
      setNotice('新しい会話を始めます');
    });
  }, [run]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drawer) {
        setDrawer(false);
        event.preventDefault();
      }
      if (screen === 'vn' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (!sendLock.current) newSession();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [drawer, screen, newSession]);
  // Wait for the restored session before mounting the scene or dialogue.
  // Rendering the fallback character here would briefly show Alice at startup.
  if (!state) {
    return (
      <main className="app" aria-busy={!error}>
        {error ? (
          <div className="error-toast" role="alert">
            {error}
          </div>
        ) : (
          <div className="notice" role="status">
            読み込み中…
          </div>
        )}
      </main>
    );
  }
  return (
    <main className="app">
      <div
        className={`vn-layer${panel === 'backlog' ? ' backlog-open' : ''}`}
        hidden={screen !== 'vn'}
      >
        <CharacterScene character={character} expression={expression} />
        <header className="vn-top">
          <button onClick={() => navigate('config')} disabled={!state}>
            ⚙ CONFIG
          </button>
        </header>
        <div className="session-tab">
          <button
            onClick={() => setDrawer(true)}
            disabled={!state}
            aria-label="セッション一覧を開く"
          >
            ☰<span>SESSION</span>
          </button>
          <button
            className="quick-new"
            onClick={newSession}
            disabled={!state || sending}
            title="現在のキャラクターで新規セッション（⌘/Ctrl+N）"
            aria-label="新しいセッション"
          >
            ＋
          </button>
        </div>
        <div className="conversation-area">
          {latestUser && (
            <div
              key={latestUser.id}
              className={`submitted-message ${replyReceived ? 'has-reply' : ''}`}
              aria-label="直前に送信したメッセージ"
            >
              <header>
                <strong>YOU</strong>
                {awaitingReply && <span role="status">返答を待っています…</span>}
              </header>
              <p>{latestUser.text}</p>
            </div>
          )}
          <Dialogue
            diagnosticsEnabled={state?.diagnosticsEnabled}
            key={session?.id ?? 'welcome'}
            message={displayMessage}
            character={character}
            busy={!!state?.busy}
            speed={state?.settings.characterMs ?? 28}
            fontSize={state?.settings.fontSize ?? 21}
            onExpression={setExpression}
            onLog={() => setPanel('backlog')}
          />
          {message?.error && (
            <div className="response-warning" role="status">
              {message.error}
              <button
                disabled={state?.busy}
                onClick={() => void run(() => window.dialogue.retry())}
              >
                再試行
              </button>
            </div>
          )}
          {message?.status === 'interrupted' && (
            <div className="response-warning">
              回答は中断されました。受信済みの内容を保存しています。
              <button
                disabled={state?.busy}
                onClick={() => void run(() => window.dialogue.retry())}
              >
                再生成
              </button>
            </div>
          )}
        </div>
        <div className="world-tools">
          <button onClick={() => setPanel('phone')} disabled={!session} aria-label="PHONEを開く">
            ▯<span>PHONE</span>
            {phoneItems.length > phoneRead && <i>{phoneItems.length - phoneRead}</i>}
          </button>
        </div>
        <form
          className={`composer ${sending ? 'choice-selected' : ''}`}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={input}
            aria-label="メッセージ"
            placeholder="メッセージを入力してください……"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            maxLength={100000}
            disabled={sending || state?.busy || !session}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {state?.busy ? (
            <button
              type="button"
              className="send-button"
              onClick={() => void run(() => window.dialogue.stop())}
            >
              ■<span>停止</span>
            </button>
          ) : (
            <button
              className="send-button"
              disabled={sending || !draft.trim() || !session}
              aria-label="送信"
            >
              {sending ? '✓' : '➤'}
            </button>
          )}
        </form>
        <div className="input-caption">
          <span>Enter で送信 / Shift + Enter で改行</span>
          <span>
            {state?.busy ? 'Thinking…' : persisted ? '自動保存済み' : '最初の送信でSESSIONに保存'}
          </span>
        </div>
        {drawer && state && (
          <SessionDrawer
            state={state}
            close={() => setDrawer(false)}
            create={newSession}
            disabled={sending}
            open={(id) => {
              void run(async () => {
                await window.dialogue.openSession(id);
                setDrawer(false);
              });
            }}
            rename={(id, title) => run(() => window.dialogue.renameSession(id, title))}
            remove={(id) => run(() => window.dialogue.deleteSession(id))}
          />
        )}
      </div>
      {screen !== 'vn' && state && (
        <SystemScreen screen={screen} navigate={navigate}>
          {screen === 'config' ? (
            <>
              <header className="sys-title">
                <div>
                  <small>SYSTEM / CONFIG</small>
                  <h1>設定</h1>
                </div>
              </header>
              <div className="settings-layout">
                <nav className="settings-nav" aria-label="設定カテゴリ">
                  {(
                    [
                      ['ai', 'AI・API'],
                      ['display', '表示'],
                      ['sound', 'サウンド'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      className={category === id ? 'selected' : ''}
                      key={id}
                      onClick={() => setCategory(id)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div className="system-panel">
                  <Configuration
                    category={category}
                    settings={state.settings}
                    save={async (value) => {
                      if (await run(() => window.dialogue.saveSettings(value)))
                        setNotice('設定を保存しました');
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <CharactersPanel
              diagnosticsEnabled={state.diagnosticsEnabled}
              characters={state.characters ?? []}
              currentCharacterId={character.id}
              onDirtyChange={setCharacterDirty}
              saved={() => setNotice('キャラクター一覧を更新しました')}
              started={() => {
                setCharacterDirty(false);
                setScreen('vn');
                setNotice('新しい会話を始めます');
              }}
            />
          )}
        </SystemScreen>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="エラーを閉じる">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          ✓ {notice}
        </div>
      )}
      {panel === 'backlog' && session && (
        <Modal title="BACKLOG" close={() => setPanel(null)}>
          <Backlog
            session={session}
            copy={copy}
            edit={async (id, text) => {
              if (await run(() => window.dialogue.edit(id, text))) setPanel(null);
            }}
            retry={async () => {
              if (await run(() => window.dialogue.retry())) setPanel(null);
            }}
          />
        </Modal>
      )}
      {panel === 'phone' && (
        <Modal title="PHONE" close={() => setPanel(null)}>
          <PhoneView key={session?.id} items={phoneItems} name={character.name} copy={copy} />
        </Modal>
      )}
    </main>
  );
}
