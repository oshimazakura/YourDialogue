import { dialog, nativeImage, protocol, type BrowserWindow } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { checkImageSize } from '../core/image-size.ts';
import { AssetStore } from '../core/assets.ts';
import { cardJsonFromPng, MAX_CARD_BYTES, parseCharacterCard } from '../core/character-card.ts';
import { validateCharacter } from '../core/characters.ts';
import type { Store } from '../core/store.ts';
import type { Character } from '../shared/types.ts';

export function installAssetProtocol(assets: AssetStore) {
  protocol.handle('dialogue-asset', (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    try {
      return new Response(new Uint8Array(assets.read(request.url)), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
export class Characters {
  private store: Store;
  private assets: AssetStore;
  private imports = new Map<string, NonNullable<Character['importedCard']>>();
  constructor(store: Store, assets: AssetStore) {
    this.store = store;
    this.assets = assets;
  }
  save(input: unknown): Character {
    const character = validateCharacter(input);
    for (const image of [
      ...character.expressions.map((entry) => entry.image),
      character.background,
    ]) {
      if (image?.startsWith('dialogue-asset:') && !this.assets.has(image))
        throw new Error('登録画像が見つかりません。再度選択してください。');
    }
    const previous = this.store.listCharacters().find((item) => item.id === character.id);
    character.importedCard = previous?.importedCard ?? this.imports.get(character.id);
    this.store.saveCharacter(character);
    this.imports.delete(character.id);
    return character;
  }
  private async file(
    window: BrowserWindow,
    extensions: string[],
  ): Promise<{ path: string; bytes: Buffer } | null> {
    const choice = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: '対応ファイル', extensions }],
    });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const path = choice.filePaths[0];
    if ((await stat(path)).size > MAX_CARD_BYTES)
      throw new Error('ファイルは32MB以下にしてください。');
    const bytes = await readFile(path);
    if (bytes.length > MAX_CARD_BYTES) throw new Error('ファイルは32MB以下にしてください。');
    return { path, bytes };
  }
  private image(bytes: Buffer): string {
    checkImageSize(bytes);
    const image = nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (
      image.isEmpty() ||
      size.width > 8192 ||
      size.height > 8192 ||
      size.width * size.height > 24_000_000
    )
      throw new Error('画像はPNG/JPEG形式、8192px・2400万画素以内にしてください。');
    return this.assets.putPng(image.toPNG());
  }
  async pickImage(window: BrowserWindow) {
    const file = await this.file(window, ['png', 'jpg', 'jpeg']);
    return file ? this.image(file.bytes) : null;
  }
  async importCard(window: BrowserWindow): Promise<Character | null> {
    const file = await this.file(window, ['json', 'png']);
    if (!file) return null;
    const png = file.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const character = parseCharacterCard(
      png ? cardJsonFromPng(file.bytes) : file.bytes.toString('utf8'),
    );
    if (png) character.expressions[0].image = this.image(file.bytes);
    // Preserve original extension data in main, not from arbitrary renderer edits.
    if (this.imports.size >= 20) this.imports.delete(this.imports.keys().next().value!);
    this.imports.set(character.id, character.importedCard!);
    return character;
  }
}
