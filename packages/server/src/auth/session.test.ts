/**
 * セッション Cookie の封入・開封。
 *
 * ここが緩いと「利用者が自分のセッションを書き換えて他人になれる」形の
 * 事故になるため、改竄と鍵違いを明示的に確かめる。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  _resetSessionKeyForTesting,
  cookiesOf,
  open,
  readSession,
  safeEqual,
  seal,
  type SessionData,
} from './session.js';

const SECRET = 'test-secret-test-secret-0123456789';

function session(over: Partial<SessionData> = {}): SessionData {
  return {
    sub: '777',
    nickname: 'テト太郎',
    accessToken: 'a'.repeat(64),
    refreshToken: 'r'.repeat(64),
    expiresAt: Date.now() + 3_600_000,
    ...over,
  };
}

beforeEach(() => {
  _resetSessionKeyForTesting();
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  _resetSessionKeyForTesting();
});

describe('seal / open', () => {
  it('往復して同じ値に戻る', () => {
    const s = session();
    expect(open<SessionData>(seal(s))).toEqual(s);
  });

  it('毎回ちがう暗号文になる(IVが固定されていない)', () => {
    const s = session();
    expect(seal(s)).not.toBe(seal(s));
  });

  it('平文がそのまま覗けない', () => {
    const token = seal(session());
    expect(token).not.toContain('テト太郎');
    expect(token).not.toContain('r'.repeat(64));
  });

  it('1バイト書き換えると開けない', () => {
    const token = seal(session());
    // 末尾を別の文字に差し替える。GCM の認証タグが検出するはず。
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(open(tampered)).toBeNull();
  });

  it('鍵が変わると開けない', () => {
    const token = seal(session());
    _resetSessionKeyForTesting();
    process.env.SESSION_SECRET = 'completely-different-secret-value';
    expect(open(token)).toBeNull();
  });

  it('ゴミ入力で例外を投げずに null を返す', () => {
    for (const bad of ['', 'not-base64!!', 'YWJj', undefined]) {
      expect(open(bad as string | undefined)).toBeNull();
    }
  });
});

describe('readSession', () => {
  it('Cookie ヘッダからセッションを取り出す', () => {
    const token = seal(session());
    const got = readSession(`foo=bar; tetox_session=${encodeURIComponent(token)}; baz=1`);
    expect(got?.sub).toBe('777');
    expect(got?.nickname).toBe('テト太郎');
  });

  it('Cookie が無ければ null', () => {
    expect(readSession(undefined)).toBeNull();
    expect(readSession('other=1')).toBeNull();
  });

  it('sub が無い中身は受け付けない', () => {
    const token = seal({ nickname: 'x' });
    expect(readSession(`tetox_session=${encodeURIComponent(token)}`)).toBeNull();
  });
});

describe('cookiesOf', () => {
  it('値に = が含まれていても壊れない', () => {
    expect(cookiesOf('a=1; b=x=y=z')).toEqual({ a: '1', b: 'x=y=z' });
  });

  it('名前の無い断片を無視する', () => {
    expect(cookiesOf('=novalue; ok=1')).toEqual({ ok: '1' });
  });

  it('空ヘッダで空オブジェクト', () => {
    expect(cookiesOf(undefined)).toEqual({});
    expect(cookiesOf('')).toEqual({});
  });
});

describe('safeEqual', () => {
  it('同じなら true、違えば false', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('長さ違いと空文字は false', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});
