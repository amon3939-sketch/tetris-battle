/**
 * テクマナ(社内システム)との通信。
 *
 * このサーバはテクマナの「機密クライアント」として振る舞う。認可コードと
 * トークンのやり取りはすべてサーバ側で完結し、ブラウザにテクマナの
 * トークンを裸で渡すことはない(暗号化してセッション Cookie に載せる)。
 *
 * 保存先を持たないので、トークンの置き場は呼び出し側 —— つまり Cookie。
 * このモジュールは「今持っているトークン」を受け取り、必要なら更新した
 * ものを返す、という形にしてある。
 */

import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { PendingAuth, SessionData } from './session.js';

/** ネットワーク遅延で切れかけを掴まないための余裕。 */
const EXPIRY_SKEW_MS = 30_000;
const TIMEOUT_MS = 15_000;
/** テクマナ側の上限は1MB。手前で弾いて無駄な往復を避ける。 */
const MAX_SAVE_BYTES = 1_000_000;

export class TechmanaError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * リフレッシュを終えた後に失敗した場合の、更新済みセッション。
     *
     * これを運ばないと事故になる。トークンを回した直後にセーブAPIが
     * 落ちると、新しいリフレッシュトークンがどこにも保存されないまま
     * 例外で抜ける。ブラウザは古いものを持ち続け、次の要求で消費済みの
     * トークンを再提示し、テクマナがそれを漏洩とみなして全トークンを
     * 失効させる。呼び出し側はこれを見て Cookie を貼り直す。
     */
    readonly session?: SessionData,
  ) {
    super(message);
    this.name = 'TechmanaError';
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

export interface Profile {
  userId: number;
  nickname: string;
  name: string;
}

/* ------------------------------ 認可フロー ------------------------------ */

/** state と PKCE verifier を作り、テクマナの認可画面URLを組み立てる。 */
export function beginAuth(): { url: string; pending: PendingAuth } {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());

  const q = new URLSearchParams({
    client_id: config.techmana.clientId,
    redirect_uri: config.techmana.redirectUri,
    response_type: 'code',
    scope: 'profile save',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${config.techmana.baseUrl}/oauth/authorize?${q}`, pending: { state, verifier } };
}

export function exchangeCode(code: string, verifier: string): Promise<TokenSet> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.techmana.clientId,
      client_secret: config.techmana.clientSecret,
      code,
      redirect_uri: config.techmana.redirectUri,
      code_verifier: verifier,
    }),
  );
}

export async function fetchProfile(accessToken: string): Promise<Profile> {
  const res = await fetch(`${config.techmana.baseUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new TechmanaError(res.status, `/me failed: ${res.status}`);
  const d = (await res.json()) as { user_id?: number; nickname?: string; name?: string };
  if (typeof d.user_id !== 'number') throw new TechmanaError(502, '/me returned no user_id');
  return {
    userId: d.user_id,
    nickname: (d.nickname ?? '').trim(),
    name: (d.name ?? '').trim(),
  };
}

export function sessionFrom(profile: Profile, tokens: TokenSet): SessionData {
  return {
    sub: String(profile.userId),
    nickname: (profile.nickname || profile.name || 'プレイヤー').slice(0, 20),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}

/* ------------------------------ セーブ ------------------------------ */

/**
 * どの呼び出しも「更新されたセッション」を返す。アクセストークンの
 * 期限が切れていれば裏でリフレッシュするため、呼び出し側は返ってきた
 * session が元と違えば Cookie を貼り直す必要がある。
 */
export interface WithSession<T> {
  session: SessionData;
  /** リフレッシュが起きて Cookie の更新が必要なら true。 */
  refreshed: boolean;
  value: T;
}

export async function readSave(
  session: SessionData,
  slot: string,
): Promise<WithSession<unknown | null>> {
  const t = await usableToken(session);
  const res = await fetch(`${config.techmana.baseUrl}/api/v1/saves/${encodeURIComponent(slot)}`, {
    headers: { Authorization: `Bearer ${t.session.accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { ...t, value: null };
  if (!res.ok) {
    throw new TechmanaError(res.status, `read save failed: ${res.status}`, refreshedOrUndefined(t));
  }
  return { ...t, value: await res.json() };
}

export async function writeSave(
  session: SessionData,
  slot: string,
  payload: unknown,
  saveSeq?: number,
): Promise<WithSession<{ ok: boolean; body: unknown }>> {
  const t = await usableToken(session);
  const serialized = JSON.stringify({ payload, ...(saveSeq ? { save_seq: saveSeq } : {}) });
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVE_BYTES) {
    throw new TechmanaError(413, 'save payload too large', refreshedOrUndefined(t));
  }
  const res = await fetch(`${config.techmana.baseUrl}/api/v1/saves/${encodeURIComponent(slot)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${t.session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: serialized,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ...t, value: { ok: true, body } };
  if (res.status === 409) return { ...t, value: { ok: false, body } };
  throw new TechmanaError(res.status, `write save failed: ${res.status}`, refreshedOrUndefined(t));
}

/* ------------------------------ private ------------------------------ */

/** リフレッシュが起きたときだけセッションを返す。起きていなければ貼り直す必要がない。 */
function refreshedOrUndefined(t: { session: SessionData; refreshed: boolean }): SessionData | undefined {
  return t.refreshed ? t.session : undefined;
}

/**
 * リフレッシュの取りまとめ。
 *
 * テクマナはリフレッシュトークンをローテーションし、**失効済みのものを
 * 再提示すると漏洩とみなしてそのユーザーの全トークンを落とす**
 * (OAuthService::refresh の reuse detection)。
 *
 * トークンをブラウザの Cookie に載せている以上、これは踏みやすい。
 * アクセストークンが切れた状態で GET と PUT が同時に飛べば、両方が同じ
 * 古いリフレッシュトークンを持っている。片方がローテーションを成功させ、
 * もう片方が失効済みを提示し、結果として利用者が完全にログアウトする。
 *
 * そこで
 *   - 同じリフレッシュトークンに対する要求はプロセス内で1本にまとめる
 *   - 成功した結果を短時間だけ覚えておき、Set-Cookie がブラウザに
 *     行き渡る前に届いた「古い Cookie を持つ後続」にも同じ結果を返す
 * この2つでテクマナに二重提示が届かないようにする。
 */
const REFRESH_MEMO_TTL_MS = 5 * 60 * 1000;
const REFRESH_MEMO_MAX = 500;

const refreshInFlight = new Map<string, Promise<TokenSet>>();
const refreshMemo = new Map<string, { at: number; tokens: TokenSet }>();

function memoGet(oldToken: string): TokenSet | null {
  const hit = refreshMemo.get(oldToken);
  if (!hit) return null;
  if (Date.now() - hit.at > REFRESH_MEMO_TTL_MS) {
    refreshMemo.delete(oldToken);
    return null;
  }
  return hit.tokens;
}

function memoPut(oldToken: string, tokens: TokenSet): void {
  // 単調に増えないよう、上限を超えたら一番古いものから捨てる。
  if (refreshMemo.size >= REFRESH_MEMO_MAX) {
    const oldest = refreshMemo.keys().next();
    if (!oldest.done) refreshMemo.delete(oldest.value);
  }
  refreshMemo.set(oldToken, { at: Date.now(), tokens });
}

/** テスト用。プロセス内のリフレッシュ状態を捨てる。 */
export function _resetRefreshStateForTesting(): void {
  refreshInFlight.clear();
  refreshMemo.clear();
}

function refreshOnce(oldToken: string): Promise<TokenSet> {
  const memo = memoGet(oldToken);
  if (memo) return Promise.resolve(memo);

  const running = refreshInFlight.get(oldToken);
  if (running) return running;

  const p = postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.techmana.clientId,
      client_secret: config.techmana.clientSecret,
      refresh_token: oldToken,
    }),
  )
    .then((tokens) => {
      memoPut(oldToken, tokens);
      return tokens;
    })
    .finally(() => {
      refreshInFlight.delete(oldToken);
    });

  refreshInFlight.set(oldToken, p);
  return p;
}

/**
 * 有効なアクセストークンを持つセッションを返す。期限切れならリフレッシュ
 * する。リフレッシュに失敗した場合は 401 を投げ、呼び出し側が Cookie を
 * 消して未連携に戻す。
 */
async function usableToken(session: SessionData): Promise<{ session: SessionData; refreshed: boolean }> {
  if (session.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return { session, refreshed: false };
  }
  if (!session.refreshToken) throw new TechmanaError(401, 'no refresh token');

  let tokens: TokenSet;
  try {
    tokens = await refreshOnce(session.refreshToken);
  } catch {
    // テクマナ側で連携が切られた等。呼び出し側で Cookie を落とす。
    throw new TechmanaError(401, 'refresh failed');
  }
  return {
    session: {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    },
    refreshed: true,
  };
}

async function postToken(body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(`${config.techmana.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new TechmanaError(res.status, `token endpoint ${res.status}: ${detail.slice(0, 200)}`);
  }
  const d = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!d.access_token) throw new TechmanaError(502, 'token response had no access_token');
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? null,
    expiresIn: typeof d.expires_in === 'number' ? d.expires_in : 3600,
    scope: d.scope ?? '',
  };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
