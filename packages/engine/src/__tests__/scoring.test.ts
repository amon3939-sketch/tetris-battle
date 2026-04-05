import { describe, it, expect } from 'vitest';
import { calculateLineClear } from '../scoring.js';

describe('scoring', () => {
  it('TetrisのスコアとattackLines', () => {
    const result = calculateLineClear(4, 'none', -1, false, false);
    expect(result.linesCleared).toBe(4);
    expect(result.attackLines).toBe(4);
    expect(result.tSpin).toBe('none');
  });

  it('T-spin doubleのスコアとattackLines', () => {
    const result = calculateLineClear(2, 'full', -1, false, false);
    expect(result.linesCleared).toBe(2);
    expect(result.attackLines).toBe(4);
    expect(result.tSpin).toBe('full');
  });

  it('B2B Tetris のスコア（1.5倍 + attackLines +1）', () => {
    // b2bActive=true, Tetris
    const result = calculateLineClear(4, 'none', -1, true, false);
    expect(result.isB2B).toBe(true);
    // 攻撃ライン: 4 (Tetris base) + 1 (B2B) = 5
    expect(result.attackLines).toBe(5);
  });

  it('Combo 3連続のattackLines', () => {
    // combo=2 → 新combo=3
    // comboテーブル[3] = 1
    const result = calculateLineClear(1, 'none', 2, false, false);
    expect(result.combo).toBe(3);
    // Single=0 + combo attack=1
    expect(result.attackLines).toBe(1);
  });

  it('Perfect Clear のattackLines加算', () => {
    // Tetris + Perfect Clear
    const result = calculateLineClear(4, 'none', -1, false, true);
    expect(result.isPerfectClear).toBe(true);
    // 4 (Tetris) + 10 (PC) = 14
    expect(result.attackLines).toBe(14);
  });
});
