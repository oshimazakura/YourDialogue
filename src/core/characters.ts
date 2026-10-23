import { defaultCharacter } from '../shared/character.ts';
import type { Character } from '../shared/types.ts';

export const defaultPlacement = { scale: 1.12, x: 70, y: -12 };
export function expandCharacterText(text: string, character: Pick<Character, 'name'>): string {
  return text
    .replace(/\{\{char\}\}|<bot>/gi, () => character.name)
    .replace(/\{\{user\}\}|<user>/gi, 'YOU');
}
export function isAssetReference(value: string): boolean {
  return (
    value === '' ||
    /^dialogue-asset:\/\/local\/[a-f0-9]{64}\.png$/.test(value) ||
    defaultCharacter.expressions.some((expression) => expression.image === value)
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('キャラクター設定の形式が正しくありません。');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max)
    throw new Error(`${label}は${max}文字以内で入力してください。`);
  return value;
}
export function validateCharacter(input: unknown): Character {
  const value = object(input);
  const id = text(value.id, 'キャラクターID', 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('キャラクターIDが正しくありません。');
  const name = text(value.name, '名前', 120).trim();
  if (!name) throw new Error('キャラクター名を入力してください。');
  if (
    !Array.isArray(value.expressions) ||
    !value.expressions.length ||
    value.expressions.length > 100
  )
    throw new Error('表情は1〜100個で設定してください。');
  const ids = new Set<string>();
  const expressions = value.expressions.map((entry) => {
    const expression = object(entry);
    const expressionId = text(expression.id, '表情ID', 80).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(expressionId) || ids.has(expressionId))
      throw new Error('表情IDは重複しない英数字・ハイフン・アンダースコアにしてください。');
    ids.add(expressionId);
    const image = text(expression.image, '画像', 300);
    if (!isAssetReference(image)) throw new Error('画像は画像選択から登録してください。');
    return {
      id: expressionId,
      description: text(expression.description, '表情の説明', 4000),
      image,
    };
  });
  const defaultExpression = text(value.defaultExpression, 'デフォルト表情', 80);
  if (!ids.has(defaultExpression)) throw new Error('登録済みのデフォルト表情を選択してください。');
  const background = text(value.background, '背景', 300);
  if (!isAssetReference(background)) throw new Error('背景は画像選択から登録してください。');
  const placement = value.placement === undefined ? defaultPlacement : object(value.placement);
  for (const [key, min, max] of [
    ['scale', 0.3, 2.5],
    ['x', 0, 100],
    ['y', -60, 40],
  ] as const) {
    if (
      typeof placement[key] !== 'number' ||
      !Number.isFinite(placement[key]) ||
      placement[key] < min ||
      placement[key] > max
    )
      throw new Error('立ち絵の配置設定を確認してください。');
  }
  return {
    id,
    name,
    description: text(value.description, '説明・口調', 100000),
    personality: text(value.personality, '性格', 50000),
    scenario: text(value.scenario, 'シナリオ', 50000),
    exampleMessages: text(value.exampleMessages, '会話例', 100000),
    greeting: text(value.greeting, '最初の挨拶', 50000),
    expressions,
    defaultExpression,
    background,
    placement: {
      scale: placement.scale as number,
      x: placement.x as number,
      y: placement.y as number,
    },
  };
}
