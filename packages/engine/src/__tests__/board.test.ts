import { describe, it, expect } from 'vitest';
import { createEmptyBoard, clearLines, addGarbage, placePiece } from '../board.js';
import type { Board, Piece } from '../types.js';

describe('board', () => {
  it('空盤面の生成', () => {
    const board = createEmptyBoard();
    expect(board.length).toBe(20);
    expect(board[0].length).toBe(10);
    expect(board.every(row => row.every(cell => cell === 0))).toBe(true);
  });

  it('1行揃ったとき正しく消去される', () => {
    const board = createEmptyBoard();
    // 最下行を全て埋める
    for (let c = 0; c < 10; c++) {
      board[19][c] = 1;
    }
    const result = clearLines(board);
    expect(result.linesCleared).toBe(1);
    // 消去後、最下行は空
    expect(result.board[19].every(cell => cell === 0)).toBe(true);
  });

  it('複数行同時消去', () => {
    const board = createEmptyBoard();
    // 最下2行を全て埋める
    for (let c = 0; c < 10; c++) {
      board[18][c] = 2;
      board[19][c] = 3;
    }
    const result = clearLines(board);
    expect(result.linesCleared).toBe(2);
    expect(result.board[18].every(cell => cell === 0)).toBe(true);
    expect(result.board[19].every(cell => cell === 0)).toBe(true);
  });

  it('おじゃまライン追加（各行にランダムな穴が1つ空く）', () => {
    const board = createEmptyBoard();
    const newBoard = addGarbage(board, 2);
    expect(newBoard.length).toBe(20);
    // 最下2行がガーベージ（各行に穴が1つ）
    for (const rowIdx of [18, 19]) {
      const row = newBoard[rowIdx];
      const holes = row.filter(cell => cell === 0).length;
      const filled = row.filter(cell => cell === 8).length;
      expect(holes).toBe(1);
      expect(filled).toBe(9);
    }
  });
});
