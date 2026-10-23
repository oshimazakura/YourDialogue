import type { ModelOption } from '../shared/types.ts';
import { normalizeBaseUrl } from '../shared/connection.ts';

export async function listModels(
  baseUrl: string,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelOption[]> {
  const url = normalizeBaseUrl(baseUrl);
  let response: Response;
  try {
    response = await fetcher(`${url}/models`, {
      method: 'GET',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch {
    throw new Error(
      'モデル一覧に接続できませんでした。URLと接続状態を確認して再取得するか、モデルIDを手入力してください。',
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const reason =
      response.status === 401 || response.status === 403
        ? '認証に失敗しました。APIキーとアクセス権を確認してください。'
        : response.status === 404 || response.status === 405
          ? 'この接続先はGET /modelsに対応していないか、ベースURLが異なります。'
          : response.status === 429
            ? '利用制限に達しました。時間をおいて再取得してください。'
            : '接続先がエラーを返しました。再取得するか、モデルIDを手入力してください。';
    throw new Error(`モデル一覧 (${response.status}): ${reason}`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      'モデル一覧の応答がJSONではありません。URLを確認するか、モデルIDを手入力してください。',
    );
  }
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data))
    throw new Error('モデル一覧の形式に対応していません。モデルIDを手入力してください。');
  const models = new Map<string, ModelOption>();
  for (const item of value.data) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      item.id.length > 200
    )
      continue;
    // Only exclude models explicitly known not to produce text. Generic model
    // lists do not necessarily describe Chat Completions compatibility.
    if (
      Array.isArray(item.architecture?.output_modalities) &&
      !item.architecture.output_modalities.includes('text')
    )
      continue;
    const id = item.id.trim();
    models.set(id, {
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.slice(0, 300) : id,
    });
  }
  if (!models.size)
    throw new Error(
      '選択できるモデルがありません。モデルIDを手入力するか、接続先を確認してください。',
    );
  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}
