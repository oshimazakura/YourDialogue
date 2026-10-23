export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048)
    throw new Error('接続先のベースURLを入力してください。');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('接続先URLの形式が正しくありません。');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      '接続先は認証情報・クエリ・フラグメントを含まないHTTP/HTTPSのURLにしてください。',
    );
  const base = url.toString().replace(/\/+$/, '');
  if (/\/(?:chat\/completions|models)$/i.test(url.pathname.replace(/\/+$/, '')))
    throw new Error('APIの完全なURLではなく、/v1などまでのベースURLを指定してください。');
  return base;
}
