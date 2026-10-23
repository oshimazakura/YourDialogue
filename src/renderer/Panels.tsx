import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PublicSettings, Session } from '../shared/types.ts';
export type ConfigCategory = 'ai' | 'display' | 'sound';
const statusNames = { complete: '', generating: '生成中', interrupted: '中断', error: 'エラー' };

export function Configuration({
  settings,
  save,
  category,
}: {
  category: ConfigCategory;
  settings: PublicSettings;
  save(input: Parameters<typeof window.dialogue.saveSettings>[0]): Promise<void>;
}) {
  const [model, setModel] = useState(settings.model);
  const [key, setKey] = useState('');
  const [keyChanged, setKeyChanged] = useState(false);
  const [speed, setSpeed] = useState(settings.characterMs);
  const [size, setSize] = useState(settings.fontSize);
  const [sound, setSound] = useState(settings.sound);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await save({
        model,
        characterMs: speed,
        fontSize: size,
        sound,
        ...(keyChanged ? { apiKey: key } : {}),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      <section hidden={category !== 'ai'}>
        <h2>AI・API設定</h2>
        <label>
          プロバイダ
          <select disabled value="openrouter">
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>
        <label>
          OpenRouter APIキー
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={settings.hasApiKey ? '設定済み（変更する場合のみ入力）' : 'sk-or-…'}
            onChange={(event) => {
              setKey(event.target.value);
              setKeyChanged(true);
            }}
          />
        </label>
        <p className="hint">
          {settings.keyStorage === 'encrypted'
            ? 'APIキーはOSの暗号化機能で保護して、このPCに保存します。'
            : 'この環境ではAPIキーはアプリ終了までメモリ内だけに保持します。'}
        </p>
        {settings.hasApiKey && (
          <button
            type="button"
            className="subtle"
            onClick={() => {
              setKey('');
              setKeyChanged(true);
            }}
          >
            保存したキーを削除する
          </button>
        )}
        <label>
          モデルID
          <input
            value={model}
            placeholder="provider/model-name"
            onChange={(event) => setModel(event.target.value)}
            maxLength={200}
          />
        </label>
        <p className="hint">
          OpenRouterに表示されるモデルIDを指定してください。送信時に会話内容をOpenRouterへ送ります。
        </p>
        <p className="hint">Streamingで応答を受信します。</p>
      </section>
      <section hidden={category !== 'display'}>
        <h2>表示</h2>
        <label>
          文字送りの間隔 <span>{speed === 0 ? '即時' : `${speed} ms`}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          />
        </label>
        <label>
          文字サイズ <span>{size} px</span>
          <input
            type="range"
            min="16"
            max="32"
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
      </section>
      <section hidden={category !== 'sound'}>
        <h2>サウンド</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => setSound(event.target.checked)}
          />
          決定音を鳴らす
        </label>
      </section>
      <button className="primary" disabled={saving}>
        {saving ? '保存中…' : '設定を保存'}
      </button>
    </form>
  );
}

export function Backlog({
  session,
  edit,
  retry,
  copy,
}: {
  session: Session;
  edit(id: string, text: string): Promise<void>;
  retry(): Promise<void>;
  copy(text: string): void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const scrollArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Wait until the parent dialog is open and its scroll area has a layout.
    const frame = window.requestAnimationFrame(() => {
      const element = scrollArea.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session.id]);
  return (
    <div ref={scrollArea} className="backlog panel-scroll">
      <p className="hint">過去の発言を編集すると、それ以降の会話を破棄して再生成します。</p>
      {!session.messages.length && <p className="empty">会話はまだありません。</p>}
      {session.messages.map((message) => (
        <article key={message.id} className={`log-entry ${message.role}`}>
          <header>
            <strong>{message.role === 'user' ? 'YOU' : session.character.name}</strong>
            <span>{statusNames[message.status]}</span>
          </header>
          {editing === message.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setPending(true);
                void edit(message.id, text).finally(() => setPending(false));
              }}
            >
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
                maxLength={100000}
                rows={5}
                autoFocus
              />
              <div className="row-actions">
                <button type="button" onClick={() => setEditing(null)}>
                  キャンセル
                </button>
                <button className="primary" disabled={pending}>
                  ここから再生成
                </button>
              </div>
            </form>
          ) : (
            <>
              {message.role === 'user' ? (
                <p>{message.text}</p>
              ) : (
                message.segments.map((segment, index) => (
                  <div key={index}>
                    {segment.type === 'phone' && (
                      <span className="content-tag">PHONE / {segment.format}</span>
                    )}
                    <pre className="log-text">{segment.text}</pre>
                  </div>
                ))
              )}
              {message.error && <p className="inline-error">{message.error}</p>}
              <div className="row-actions">
                <button
                  onClick={() =>
                    copy(
                      message.role === 'user'
                        ? message.text
                        : message.segments.map((item) => item.text).join('\n\n'),
                    )
                  }
                >
                  コピー
                </button>
                {message.role === 'user' && (
                  <button
                    onClick={() => {
                      setEditing(message.id);
                      setText(message.text);
                    }}
                  >
                    編集
                  </button>
                )}
              </div>
            </>
          )}
        </article>
      ))}
      {session.messages.some((message) => message.role === 'user') && (
        <button
          className="secondary"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void retry().finally(() => setPending(false));
          }}
        >
          最後の回答を再生成
        </button>
      )}
    </div>
  );
}
