/**
 * 同定キーの名前空間。
 *
 * events.ts はゲストの申告値を `guest:` に押し込む。押し込まないと
 * ゲストが `tm:777` を名乗り、ログイン済みの人のランキング行に
 * 書き込めてしまう（db.ts の getOrCreatePlayer は fingerprint の
 * 文字列一致だけで行を引き当て、ニックネームまで上書きする）。
 *
 * events.ts の該当箇所と同じ式をここで直接確かめる。
 */

import { describe, it, expect } from 'vitest';

/** events.ts のゲスト側と同じ正規化。 */
function guestKey(fingerprint: unknown, socketId: string): string {
  const raw = String(fingerprint ?? '').replace(/[^0-9a-f]/gi, '').slice(0, 32);
  return `guest:${raw || socketId}`;
}

describe('ゲストの同定キー', () => {
  it('tm: 名前空間を名乗れない', () => {
    const key = guestKey('tm:777', 'sock1');
    expect(key.startsWith('tm:')).toBe(false);
    expect(key).toBe('guest:777');
  });

  it('コロンや記号を持ち込めない', () => {
    expect(guestKey('a:b/c..d', 'sock1')).toBe('guest:abcd');
  });

  it('普通の16進 fingerprint はそのまま通る', () => {
    expect(guestKey('1a2b3c4d', 'sock1')).toBe('guest:1a2b3c4d');
  });

  it('空や非文字列は socket.id に落ちる（衝突させない）', () => {
    expect(guestKey('', 'sock1')).toBe('guest:sock1');
    expect(guestKey(undefined, 'sock2')).toBe('guest:sock2');
    expect(guestKey('!!!!', 'sock3')).toBe('guest:sock3');
  });

  it('長すぎる入力を切り詰める', () => {
    expect(guestKey('a'.repeat(200), 'sock1')).toBe(`guest:${'a'.repeat(32)}`);
  });

  it('ログイン済みキーとゲストキーは決して衝突しない', () => {
    const account = 'tm:777';
    for (const attempt of ['tm:777', 'TM:777', 'tm777', '777', ':::777']) {
      expect(guestKey(attempt, 'sock')).not.toBe(account);
    }
  });
});
