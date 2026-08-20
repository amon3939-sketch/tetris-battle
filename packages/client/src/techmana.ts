// テクマナ起動連携: URLの tm_token を検出して保持する
// テクマナ側が「?tm_token=XXXX」付きのURLでテトックスを開くと、
// このトークンをサーバー経由でテクマナAPIに検証してもらい、
// ニックネーム（テクマナのユーザー名）を引き継ぐ。
// 詳細: files/05_テクマナ連携仕様書.md

let launchToken: string | null = null;

/** 起動時に呼ぶ。URLから tm_token を取り出し、アドレスバーから消す（再呼び出しは保持済みの値を返す） */
export function captureTechmanaToken(): string | null {
  if (launchToken) return launchToken;

  const params = new URLSearchParams(window.location.search);
  const token = params.get('tm_token');
  if (token) {
    launchToken = token;
    params.delete('tm_token');
    const query = params.toString();
    const newUrl = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }
  return launchToken;
}
