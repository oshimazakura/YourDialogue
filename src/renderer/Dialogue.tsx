import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Character, Message } from '../shared/types.ts';
import { vnSegments } from '../core/narration.ts';
import { paginate, type Page } from './pagination.ts';

interface Props {
  diagnosticsEnabled?: boolean;
  message?: Message;
  character: Character;
  busy: boolean;
  speed: number;
  fontSize: number;
  onExpression(expression: string): void;
  onLog?(): void;
}
export function Dialogue({
  diagnosticsEnabled,
  message,
  character,
  busy,
  speed,
  fontSize,
  onExpression,
  onLog,
}: Props) {
  const measure = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [offset, setOffset] = useState(0);
  const [visible, setVisible] = useState(0);
  const segments = useMemo(() => (message ? vnSegments(message) : []), [message]);
  const identity = message?.id ?? 'welcome';
  const lastIdentity = useRef(identity);
  useLayoutEffect(() => {
    if (lastIdentity.current !== identity) {
      setOffset(0);
      lastIdentity.current = identity;
    }
  }, [identity]);
  useLayoutEffect(() => {
    const target = viewport.current;
    const element = measure.current;
    if (!target || !element) return;
    const update = () => {
      if (!target.clientWidth || !target.clientHeight) return;
      element.style.width = `${target.clientWidth}px`;
      setPages(
        paginate(
          segments,
          (text) => {
            element.textContent = text;
            return element.scrollHeight <= target.clientHeight;
          },
          character.defaultExpression,
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [segments, fontSize, character.defaultExpression]);
  const pageIndex = Math.max(
    0,
    pages.findIndex((page) => offset < page.end),
  );
  const page = pages[pageIndex];
  const text =
    page?.text ??
    (busy
      ? ''
      : message
        ? '詳細はPHONEをご覧ください。'
        : 'こんにちは。今日は、何を話しましょうか。');
  const letters = useMemo(
    () =>
      Array.from(
        new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text),
        (part) => part.segment,
      ),
    [text],
  );
  const pageKey = `${identity}:${page?.start ?? 0}:${text}`;
  useEffect(() => {
    setVisible(speed === 0 ? letters.length : 0);
    if (speed === 0) return;
    const timer = window.setInterval(
      () =>
        setVisible((value) => {
          if (value >= letters.length) {
            window.clearInterval(timer);
            return value;
          }
          return value + 1;
        }),
      speed,
    );
    return () => window.clearInterval(timer);
  }, [pageKey, speed, letters.length]);
  useLayoutEffect(() => {
    // Pagination is measured in a layout effect. Wait for its result and sync
    // the scene before paint so restoring a session never flashes its default face.
    if (!page && segments.length > 0) return;
    onExpression(page?.expression ?? character.defaultExpression);
  }, [page, segments.length, character.defaultExpression, onExpression]);
  const lastReport = useRef({ at: 0, signature: '' });
  useEffect(() => {
    if (!diagnosticsEnabled) return;
    const phase = !page
      ? busy
        ? 'waiting_for_content'
        : 'no_speech'
      : visible < letters.length
        ? 'typing'
        : pageIndex < pages.length - 1
          ? 'waiting_for_page_advance'
          : busy
            ? 'waiting_for_more_segments'
            : 'answer_displayed';
    const signature = `${message?.id}:${page?.kind}:${phase}:${pageIndex}:${pages.length}:${viewport.current?.clientWidth}:${viewport.current?.clientHeight}`;
    if (signature === lastReport.current.signature && Date.now() - lastReport.current.at < 500)
      return;
    lastReport.current = { at: Date.now(), signature };
    void window.dialogue
      .reportUi({
        source: 'dialogue',
        messageId: message?.id ?? null,
        phase,
        page: page ? pageIndex + 1 : 0,
        pageCount: pages.length,
        visibleCharacters: visible,
        totalCharacters: letters.length,
        expression: page?.expression ?? character.defaultExpression,
        segmentType: page?.kind ?? null,
        speakerVisible: page?.kind !== 'narration',
        viewportWidth: viewport.current?.clientWidth ?? 0,
        viewportHeight: viewport.current?.clientHeight ?? 0,
      })
      .catch(() => {});
  }, [
    diagnosticsEnabled,
    message?.id,
    busy,
    page,
    pages.length,
    pageIndex,
    visible,
    letters.length,
    character.defaultExpression,
  ]);
  const advance = () => {
    if (visible < letters.length) setVisible(letters.length);
    else if (page && pageIndex < pages.length - 1) setOffset(page.end);
  };
  return (
    <section
      className="dialogue"
      style={{ fontSize }}
      aria-label={page?.kind === 'narration' ? '地の文' : 'AIの発話'}
    >
      {page?.kind !== 'narration' && (message || !busy) && (
        <div className="speaker">
          <span className="speaker-dot" />
          {character.name}
          <span className="speaker-role">YOUR AI COMPANION</span>
        </div>
      )}
      {onLog && (
        <button className="dialog-log" onClick={onLog} title="会話ログ">
          ▤ <span>LOG</span>
        </button>
      )}
      <div ref={viewport} className="dialogue-viewport">
        <button
          className="dialogue-text"
          onClick={advance}
          aria-label="発話を即時表示、または次のページへ"
        >
          {letters.slice(0, visible).join('')}
        </button>
      </div>
      <div ref={measure} className="page-measure" aria-hidden="true" />
      <div className="page-controls">
        <span>
          {page
            ? `${pageIndex + 1} / ${pages.length}${busy ? ' …' : ''}`
            : busy
              ? 'Thinking…'
              : 'YOUR DIALOGUE'}
        </span>
        {visible < letters.length ? (
          <button onClick={advance} className="advance">
            すぐに表示
          </button>
        ) : pageIndex < pages.length - 1 ? (
          <button onClick={advance} className="advance advance-next" aria-label="次のページへ">
            次へ{' '}
            <span className="next-arrow" aria-hidden="true">
              ▶
            </span>
          </button>
        ) : busy ? (
          <span className="receiving-status" role="status">
            受信中…
          </span>
        ) : null}
      </div>
    </section>
  );
}
