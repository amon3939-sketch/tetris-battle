/**
 * セッション Cookie。
 *
 * このサーバには永続ストレージが無い(db.ts はインメモリ、Railway に
 * ボリューム無し)。そこでセッションをサーバに持たず、テクマナのトークン
 * ごと暗号化して Cookie に載せ、ブラウザに持たせる。
 *
 * こうするとプロセスを再起動してもログイン状態が生き残る。DB を足すより
 * この構成に素直で、ネイティブモジュール(better-sqlite3)を Alpine 上で
 * ビルドする話も避けられる。
 *
 * 引き換えに失うもの: サーバ側から個別セッションを失効させる手段。
 * 連携解除は Cookie を消すことで行い、本当に止めたい場合はテクマナ側で
 * トークンを失効させる(そうすればリフレッシュが落ちて未連携に戻る)。
 *
 * 中身は AES-256-GCM。鍵は SESSION_SECRET から導出する。GCM なので
 * 改竄は復号時に検出される — 署名を別に持つ必要はない。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'tetox_session';
/** 認可フローの間だけ生きる一時 Cookie。 */
export const PENDING_COOKIE = 'tetox_oauth';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SessionData {
  /** テクマナ側の user_id。ゲーム内の同定キーになる。 */
  sub: string;
  nickname: string;
  accessToken: string;
  refreshToken: string | null;
  /** アクセストークンの失効時刻(epoch ms)。 */
  expiresAt: number;
}

export interface PendingAuth {
  state: string;
  verifier: string;
}

/**
 * 鍵は起動時に一度だけ導出する。SESSION_SECRET が未設定なら、その場で
 * ランダムに作る — 開発中は動くが、再起動でログインが切れる。本番で
 * 未設定のまま動かさないよう、呼び出し側が警告する。
 */
let cachedKey: Buffer | null = null;

export function sessionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = (process.env.SESSION_SECRET ?? '').trim();
  cachedKey = createHash('sha256').update(secret === '' ? randomBytes(32) : secret).digest();
  return cachedKey;
}

export function sessionSecretConfigured(): boolean {
  return (process.env.SESSION_SECRET ?? '').trim() !== '';
}

/** テスト用。プロセス内の導出済み鍵を捨てる。 */
export function _resetSessionKeyForTesting(): void {
  cachedKey = null;
}

export function seal(data: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, sessionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

/** @returns 復号できなければ null。改竄・鍵変更・破損はすべてここに落ちる。 */
export function open<T>(token: string | undefined): T | null {
  if (typeof token !== 'string' || token === '') return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return null;
  }
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv(ALGO, sessionKey(), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function readSession(cookieHeader: string | undefined): SessionData | null {
  const s = open<SessionData>(cookiesOf(cookieHeader)[SESSION_COOKIE]);
  if (!s || typeof s.sub !== 'string' || s.sub === '') return null;
  return s;
}

/**
 * Cookie ヘッダを素朴に分解する。cookie-parser を足しても良いが、
 * socket.io のハンドシェイクは Express のミドルウェアを通らないので
 * どのみち生ヘッダを読む口が要る。ここ1箇所に集約しておく。
 */
export function cookiesOf(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const k = part.slice(0, eq).trim();
    if (k === '') continue;
    try {
      out[k] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[k] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** 長さ差でも早期 return しない比較。state 照合に使う。 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
