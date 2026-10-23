import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Phone } from '../shared/types.ts';

export type PhoneItem = Phone & { id: string; createdAt: string };
export function PhoneView({
  items,
  name,
  copy,
}: {
  items: PhoneItem[];
  name: string;
  copy(text: string): void;
}) {
  const [filter, setFilter] = useState<'all' | Phone['format']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId);
  const filtered = items.filter((item) => filter === 'all' || item.format === filter);
  const label = (item: PhoneItem) =>
    item.format === 'code'
      ? `コード${item.language ? ` · ${item.language}` : ''}`
      : item.format === 'markdown'
        ? '説明メモ'
        : 'テキスト';
  return (
    <>
      <div className="phone-home">
        {selected ? (
          <>
            <button className="phone-back" onClick={() => setSelectedId(null)}>
              ← 一覧に戻る
            </button>
            <div className="phone-detail-head">
              <h2>{label(selected)}</h2>
              <button onClick={() => copy(selected.text)}>コピー</button>
            </div>
            {selected.format === 'markdown' ? (
              <div className="markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    a: ({ children }) => <span className="display-link">{children}</span>,
                    img: ({ alt }) => <span>{alt}</span>,
                  }}
                >
                  {selected.text}
                </ReactMarkdown>
              </div>
            ) : (
              <pre className={`phone-document ${selected.format === 'code' ? 'code' : 'plain'}`}>
                {selected.text}
              </pre>
            )}
          </>
        ) : (
          <>
            <h2>{name}から届いたもの</h2>
            {!filtered.length && <p className="empty">届いた内容はここに表示されます。</p>}
            {[...filtered].reverse().map((item) => (
              <button className="phone-card" key={item.id} onClick={() => setSelectedId(item.id)}>
                <span className="phone-file-icon">
                  {item.format === 'code' ? '⌘' : item.format === 'markdown' ? '▤' : '▧'}
                </span>
                <span>
                  <b>{label(item)}</b>
                  <small>
                    {new Date(item.createdAt).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                  <span className="phone-excerpt">
                    {item.text.replace(/^#+\s*/g, '').slice(0, 65)}
                  </span>
                </span>
                <span>›</span>
              </button>
            ))}
          </>
        )}
      </div>
      <nav className="phone-nav" aria-label="PHONEの表示種類">
        {(
          [
            ['all', 'すべて'],
            ['code', 'コード'],
            ['markdown', 'メモ'],
            ['text', 'テキスト'],
          ] as const
        ).map(([value, title]) => (
          <button
            className={filter === value ? 'selected' : ''}
            key={value}
            onClick={() => {
              setFilter(value);
              setSelectedId(null);
            }}
          >
            {title}
          </button>
        ))}
      </nav>
    </>
  );
}
