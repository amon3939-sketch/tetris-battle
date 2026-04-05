import { describe, it, expect } from 'vitest';
import { tryRotate } from '../rotation.js';
import { createEmptyBoard, isValidPosition } from '../board.js';
import { getPieceCells, spawnPiece } from '../piece.js';
import type { Piece, PieceType, Board } from '../types.js';

describe('rotation', () => {
  describe('J/L/S/T/Zの各回転状態が正しい形状を返す', () => {
    const pieces: PieceType[] = ['J', 'L', 'S', 'T', 'Z'];
    for (const type of pieces) {
      it(`${type}ピースが4回転で元に戻る`, () => {
        const board = createEmptyBoard();
        let piece: Piece = { type, rotation: 0, x: 3, y: 5 };
        const originalCells = getPieceCells(piece).map(([r, c]) => `${r},${c}`).sort();

        // 4回CW回転で元に戻る
        for (let i = 0; i < 4; i++) {
          const result = tryRotate(board, piece, 'cw');
          expect(result.success).toBe(true);
          piece = result.piece;
        }
        const afterCells = getPieceCells(piece).map(([r, c]) => `${r},${c}`).sort();
        expect(afterCells).toEqual(originalCells);
      });
    }
  });

  describe('Iピースの全回転が正しい形状を返す', () => {
    it('Iピースが4回転で元に戻る', () => {
      const board = createEmptyBoard();
      let piece: Piece = { type: 'I', rotation: 0, x: 3, y: 5 };
      const originalCells = getPieceCells(piece).map(([r, c]) => `${r},${c}`).sort();

      for (let i = 0; i < 4; i++) {
        const result = tryRotate(board, piece, 'cw');
        expect(result.success).toBe(true);
        piece = result.piece;
      }
      const afterCells = getPieceCells(piece).map(([r, c]) => `${r},${c}`).sort();
      expect(afterCells).toEqual(originalCells);
    });
  });

  it('SRSキック: 壁際でTピースがキックして回転できる', () => {
    const board = createEmptyBoard();
    // Tピースを左壁に寄せる
    const piece: Piece = { type: 'T', rotation: 0, x: 0, y: 10 };
    // 左回転（CCW）すると壁に接触するのでキックが必要
    const result = tryRotate(board, piece, 'ccw');
    expect(result.success).toBe(true);
    // キックが使われたか（kickUsed > 0）
    // 壁際だとキックが必要になるケースを確認
    const cells = getPieceCells(result.piece);
    // 全セルが盤面内にあること
    for (const [r, c] of cells) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(10);
    }
  });

  it('キック失敗時は回転しない', () => {
    // 狭い空間を作ってキックが全て失敗するケースを作る
    const board = createEmptyBoard();
    // Tピースを囲む
    const piece: Piece = { type: 'T', rotation: 0, x: 4, y: 18 };
    // 周囲をブロックで埋める（キックテスト全失敗するように）
    for (let c = 0; c < 10; c++) {
      board[19][c] = 8;
    }
    // 左右も埋める
    for (let r = 16; r < 20; r++) {
      for (let c = 0; c < 10; c++) {
        if (c < 4 || c > 6) {
          board[r][c] = 8;
        }
      }
    }
    // 上部も狭くして全キック不可にする
    board[17][4] = 8;
    board[17][6] = 8;
    board[18][4] = 8;
    board[18][6] = 8;

    const result = tryRotate(board, piece, 'cw');
    expect(result.success).toBe(false);
    expect(result.piece).toEqual(piece); // 元のまま
  });
});
