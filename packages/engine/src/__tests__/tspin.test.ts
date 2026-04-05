import { describe, it, expect } from 'vitest';
import { detectTSpin } from '../rotation.js';
import { createEmptyBoard } from '../board.js';
import type { Piece, Board } from '../types.js';

function makeBoard(setup: [number, number][]): Board {
  const board = createEmptyBoard();
  for (const [r, c] of setup) {
    board[r][c] = 8;
  }
  return board;
}

describe('T-spin判定', () => {
  it('T-spin double の標準ケース（3コーナー充足、フロント2隅埋まり）', () => {
    // Tピースが rotation=2（下向き）で固定
    // 中心は (y+1, x+1)
    // rotation=2: front corners = 左下、右下
    const piece: Piece = { type: 'T', rotation: 2, x: 4, y: 15 };
    // 中心: (16, 5)
    // 4隅: 左上(15,4), 右上(15,6), 左下(17,4), 右下(17,6)
    // front corners (rotation=2): 左下(17,4), 右下(17,6)
    const board = makeBoard([
      [17, 4], [17, 6], // front corners
      [15, 4], // back corner (1つ)
      // 3隅が埋まっている
    ]);
    const result = detectTSpin(board, piece, 0);
    expect(result).toBe('full');
  });

  it('ミニT-spinの判定（バック2隅のみ＋1フロント）', () => {
    // rotation=0: front corners = 左上、右上
    // back corners = 左下、右下
    const piece: Piece = { type: 'T', rotation: 0, x: 4, y: 15 };
    // 中心: (16, 5)
    // 4隅: 左上(15,4), 右上(15,6), 左下(17,4), 右下(17,6)
    // front = 左上(15,4), 右上(15,6)
    // back = 左下(17,4), 右下(17,6)
    // フロント片方 + バック2つ = 3コーナー → mini
    const board = makeBoard([
      [15, 4], // front 1つだけ
      [17, 4], [17, 6], // back 2つ
    ]);
    const result = detectTSpin(board, piece, 0);
    expect(result).toBe('mini');
  });

  it('T-spin判定されないケース（3コーナー未満）', () => {
    const piece: Piece = { type: 'T', rotation: 0, x: 4, y: 15 };
    // 2隅しか埋まっていない
    const board = makeBoard([
      [15, 4], [17, 4],
    ]);
    const result = detectTSpin(board, piece, 0);
    expect(result).toBe('none');
  });
});
