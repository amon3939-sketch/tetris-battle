import { type PieceType, type Cell, type Piece } from './types.js';

// 各ピースの形状定義（rotation=0時のセル座標 [row, col]）
// グリッドサイズ: I=4×4, O=4×4(2×2使用), 他=3×3
export const PIECE_SHAPES: Record<PieceType, [number, number][]> = {
  I: [[1, 0], [1, 1], [1, 2], [1, 3]],
  O: [[0, 0], [0, 1], [1, 0], [1, 1]],
  T: [[0, 1], [1, 0], [1, 1], [1, 2]],
  S: [[0, 1], [0, 2], [1, 0], [1, 1]],
  Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
  J: [[0, 0], [1, 0], [1, 1], [1, 2]],
  L: [[0, 2], [1, 0], [1, 1], [1, 2]],
};

// ピースカラー対応（Cell値）
export const PIECE_CELL: Record<PieceType, Cell> = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
};

// グリッドサイズ
export const PIECE_GRID_SIZE: Record<PieceType, number> = {
  I: 4,
  O: 2,
  T: 3,
  S: 3,
  Z: 3,
  J: 3,
  L: 3,
};

// スポーン位置
export function spawnPiece(type: PieceType): Piece {
  return {
    type,
    rotation: 0,
    x: 3,
    y: -1,
  };
}

// ピースのセル座標を盤面座標に変換
export function getPieceCells(piece: Piece): [number, number][] {
  const shape = PIECE_SHAPES[piece.type];
  const gridSize = PIECE_GRID_SIZE[piece.type];

  let cells = shape.map(([r, c]) => [r, c] as [number, number]);

  // 回転適用
  for (let i = 0; i < piece.rotation; i++) {
    cells = cells.map(([r, c]) => [c, gridSize - 1 - r]);
  }

  // 盤面座標に変換
  return cells.map(([r, c]) => [r + piece.y, c + piece.x]);
}
