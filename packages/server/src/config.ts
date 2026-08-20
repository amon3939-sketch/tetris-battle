/**
 * 環境変数から読む設定。
 *
 * テクマナ連携は任意。資格情報が揃っていなければ機能を「無効」として
 * 報告するだけで、ゲーム自体は今までどおり動く。連携の設定漏れで
 * ゲームが落ちる、という事故を作らないため。
 */

function trimmed(v: string | undefined, fallback = ''): string {
  return (v ?? fallback).trim();
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  corsOrigin: trimmed(process.env.CORS_ORIGIN, '*'),
  /**
   * Cookie に Secure を付けるか。
   *
   * NODE_ENV では判定しない。Railway はこのサービスに NODE_ENV を
   * 設定しておらず(実測: 未設定)、`NODE_ENV === 'production'` は本番でも
   * false になる。それでは HTTPS の本番で Secure なしの Cookie を配る
   * ことになるので、既定を「付ける」にして、ローカル開発だけ
   * COOKIE_INSECURE=1 で外す。
   */
  cookieSecure: trimmed(process.env.COOKIE_INSECURE) === '',
  /**
   * 認可の往復から戻ってきたブラウザの行き先。クライアントはこのサーバ
   * 自身が配信しているので、既定は自分のルート。
   */
  clientBaseUrl: trimmed(process.env.CLIENT_BASE_URL, '/'),
  techmana: {
    baseUrl: trimmed(process.env.TECHMANA_BASE_URL, 'https://techmana.adamant-group.jp').replace(/\/$/, ''),
    clientId: trimmed(process.env.TECHMANA_CLIENT_ID),
    clientSecret: trimmed(process.env.TECHMANA_CLIENT_SECRET),
    /** テクマナに登録した値と1バイトも違ってはいけない。 */
    redirectUri: trimmed(process.env.TECHMANA_REDIRECT_URI),
  },
} as const;

export function techmanaEnabled(): boolean {
  const t = config.techmana;
  if (t.clientId === '' || t.clientSecret === '' || t.redirectUri === '') return false;
  // 鍵が無いと毎起動ランダムになり、セッションの唯一の保管場所である
  // Cookie が再起動のたび復号不能になる。利用者からは「連携が勝手に
  // 切れる」としか見えないので、そうなるくらいなら機能ごと出さない。
  // プロセスは落とさない — ゲーム本体は従来どおり遊べる。
  return sessionSecretConfigured();
}

function sessionSecretConfigured(): boolean {
  return trimmed(process.env.SESSION_SECRET) !== '';
}
