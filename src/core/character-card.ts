import { randomUUID } from 'node:crypto';
import type { Character } from '../shared/types.ts';
import { defaultPlacement } from './characters.ts';

export const MAX_CARD_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function cardJsonFromPng(bytes: Buffer): string {
  if (bytes.length > MAX_CARD_BYTES || !bytes.subarray(0, 8).equals(pngSignature))
    throw new Error('有効なPNGカードを選択してください。');
  let position = 8;
  let card: string | undefined;
  let ended = false;
  let hasV3 = false;
  while (position + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(position);
    const end = position + 12 + size;
    if (end > bytes.length) throw new Error('PNGカードが途中で切れています。');
    const type = bytes.toString('ascii', position + 4, position + 8);
    const chunk = bytes.subarray(position + 8, position + 8 + size);
    if (crc32(bytes.subarray(position + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw new Error('PNGカードが破損しています（CRC不一致）。');
    if (type === 'tEXt') {
      const separator = chunk.indexOf(0);
      const key = chunk.subarray(0, separator).toString('latin1').toLowerCase();
      if (key === 'ccv3') hasV3 = true;
      if (separator > 0 && key === 'chara') {
        const encoded = chunk
          .subarray(separator + 1)
          .toString('ascii')
          .trim();
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
          throw new Error('PNGカードの設定データを復号できません。');
        const decoded = Buffer.from(encoded, 'base64');
        if (decoded.length > MAX_JSON_BYTES)
          throw new Error('カードの設定データは4MB以下にしてください。');
        try {
          card = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
        } catch {
          throw new Error('カードの文字コードを読み取れません。');
        }
      }
    }
    position = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Error('PNGカードが途中で切れています。');
  if (!card)
    throw new Error(
      hasV3
        ? 'V3専用カードは未対応です。V1/V2のJSONまたはPNGを使用してください。'
        : 'PNGにCharacter Cardの設定がありません。画像は立ち絵として登録できます。',
    );
  return card;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function parseCharacterCard(json: string): Character {
  if (Buffer.byteLength(json) > MAX_JSON_BYTES)
    throw new Error('カードの設定データは4MB以下にしてください。');
  let original: unknown;
  try {
    original = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Character CardのJSONを読み取れません。');
  }
  if (!record(original)) throw new Error('Character Cardの形式を確認してください。');
  let version: 1 | 2;
  let data: Record<string, unknown>;
  if (
    original.spec === 'chara_card_v2' &&
    original.spec_version === '2.0' &&
    record(original.data)
  ) {
    version = 2;
    data = original.data;
  } else if (original.spec === undefined && original.name !== undefined) {
    version = 1;
    data = original;
  } else throw new Error('対応するCharacter CardはV1またはV2（2.0）です。');
  const field = (name: string, max: number): string => {
    const value = data[name] ?? '';
    if (typeof value !== 'string' || value.length > max)
      throw new Error(`カードの ${name} の形式または長さを確認してください。`);
    return value;
  };
  const name = field('name', 120).trim();
  if (!name) throw new Error('カードにキャラクター名がありません。');
  const warnings: string[] = [];
  for (const key of [
    'system_prompt',
    'post_history_instructions',
    'character_book',
    'alternate_greetings',
    'extensions',
  ]) {
    const value = data[key];
    if (value && (typeof value !== 'object' || Object.keys(value).length > 0))
      warnings.push(`${key} は元データとして保持しますが、会話には反映しません。`);
  }
  return {
    id: randomUUID(),
    name,
    description: field('description', 100000),
    personality: field('personality', 50000),
    scenario: field('scenario', 50000),
    exampleMessages: field('mes_example', 100000),
    greeting: field('first_mes', 50000),
    defaultExpression: 'face_01',
    expressions: [{ id: 'face_01', description: '通常の表情', image: '' }],
    background: '',
    placement: { ...defaultPlacement },
    importedCard: { version, original, warnings },
  };
}
