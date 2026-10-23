import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ModelOption, PublicSettings, Session } from '../shared/types.ts';
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
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const modelRequest = useRef(0);
  const [key, setKey] = useState('');
  const [keyChanged, setKeyChanged] = useState(false);
  const [speed, setSpeed] = useState(settings.characterMs);
  const [size, setSize] = useState(settings.fontSize);
  const [sound, setSound] = useState(settings.sound);
  const [saving, setSaving] = useState(false);
  const invalidateModels = () => {
    modelRequest.current++;
    setModels([]);
    setLoading(false);
    setModelsError('');
    setSearch('');
    setManual(false);
  };
  const changeBaseUrl = (value: string) => {
    invalidateModels();
    setBaseUrl(value);
    setModel('');
    setKey('');
    setKeyChanged(true);
  };
  const fetchModels = async () => {
    const requestId = ++modelRequest.current;
    setLoading(true);
    setModelsError('');
    try {
      const items = await window.dialogue.listModels({
        baseUrl,
        ...(keyChanged ? { apiKey: key } : {}),
      });
      if (requestId !== modelRequest.current) return;
      setModels(items);
      setManual(false);
    } catch (reason) {
      if (requestId !== modelRequest.current) return;
      setModels([]);
      setManual(true);
      setModelsError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : 'モデル一覧を取得できませんでした。',
      );
    } finally {
      if (requestId === modelRequest.current) setLoading(false);
    }
  };
  useEffect(() => {
    void fetchModels();
    return () => {
      modelRequest.current++;
    };
    // Fetch the saved connection on opening; edited connections use the refresh button.
  }, []);
  const matches = models.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await save({
        baseUrl,
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
          接続先URL（OpenAI互換API）
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => changeBaseUrl(event.target.value)}
            placeholder="https://example.com/v1"
            maxLength={2048}
          />
        </label>
        <p className="hint">
          /v1などまでを指定してください。会話には /chat/completions、モデル一覧には /models
          を付加します。HTTP/HTTPSに対応します。
        </p>
        <p className="hint">
          URL例：OpenRouter は https://openrouter.ai/api/v1、OpenAI は
          https://api.openai.com/v1。利用するサービスのURLを入力してください。
        </p>
        <label>
          APIキー（認証不要の接続先では空欄）
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder={
              settings.hasApiKey && !keyChanged
                ? '設定済み（変更する場合のみ入力）'
                : '接続先のAPIキー'
            }
            onChange={(event) => {
              invalidateModels();
              setKey(event.target.value);
              setKeyChanged(true);
            }}
          />
        </label>
        <p className="hint">
          {settings.keyStorage === 'encrypted'
            ? 'APIキーはOSの暗号化機能で保護して、このPCに保存します。'
            : 'この環境ではAPIキーはアプリ終了までメモリ内だけに保持します。'}
          接続先URLを変更すると、以前のキーは引き継ぎません。
        </p>
        {(settings.hasApiKey || key) && (
          <button
            type="button"
            className="subtle"
            onClick={() => {
              invalidateModels();
              setKey('');
              setKeyChanged(true);
            }}
          >
            キーを削除する（設定保存で反映）
          </button>
        )}
        <div className="model-actions">
          <h3>モデル</h3>
          <button
            type="button"
            disabled={loading || !baseUrl.trim()}
            onClick={() => void fetchModels()}
          >
            {loading ? '取得中…' : 'モデル一覧を取得・更新'}
          </button>
        </div>
        {loading && (
          <p className="hint" role="status">
            接続先からモデル一覧を取得しています…
          </p>
        )}
        {modelsError && (
          <p className="inline-error" role="alert">
            {modelsError} 再取得するか、モデルIDを手入力できます。
          </p>
        )}
        {!!models.length && !manual && (
          <>
            <label>
              モデル名・IDで検索
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="モデルを検索"
              />
            </label>
            <label>
              モデルを選択
              <select
                className="model-list"
                size={7}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="" disabled>
                  モデルを選択してください
                </option>
                {model && !matches.some((item) => item.id === model) && (
                  <option value={model}>選択中: {model}</option>
                )}
                {matches.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name === item.id ? item.id : `${item.name} — ${item.id}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">
              {matches.length} / {models.length}{' '}
              件。一覧への掲載は、このアプリでの会話対応を保証するものではありません。
            </p>
          </>
        )}
        <p className="hint">選択中: {model || '未選択'}</p>
        <button
          type="button"
          className="subtle"
          disabled={loading}
          onClick={() => {
            if (manual && !models.length) void fetchModels();
            else setManual((value) => !value);
          }}
        >
          {manual
            ? models.length
              ? 'モデル一覧から選ぶ'
              : 'モデル一覧を再取得する'
            : 'モデルIDを手入力する'}
        </button>
        {manual && (
          <label>
            モデルID
            <input
              value={model}
              placeholder="接続先のモデルID"
              onChange={(event) => setModel(event.target.value)}
              maxLength={200}
            />
          </label>
        )}
        <p className="hint">
          一覧取得は未保存のURL・キーでも試せます。「設定を保存」で接続先とモデルを会話に反映します。送信時にはキャラクター設定と会話履歴を指定した接続先へ送り、Streamingで応答を受信します。
        </p>
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
