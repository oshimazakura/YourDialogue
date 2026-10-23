import { useEffect, useState, type FormEvent } from 'react';
import type { Character } from '../shared/types.ts';
import { defaultPlacement } from '../core/characters.ts';
import { CharacterScene } from './CharacterScene.tsx';

function freshCharacter(): Character {
  return {
    id: crypto.randomUUID(),
    name: '新しいキャラクター',
    description: '',
    greeting: '',
    background: '',
    defaultExpression: 'face_01',
    placement: { ...defaultPlacement },
    expressions: [{ id: 'face_01', description: '通常の表情', image: '' }],
  };
}
export function CharactersPanel({
  characters,
  currentCharacterId,
  saved,
  started,
  onDirtyChange,
  diagnosticsEnabled = false,
}: {
  characters: Character[];
  currentCharacterId?: string;
  saved(): void;
  started(): void;
  onDirtyChange(dirty: boolean): void;
  diagnosticsEnabled?: boolean;
}) {
  const [draft, setDraft] = useState<Character>(() =>
    structuredClone(
      characters.find((item) => item.id === currentCharacterId) ??
        characters[0] ??
        freshCharacter(),
    ),
  );
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [selectedExpression, setSelectedExpression] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!diagnosticsEnabled) return;
    if (view !== 'editor') {
      void window.dialogue.reportCharacterDraft?.(null).catch(() => {});
      return;
    }
    const timer = window.setTimeout(() => {
      const { importedCard, ...settings } = draft;
      void window.dialogue
        .reportCharacterDraft?.({
          character: {
            ...settings,
            ...(importedCard ? { importedCard: { ...importedCard, original: {} } } : {}),
          },
          dirty,
          error: error || null,
          selectedExpression,
        })
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [diagnosticsEnabled, view, draft, dirty, error, selectedExpression]);
  useEffect(
    () => () => {
      if (diagnosticsEnabled) void window.dialogue.reportCharacterDraft?.(null).catch(() => {});
    },
    [diagnosticsEnabled],
  );
  const placement = draft.placement ?? defaultPlacement;
  const expression = draft.expressions[selectedExpression] ?? draft.expressions[0];
  const update = (change: Partial<Character>) => {
    setDraft((old) => ({ ...old, ...change }));
    setDirty(true);
    setSuccess('');
  };
  const choose = (character: Character) => {
    if (dirty && !window.confirm('保存していない変更を破棄しますか？')) return;
    setView('editor');
    setDraft(structuredClone(character));
    setSelectedExpression(0);
    setDirty(false);
    setError('');
    setSuccess('');
    setDeleting(false);
  };
  const operation = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(reason),
      );
    } finally {
      setPending(false);
    }
  };
  const save = async (start: boolean) => {
    await window.dialogue.saveCharacter(draft);
    setDirty(false);
    setSuccess('保存しました。設定は新しいセッションから反映されます。');
    saved();
    if (start) {
      await window.dialogue.createSession(draft.id);
      started();
    }
  };
  const changeExpression = (
    change: Partial<Character['expressions'][number]>,
    target = selectedExpression,
  ) => {
    update({
      expressions: draft.expressions.map((item, index) =>
        index === target ? { ...item, ...change } : item,
      ),
    });
  };
  const image = async (background: boolean, target = selectedExpression) => {
    const url = await window.dialogue.pickImage();
    if (url) {
      if (background) update({ background: url });
      else {
        changeExpression({ image: url }, target);
        setSelectedExpression(target);
      }
    }
  };
  return (
    <div className="character-manager">
      <header className="sys-title">
        <div>
          <small>SYSTEM / CHARACTERS</small>
          <h1>キャラクター</h1>
        </div>
        <div className="library-actions">
          <button disabled={pending} onClick={() => choose(freshCharacter())}>
            ＋ 新規作成
          </button>
          <button
            disabled={pending}
            onClick={() => {
              if (dirty && !window.confirm('保存していない変更を破棄してカードを読み込みますか？'))
                return;
              void operation(async () => {
                const imported = await window.dialogue.importCharacter();
                if (imported) {
                  setView('editor');
                  setDraft(imported);
                  setSelectedExpression(0);
                  setDirty(true);
                  setSuccess('カードを読み込みました。内容を確認して保存してください。');
                  setDeleting(false);
                }
              });
            }}
          >
            カードを読み込む
          </button>
        </div>
        <p className="hint">
          JSON / PNG · V1 / V2
          <br />
          読み込みにLLMは使用しません。
        </p>
      </header>
      {view === 'editor' && (
        <button
          className="character-back"
          disabled={pending}
          onClick={() => {
            if (!dirty || window.confirm('保存していない変更を破棄しますか？')) {
              setDirty(false);
              setView('list');
            }
          }}
        >
          ← 一覧に戻る
        </button>
      )}
      {view === 'list' && (
        <div className="character-grid">
          {' '}
          {characters.map((character) => (
            <button
              disabled={pending}
              className="character-list-item"
              key={character.id}
              onClick={() => choose(character)}
            >
              {character.expressions.find((item) => item.id === character.defaultExpression)
                ?.image ? (
                <img
                  src={
                    character.expressions.find((item) => item.id === character.defaultExpression)!
                      .image
                  }
                  alt=""
                />
              ) : (
                <span className="character-initial">{character.name.slice(0, 1)}</span>
              )}
              <span>
                {character.name}
                <p>{character.description.slice(0, 90) || '説明はまだありません'}</p>
                {currentCharacterId === character.id && <small>現在のキャラクター</small>}
              </span>
            </button>
          ))}
        </div>
      )}
      {view === 'editor' && (
        <form
          className="character-editor"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void operation(() => save(false));
          }}
        >
          <aside className="character-preview-column">
            <h4>表示プレビュー</h4>
            <div className="character-preview">
              <CharacterScene character={draft} expression={expression.id} preview />
              <div className="preview-dialogue">
                <strong>{draft.name}</strong>
                <p>{draft.greeting || '表情と配置をここで確認できます。'}</p>
              </div>
            </div>
            <fieldset disabled={pending} className="placement-controls">
              {(
                [
                  ['scale', '大きさ', 0.3, 2.5, 0.01],
                  ['x', '左右位置', 0, 100, 1],
                  ['y', '上下位置', -60, 40, 1],
                ] as const
              ).map(([key, title, min, max, step]) => (
                <label key={key}>
                  {title} {key === 'scale' ? Math.round(placement[key] * 100) : placement[key]}%
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={placement[key]}
                    onChange={(event) =>
                      update({ placement: { ...placement, [key]: Number(event.target.value) } })
                    }
                  />
                </label>
              ))}
              <button type="button" onClick={() => update({ placement: { ...defaultPlacement } })}>
                配置をリセット
              </button>
            </fieldset>
          </aside>
          <fieldset disabled={pending}>
            <div className="character-editor-heading">
              <h3>{draft.name || 'キャラクター設定'}</h3>
              <span>{dirty ? '未保存' : '保存済み'}</span>
            </div>
            <p className="hint">
              画像・設定はアプリ内にコピーして保存します。変更は新しいセッションから適用され、既存の会話には影響しません。
            </p>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="character-success" role="status">
                {success}
              </p>
            )}
            {draft.importedCard && (
              <details className="import-notice" open={draft.importedCard.warnings.length > 0}>
                <summary>Character Card V{draft.importedCard.version} 読み込み情報</summary>
                <p>
                  名前・説明・性格・状況・会話例・最初の挨拶を使用します。元データの未知の項目は保持します。
                </p>
                {draft.importedCard.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </details>
            )}
            <label>
              名前
              <input
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                required
                maxLength={120}
              />
            </label>
            <label>
              説明・口調
              <textarea
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
                rows={4}
                maxLength={100000}
                placeholder="どんなキャラクターか、どう話すか"
              />
            </label>
            <label>
              最初の挨拶
              <textarea
                value={draft.greeting ?? ''}
                onChange={(event) => update({ greeting: event.target.value })}
                rows={3}
                maxLength={50000}
                placeholder="新しい会話で最初に表示する発話。空欄でも開始できます。"
              />
            </label>
            <p className="hint">
              挨拶は生成を待たずに表示し、最初の送信時に履歴へ保存します。{'{{char}}'} はキャラ名、
              {'{{user}}'} はYOUに置き換わります。
            </p>
            <details className="advanced-character">
              <summary>性格・状況・会話例</summary>
              <label>
                性格
                <textarea
                  value={draft.personality ?? ''}
                  onChange={(event) => update({ personality: event.target.value })}
                  rows={3}
                  maxLength={50000}
                />
              </label>
              <label>
                状況
                <textarea
                  value={draft.scenario ?? ''}
                  onChange={(event) => update({ scenario: event.target.value })}
                  rows={3}
                  maxLength={50000}
                />
              </label>
              <label>
                会話例
                <textarea
                  value={draft.exampleMessages ?? ''}
                  onChange={(event) => update({ exampleMessages: event.target.value })}
                  rows={4}
                  maxLength={100000}
                />
              </label>
            </details>
            <h4>表情と立ち絵</h4>
            <p className="hint">
              透過PNGを推奨。全身・上半身どちらでも登録できます。表情差分は画像サイズと人物位置を揃えてください。
            </p>
            <div className="expression-tabs">
              {draft.expressions.map((item, index) => (
                <button
                  type="button"
                  key={index}
                  className={selectedExpression === index ? 'selected' : ''}
                  onClick={() => setSelectedExpression(index)}
                >
                  {item.id || `表情${index + 1}`}
                </button>
              ))}
              <button
                type="button"
                disabled={draft.expressions.length >= 100}
                onClick={() => {
                  let index = draft.expressions.length + 1;
                  while (draft.expressions.some((item) => item.id === `face_${index}`)) index++;
                  setSelectedExpression(draft.expressions.length);
                  update({
                    expressions: [
                      ...draft.expressions,
                      { id: `face_${index}`, description: '', image: '' },
                    ],
                  });
                }}
              >
                ＋ 表情追加
              </button>
            </div>
            <div className="expression-list">
              {draft.expressions.map((expression, expressionIndex) => (
                <div className="expression-settings" key={expressionIndex}>
                  <button
                    type="button"
                    className="expression-thumb"
                    onClick={() => setSelectedExpression(expressionIndex)}
                    aria-label={`${expression.id}をプレビュー`}
                  >
                    {expression.image ? <img src={expression.image} alt="" /> : '＋'}
                  </button>
                  <label>
                    表情ID
                    <input
                      value={expression.id}
                      onChange={(event) => {
                        const id = event.target.value;
                        const previous = expression.id;
                        update({
                          expressions: draft.expressions.map((item, index) =>
                            index === expressionIndex ? { ...item, id } : item,
                          ),
                          ...(draft.defaultExpression === previous
                            ? { defaultExpression: id }
                            : {}),
                        });
                      }}
                      required
                      maxLength={80}
                      pattern="[a-zA-Z0-9_-]+"
                    />
                  </label>
                  <label>
                    LLMへの表情の説明
                    <textarea
                      value={expression.description}
                      onChange={(event) =>
                        changeExpression({ description: event.target.value }, expressionIndex)
                      }
                      rows={2}
                      maxLength={4000}
                      placeholder="考えを整理する時、嬉しい時、など"
                    />
                  </label>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => void operation(() => image(false, expressionIndex))}
                    >
                      立ち絵画像を選択
                    </button>
                    {expression.image && (
                      <button
                        type="button"
                        onClick={() => changeExpression({ image: '' }, expressionIndex)}
                      >
                        画像を外す
                      </button>
                    )}
                    {draft.expressions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const remaining = draft.expressions.filter(
                            (_, index) => index !== expressionIndex,
                          );
                          update({
                            expressions: remaining,
                            ...(draft.defaultExpression === expression.id
                              ? { defaultExpression: remaining[0].id }
                              : {}),
                          });
                          setSelectedExpression(0);
                        }}
                      >
                        この表情を削除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <label>
              デフォルト表情
              <select
                value={draft.defaultExpression}
                onChange={(event) => update({ defaultExpression: event.target.value })}
              >
                {draft.expressions.map((item, index) => (
                  <option key={index} value={item.id}>
                    {item.id}
                  </option>
                ))}
              </select>
            </label>
            <h4>標準背景</h4>
            <div className="row-actions">
              <button type="button" onClick={() => void operation(() => image(true))}>
                背景画像を選択
              </button>
              {draft.background && (
                <button type="button" onClick={() => update({ background: '' })}>
                  背景を外す
                </button>
              )}
            </div>
            <p className="hint">
              PNG / JPEG、32MB以下。画像は8192px・2400万画素以内。背景は画面を覆うように表示します。
            </p>
            <div className="character-save-actions">
              <button className="secondary" type="submit">
                設定を保存
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => void operation(() => save(true))}
              >
                保存してこのキャラで新規開始 →
              </button>
            </div>
            {characters.some((item) => item.id === draft.id) && (
              <div className="character-delete">
                {deleting ? (
                  <>
                    <p>キャラクターを削除しますか？既存セッションと画像は残ります。</p>
                    <button type="button" onClick={() => setDeleting(false)}>
                      戻る
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        void operation(async () => {
                          const next = await window.dialogue.deleteCharacter(draft.id);
                          setDraft(structuredClone(next.characters[0]));
                          setSelectedExpression(0);
                          setDirty(false);
                          setDeleting(false);
                          setView('list');
                          saved();
                        })
                      }
                    >
                      削除する
                    </button>
                  </>
                ) : (
                  <button type="button" className="subtle" onClick={() => setDeleting(true)}>
                    キャラクターを削除
                  </button>
                )}
              </div>
            )}
          </fieldset>
        </form>
      )}
    </div>
  );
}
