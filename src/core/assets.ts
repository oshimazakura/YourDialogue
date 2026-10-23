import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Imported files are owned copies, immutable and shared by session snapshots.
export class AssetStore {
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
  }
  putPng(bytes: Buffer): string {
    const digest = createHash('sha256').update(bytes).digest('hex');
    const url = `dialogue-asset://local/${digest}.png`;
    try {
      writeFileSync(this.path(url), bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    return url;
  }
  private path(url: string) {
    const match = /^dialogue-asset:\/\/local\/([a-f0-9]{64}\.png)$/.exec(url);
    if (!match) throw new Error('画像の参照先が正しくありません。');
    return join(this.directory, match[1]);
  }
  has(url: string): boolean {
    try {
      return existsSync(this.path(url));
    } catch {
      return false;
    }
  }
  read(url: string): Buffer {
    return readFileSync(this.path(url));
  }
}
