/**
 * /api/auth/techmana/* と /api/sync/* 。
 *
 * ぷにぷにと違い、テトックスはクライアントも同じサーバが配信している。
 * つまり全部同一オリジンなので、
 *   - CORS は関係ない(ブラウザは同一オリジンに CORS を要求しない)
 *   - Cookie は SameSite=Lax で足りる(SameSite=None を使わずに済む)
 *   - クライアントは相対パスで叩ける(APIのベースURLを持たなくてよい)
 *
 * 認可の往復から戻るのはトップレベル遷移なので、Lax でも Cookie は届く。
 */

import express, { type CookieOptions, type Request, type Response, type Router } from 'express';
import { config, techmanaEnabled } from '../config.js';
import {
  PENDING_COOKIE,
  SESSION_COOKIE,
  type PendingAuth,
  type SessionData,
  cookiesOf,
  open,
  readSession,
  safeEqual,
  seal,
} from '../auth/session.js';
import {
  TechmanaError,
  beginAuth,
  exchangeCode,
  fetchProfile,
  readSave,
  sessionFrom,
  writeSave,
} from '../auth/techmana.js';

/** 認可フローの猶予。 */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** テクマナ側のセーブスロット名。1枠しか使わない。 */
const SAVE_SLOT = 'tetox';

export function techmanaRouter(): Router {
  const router = express.Router();

  /** 連携の入口。ブラウザをテクマナの同意画面へ送る。 */
  router.get('/start', (_req, res) => {
    if (!techmanaEnabled()) {
      return res
        .status(503)
        .json({ error: 'TECHMANA_DISABLED', message: 'テクマナ連携は未設定です' });
    }
    const { url, pending } = beginAuth();
    res.cookie(PENDING_COOKIE, seal(pending), { ...cookieOpts(), maxAge: PENDING_TTL_MS });
    res.redirect(url);
  });

  /** テクマナからの戻り先。コードをトークンに換えてセッションを張る。 */
  router.get('/callback', async (req, res) => {
    if (!techmanaEnabled()) return backToClient(res, 'disabled');

    const pending = open<PendingAuth>(cookiesOf(req.headers.cookie)[PENDING_COOKIE]);
    res.clearCookie(PENDING_COOKIE, cookieOpts());
    if (!pending) return backToClient(res, 'expired');

    const err = typeof req.query.error === 'string' ? req.query.error : null;
    if (err) return backToClient(res, err === 'access_denied' ? 'denied' : 'error');

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    // state 照合。攻撃者が用意したコードを踏ませる CSRF を防ぐ。
    if (!code || !safeEqual(state, pending.state)) return backToClient(res, 'state');

    try {
      const tokens = await exchangeCode(code, pending.verifier);
      const profile = await fetchProfile(tokens.accessToken);
      setSession(res, sessionFrom(profile, tokens));
      return backToClient(res, null);
    } catch (e) {
      console.warn('[techmana] callback failed:', (e as Error).message);
      return backToClient(res, 'error');
    }
  });

  /** 連携状態。未ログインでもエラーにせず linked:false を返す。 */
  router.get('/status', (req, res) => {
    const s = readSession(req.headers.cookie);
    res.json({
      enabled: techmanaEnabled(),
      linked: s !== null,
      nickname: s?.nickname ?? null,
      sub: s?.sub ?? null,
    });
  });

  /** 連携解除。Cookie を捨てるだけ。ローカルの設定はそのまま残る。 */
  router.post('/logout', (_req, res) => {
    clearSession(res);
    res.status(204).end();
  });

  return router;
}

/** クラウドセーブ。中身はテクマナ側に置き、ここは中継のみ。 */
export function syncRouter(): Router {
  const router = express.Router();

  router.get('/save', async (req, res) => {
    const session = readSession(req.headers.cookie);
    if (!session) return unauthenticated(res);
    try {
      const out = await readSave(session, SAVE_SLOT);
      if (out.refreshed) setSession(res, out.session);
      if (out.value === null) return res.status(404).json({ error: 'NO_SAVE' });
      res.json(out.value);
    } catch (e) {
      sendError(res, e);
    }
  });

  router.put('/save', async (req, res) => {
    const session = readSession(req.headers.cookie);
    if (!session) return unauthenticated(res);

    const body = (req.body ?? {}) as { payload?: unknown; saveSeq?: unknown };
    if (body.payload === undefined) {
      return res.status(400).json({ error: 'PAYLOAD_REQUIRED', message: 'payload がありません' });
    }
    const saveSeq =
      typeof body.saveSeq === 'number' && Number.isFinite(body.saveSeq) ? body.saveSeq : undefined;

    try {
      const out = await writeSave(session, SAVE_SLOT, body.payload, saveSeq);
      if (out.refreshed) setSession(res, out.session);
      if (!out.value.ok) {
        // 別端末が先に進めていた。上書きせず現状を返す。
        // テクマナ側の body にも error があるので、後から自分のコードを被せる。
        return res.status(409).json({ ...(out.value.body as object), error: 'CONFLICT' });
      }
      res.json(out.value.body);
    } catch (e) {
      sendError(res, e);
    }
  });

  return router;
}

/* ------------------------------- helpers ------------------------------- */

function setSession(res: Response, session: SessionData): void {
  // Cookie の寿命はリフレッシュトークンに合わせる(テクマナ側は60日)。
  res.cookie(SESSION_COOKIE, seal(session), {
    ...cookieOpts(),
    maxAge: 60 * 24 * 60 * 60 * 1000,
  });
}

function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOpts());
}

function unauthenticated(res: Response): void {
  res.status(401).json({ error: 'UNAUTHENTICATED', message: 'テクマナでログインしてください' });
}

function sendError(res: Response, e: unknown): void {
  if (e instanceof TechmanaError) {
    if (e.status === 401) {
      // トークンが死んでいる。Cookie を落として未連携に戻す。
      clearSession(res);
      return void res
        .status(428)
        .json({ error: 'NOT_LINKED', message: 'テクマナ連携が切れています' });
    }
    if (e.status === 413) {
      return void res
        .status(413)
        .json({ error: 'TOO_LARGE', message: 'セーブデータが大きすぎます' });
    }
  }
  console.warn('[techmana] sync failed:', (e as Error).message);
  res.status(502).json({ error: 'SYNC_FAILED', message: 'テクマナと通信できませんでした' });
}

/**
 * ブラウザをゲーム画面へ返す。結果はクエリで伝え、SPA 側が読んだあと
 * URL から消す。
 */
function backToClient(res: Response, error: string | null): void {
  const base = config.clientBaseUrl || '/';
  const q = new URLSearchParams({ techmana: error ? 'error' : 'ok' });
  if (error) q.set('reason', error);
  // 既定は相対パス。同一オリジン配信なので絶対URLを組む必要がない。
  const sep = base.includes('?') ? '&' : '?';
  res.redirect(`${base}${sep}${q}`);
}

/**
 * 同一オリジンなので SameSite=Lax で足りる。認可の戻りはトップレベル
 * 遷移なので Lax でも Cookie は送られる。
 */
function cookieOpts(): CookieOptions {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: config.cookieSecure,
  };
}
