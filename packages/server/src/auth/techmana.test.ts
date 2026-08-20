/**
 * リフレッシュの取りまとめ。
 *
 * テクマナは失効済みリフレッシュトークンの再提示を「漏洩」とみなし、
 * そのユーザーの全トークンを落とす。トークンをブラウザの Cookie に
 * 載せている以上、同時に飛んだ2本が同じ古いトークンを持つ状況は普通に
 * 起きる。二重提示がテクマナへ届かないことを直接確かめる。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _resetRefreshStateForTesting, readSave, writeSave, TechmanaError } from './techmana.js';
import type { SessionData } from './session.js';

function expiredSession(over: Partial<SessionData> = {}): SessionData {
  return {
    sub: '777',
    nickname: 'テト太郎',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    // 既に切れている
    expiresAt: Date.now() - 60_000,
    ...over,
  };
}

function liveSession(): SessionData {
  return { ...expiredSession(), accessToken: 'live-access', expiresAt: Date.now() + 3_600_000 };
}

/** 呼ばれた URL を記録しつつ、決められた応答を返す fetch。 */
function stubFetch(handler: (url: string, init?: RequestInit) => [number, unknown]) {
  const calls: Array<{ url: string; body: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      const [status, body] = handler(String(url), init);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  _resetRefreshStateForTesting();
  process.env.TECHMANA_CLIENT_ID = 'tetox';
  process.env.TECHMANA_CLIENT_SECRET = 'secret';
  process.env.TECHMANA_REDIRECT_URI = 'https://example.test/api/auth/techmana/callback';
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetRefreshStateForTesting();
});

describe('トークンのリフレッシュ', () => {
  it('期限内なら余計な通信をしない', async () => {
    const calls = stubFetch(() => [200, { slot: 'tetox', payload: {}, save_seq: 1 }]);
    const out = await readSave(liveSession(), 'tetox');
    expect(out.refreshed).toBe(false);
    // セーブ取得の1回だけ。/oauth/token は叩かれない。
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/api/v1/saves/');
  });

  it('期限切れなら更新してから叩き、更新後のトークンを使う', async () => {
    const calls = stubFetch((url) =>
      url.includes('/oauth/token')
        ? [200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }]
        : [200, { slot: 'tetox', payload: { a: 1 }, save_seq: 3 }],
    );
    const out = await readSave(expiredSession(), 'tetox');
    expect(out.refreshed).toBe(true);
    expect(out.session.accessToken).toBe('new-access');
    expect(out.session.refreshToken).toBe('new-refresh');
    expect(calls[0]?.url).toContain('/oauth/token');
    expect(calls[1]?.url).toContain('/api/v1/saves/');
  });

  it('同時に走った2本が同じ古いトークンを二重提示しない', async () => {
    let tokenCalls = 0;
    stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        tokenCalls += 1;
        // 2回目が来た時点で本番なら全トークン失効。ここでは数えるだけ。
        return [200, { access_token: `new-${tokenCalls}`, refresh_token: 'rotated', expires_in: 3600 }];
      }
      return [200, { slot: 'tetox', payload: {}, save_seq: 1 }];
    });

    const s = expiredSession();
    const [a, b] = await Promise.all([readSave(s, 'tetox'), writeSave(s, 'tetox', { x: 1 }, 2)]);

    expect(tokenCalls).toBe(1);
    // 両方が同じ新トークンを見ている
    expect(a.session.accessToken).toBe('new-1');
    expect(b.session.accessToken).toBe('new-1');
  });

  it('先に終わった更新の結果を、古い Cookie を持つ後続にも配る', async () => {
    let tokenCalls = 0;
    stubFetch((url) => {
      if (url.includes('/oauth/token')) {
        tokenCalls += 1;
        return [200, { access_token: `new-${tokenCalls}`, refresh_token: 'rotated', expires_in: 3600 }];
      }
      return [200, { slot: 'tetox', payload: {}, save_seq: 1 }];
    });

    // 1本目が完了しても、ブラウザにはまだ新しい Cookie が届いていない。
    await readSave(expiredSession(), 'tetox');
    const later = await readSave(expiredSession(), 'tetox');

    expect(tokenCalls).toBe(1);
    expect(later.session.accessToken).toBe('new-1');
  });

  it('更新に失敗したら 401 を投げる(呼び出し側が Cookie を落とす)', async () => {
    stubFetch(() => [400, { error: 'invalid_grant' }]);
    await expect(readSave(expiredSession(), 'tetox')).rejects.toMatchObject({ status: 401 });
  });

  it('リフレッシュトークンが無ければ更新を試みない', async () => {
    const calls = stubFetch(() => [200, {}]);
    await expect(readSave(expiredSession({ refreshToken: null }), 'tetox')).rejects.toBeInstanceOf(
      TechmanaError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('リフレッシュ直後の失敗', () => {
  it('API が落ちても、回した新トークンを例外に載せて返す', async () => {
    // これを落とすと、ブラウザは古いリフレッシュトークンを持ち続け、
    // 次の要求で消費済みを再提示してテクマナに全トークンを失効させられる。
    stubFetch((url) =>
      url.includes('/oauth/token')
        ? [200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }]
        : [500, { error: 'boom' }],
    );
    await expect(readSave(expiredSession(), 'tetox')).rejects.toMatchObject({
      status: 500,
      session: { accessToken: 'new-access', refreshToken: 'new-refresh' },
    });
  });

  it('大きすぎて送らなかった場合も、回した新トークンは返す', async () => {
    stubFetch(() => [200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }]);
    await expect(
      writeSave(expiredSession(), 'tetox', { blob: 'x'.repeat(1_100_000) }, 2),
    ).rejects.toMatchObject({ status: 413, session: { accessToken: 'new-access' } });
  });

  it('リフレッシュしていなければ session は付けない(貼り直す必要が無い)', async () => {
    stubFetch(() => [500, { error: 'boom' }]);
    await expect(readSave(liveSession(), 'tetox')).rejects.toMatchObject({ status: 500 });
    await readSave(liveSession(), 'tetox').catch((e) => {
      expect(e.session).toBeUndefined();
    });
  });
});

describe('セーブ', () => {
  it('存在しないスロットは null', async () => {
    stubFetch(() => [404, { error: 'not_found' }]);
    const out = await readSave(liveSession(), 'tetox');
    expect(out.value).toBeNull();
  });

  it('競合は例外ではなく ok:false で返す', async () => {
    stubFetch(() => [409, { error: 'stale_save', current: { save_seq: 9 } }]);
    const out = await writeSave(liveSession(), 'tetox', { a: 1 }, 2);
    expect(out.value.ok).toBe(false);
    expect(out.value.body).toMatchObject({ current: { save_seq: 9 } });
  });

  it('大きすぎるペイロードは送信前に弾く', async () => {
    const calls = stubFetch(() => [200, { ok: true }]);
    await expect(
      writeSave(liveSession(), 'tetox', { blob: 'x'.repeat(1_100_000) }, 2),
    ).rejects.toMatchObject({ status: 413 });
    expect(calls).toHaveLength(0);
  });

  it('save_seq を指定どおり送る', async () => {
    const calls = stubFetch(() => [200, { ok: true, save_seq: 5 }]);
    await writeSave(liveSession(), 'tetox', { a: 1 }, 5);
    expect(JSON.parse(calls[0]!.body)).toEqual({ payload: { a: 1 }, save_seq: 5 });
  });
});
