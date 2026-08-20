// テクマナAPI連携: 起動トークンの検証
// リクエスト/レスポンスの形式はテクマナ側の正式仕様に合わせて調整する
// （仕様書: files/05_テクマナ連携仕様書.md）

export interface TechmanaUser {
  userId: string;
  name: string;
}

const VERIFY_URL = process.env.TECHMANA_VERIFY_URL ?? '';
const API_KEY = process.env.TECHMANA_API_KEY ?? '';

export function isTechmanaEnabled(): boolean {
  return VERIFY_URL.length > 0;
}

/**
 * テクマナが発行した起動トークンをテクマナAPIに問い合わせて検証する。
 * 検証成功時はユーザー情報を返し、失敗時（未設定・タイムアウト・無効トークン）は null。
 */
export async function verifyTechmanaToken(token: string): Promise<TechmanaUser | null> {
  if (!isTechmanaEnabled()) return null;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    // 想定レスポンス: { valid: true, user: { id: string, name: string } }
    // ※ テクマナ側の正式仕様が確定したらここを合わせる
    const data = (await res.json()) as {
      valid?: boolean;
      user?: { id?: string | number; name?: string };
    };
    if (!data?.valid || data.user?.id == null) return null;

    return {
      userId: String(data.user.id),
      name: String(data.user.name || 'テクマナユーザー'),
    };
  } catch {
    return null;
  }
}
