/**
 * クラウドセーブのマージ/正規化テスト。
 *
 * ここを間違えると「壊れた」ではなく「静かに記録が消えた」という形で
 * 出るため、直接テストしておく。
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_BEST,
  SAVE_VERSION,
  type SavePayload,
  mergePayloads,
  normalizePayload,
  recordMatch,
} from './save.js';

function payload(over: Partial<SavePayload> = {}): SavePayload {
  return {
    v: SAVE_VERSION,
    nickname: 'テト太郎',
    keymap: { ArrowLeft: 'move_left' },
    bgmVol: 35,
    seVol: 60,
    best: { ...EMPTY_BEST },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('mergePayloads', () => {
  it('自己ベストはそれぞれ大きい方を残す', () => {
    const a = payload({
      best: { bestScore: 9000, bestLines: 12, totalLines: 300, totalMatches: 20, totalWins: 8 },
    });
    const b = payload({
      best: { bestScore: 1200, bestLines: 40, totalLines: 900, totalMatches: 50, totalWins: 30 },
    });
    const m = mergePayloads(a, b);
    expect(m.best.bestScore).toBe(9000);
    expect(m.best.bestLines).toBe(40);
    expect(m.best.totalLines).toBe(900);
    expect(m.best.totalMatches).toBe(50);
  });

  it('勝利数が試合数を超えない', () => {
    // 端末Aは勝ち数だけ多く、端末Bは試合数だけ多い。素朴に max を取ると
    // 勝率が 100% を超える。
    const a = payload({ best: { ...EMPTY_BEST, totalMatches: 3, totalWins: 3 } });
    const b = payload({ best: { ...EMPTY_BEST, totalMatches: 10, totalWins: 1 } });
    const m = mergePayloads(a, b);
    expect(m.best.totalWins).toBeLessThanOrEqual(m.best.totalMatches);
  });

  it('設定は最後に更新した側が勝つ', () => {
    const older = payload({ bgmVol: 10, seVol: 10, updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = payload({ bgmVol: 90, seVol: 80, updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(mergePayloads(older, newer).bgmVol).toBe(90);
    // 引数の順ではなく更新時刻で決まる
    expect(mergePayloads(newer, older).bgmVol).toBe(90);
  });

  it('空のニックネームで既存の名前を消さない', () => {
    const named = payload({ nickname: 'テト太郎', updatedAt: '2026-01-01T00:00:00.000Z' });
    const blank = payload({ nickname: '', updatedAt: '2026-02-01T00:00:00.000Z' });
    // 新しい側が空でも、名前は残る
    expect(mergePayloads(named, blank).nickname).toBe('テト太郎');
  });

  it('空のキー配置で既存の割当を消さない', () => {
    const bound = payload({ keymap: { ArrowLeft: 'move_left' }, updatedAt: '2026-01-01T00:00:00.000Z' });
    const empty = payload({ keymap: {}, updatedAt: '2026-02-01T00:00:00.000Z' });
    expect(mergePayloads(bound, empty).keymap).toEqual({ ArrowLeft: 'move_left' });
  });
});

describe('recordMatch', () => {
  it('ベストは max、累計は加算', () => {
    const first = recordMatch(EMPTY_BEST, { score: 500, lines: 4, won: true });
    expect(first).toEqual({
      bestScore: 500, bestLines: 4, totalLines: 4, totalMatches: 1, totalWins: 1,
    });
    const second = recordMatch(first, { score: 100, lines: 9, won: false });
    expect(second.bestScore).toBe(500);
    expect(second.bestLines).toBe(9);
    expect(second.totalLines).toBe(13);
    expect(second.totalMatches).toBe(2);
    expect(second.totalWins).toBe(1);
  });
});

describe('normalizePayload', () => {
  it('オブジェクト以外は拒否する', () => {
    expect(normalizePayload(null)).toBeNull();
    expect(normalizePayload('nope')).toBeNull();
    expect(normalizePayload(7)).toBeNull();
  });

  it('壊れた項目は既定値に落とす', () => {
    const out = normalizePayload({ bgmVol: 'loud', seVol: 999, keymap: [1, 2], best: 'x' });
    expect(out?.bgmVol).toBe(35);
    expect(out?.seVol).toBe(100); // 0..100 にクランプ
    expect(out?.keymap).toEqual({});
    expect(out?.best).toEqual(EMPTY_BEST);
  });

  it('自分が作ったペイロードをそのまま復元できる', () => {
    const p = payload({
      nickname: 'あ',
      keymap: { ArrowUp: 'hard_drop', ' ': 'rotate_cw' },
      bgmVol: 0,
      seVol: 100,
      best: { bestScore: 1, bestLines: 2, totalLines: 3, totalMatches: 4, totalWins: 2 },
    });
    expect(normalizePayload(p)).toEqual(p);
  });

  it('負の記録値を0に丸める', () => {
    const out = normalizePayload({ best: { bestScore: -5, totalMatches: -1 } });
    expect(out?.best.bestScore).toBe(0);
    expect(out?.best.totalMatches).toBe(0);
  });
});
