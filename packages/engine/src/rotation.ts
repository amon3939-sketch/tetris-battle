import { type Board, type Piece, type RotationState, type TSpinType } from './types.js';
import { PIECE_SHAPES, PIECE_GRID_SIZE, getPieceCells } from './piece.js';
import { isValidPosition } from './board.js';

// キックオフセットの符号: (row_offset, col_offset)。rowは下向きが正。

// J, L, S, T, Z ピース（3×3グリッド）のキックテーブル
const KICK_TABLE_JLSTZ: Record<string, [number, number][]> = {
  '0->1': [[0, 0], [-1, 0], [-1, +1], [0, -2], [-1, -2]],
  '1->0': [[0, 0], [+1, 0], [+1, -1], [0, +2], [+1, +2]],
  '1->2': [[0, 0], [+1, 0], [+1, -1], [0, +2], [+1, +2]],
  '2->1': [[0, 0], [-1, 0], [-1, +1], [0, -2], [-1, -2]],
  '2->3': [[0, 0], [+1, 0], [+1, +1], [0, -2], [+1, -2]],
  '3->2': [[0, 0], [-1, 0], [-1, -1], [0, +2], [-1, +2]],
  '3->0': [[0, 0], [-1, 0], [-1, -1], [0, +2], [-1, +2]],
  '0->3': [[0, 0], [+1, 0], [+1, +1], [0, -2], [+1, -2]],
};

// I ピース（4×4グリッド）のキックテーブル
const KICK_TABLE_I: Record<string, [number, number][]> = {
  '0->1': [[0, 0], [-2, 0], [+1, 0], [-2, -1], [+1, +2]],
  '1->0': [[0, 0], [+2, 0], [-1, 0], [+2, +1], [-1, -2]],
  '1->2': [[0, 0], [-1, 0], [+2, 0], [-1, +2], [+2, -1]],
  '2->1': [[0, 0], [+1, 0], [-2, 0], [+1, -2], [-2, +1]],
  '2->3': [[0, 0], [+2, 0], [-1, 0], [+2, +1], [-1, -2]],
  '3->2': [[0, 0], [-2, 0], [+1, 0], [-2, -1], [+1, +2]],
  '3->0': [[0, 0], [+1, 0], [-2, 0], [+1, -2], [-2, +1]],
  '0->3': [[0, 0], [-1, 0], [+2, 0], [-1, +2], [+2, -1]],
};

function getNewRotation(current: RotationState, direction: 'cw' | 'ccw' | '180'): RotationState {
  if (direction === 'cw') return ((current + 1) % 4) as RotationState;
  if (direction === 'ccw') return ((current + 3) % 4) as RotationState;
  return ((current + 2) % 4) as RotationState;
}

export function tryRotate(
  board: Board,
  piece: Piece,
  direction: 'cw' | 'ccw' | '180'
): { success: boolean; piece: Piece; kickUsed: number } {
  const newRotation = getNewRotation(piece.rotation, direction);

  // O ピースはキックなし（常に成功）
  if (piece.type === 'O') {
    return {
      success: true,
      piece: { ...piece, rotation: newRotation },
      kickUsed: 0,
    };
  }

  const key = `${piece.rotation}->${newRotation}`;
  const kickTable = piece.type === 'I' ? KICK_TABLE_I : KICK_TABLE_JLSTZ;

  // 180度回転の場合、キックテーブルにないのでオフセット(0,0)のみ試す
  if (direction === '180') {
    const testPiece: Piece = { ...piece, rotation: newRotation };
    if (isValidPosition(board, testPiece)) {
      return { success: true, piece: testPiece, kickUsed: 0 };
    }
    return { success: false, piece, kickUsed: -1 };
  }

  const offsets = kickTable[key];
  if (!offsets) {
    return { success: false, piece, kickUsed: -1 };
  }

  for (let i = 0; i < offsets.length; i++) {
    const [rowOff, colOff] = offsets[i];
    const testPiece: Piece = {
      ...piece,
      rotation: newRotation,
      y: piece.y + rowOff,
      x: piece.x + colOff,
    };
    if (isValidPosition(board, testPiece)) {
      return { success: true, piece: testPiece, kickUsed: i };
    }
  }

  return { success: false, piece, kickUsed: -1 };
}

// T-spin判定（3-corner rule）
export function detectTSpin(board: Board, piece: Piece, kickUsed: number): TSpinType {
  if (piece.type !== 'T') return 'none';

  // Tピースの中心座標
  // rotation=0: T形状は [[0,1],[1,0],[1,1],[1,2]], 中心は[1,1]
  // グリッド中心は常に(1,1) for 3x3
  const centerR = piece.y + 1;
  const centerC = piece.x + 1;

  // 4隅の座標
  const corners: [number, number][] = [
    [centerR - 1, centerC - 1], // 左上
    [centerR - 1, centerC + 1], // 右上
    [centerR + 1, centerC - 1], // 左下
    [centerR + 1, centerC + 1], // 右下
  ];

  const isOccupied = (r: number, c: number): boolean => {
    if (r < 0 || r >= 20 || c < 0 || c >= 10) return true; // 壁は占有扱い
    return board[r][c] !== 0;
  };

  const occupiedCorners = corners.filter(([r, c]) => isOccupied(r, c)).length;

  if (occupiedCorners < 3) return 'none';

  // フロントコーナーの判定（Tピースが向いている方向の2隅）
  // rotation=0: 上向き → front corners = 左上、右上
  // rotation=1: 右向き → front corners = 右上、右下
  // rotation=2: 下向き → front corners = 左下、右下
  // rotation=3: 左向き → front corners = 左上、左下
  let frontCorners: [number, number][];
  switch (piece.rotation) {
    case 0: frontCorners = [corners[0], corners[1]]; break; // 上向き
    case 1: frontCorners = [corners[1], corners[3]]; break; // 右向き
    case 2: frontCorners = [corners[2], corners[3]]; break; // 下向き
    case 3: frontCorners = [corners[0], corners[2]]; break; // 左向き
  }

  // キック4番（テーブルの5番目、index=4）を使った場合は強制フル
  if (kickUsed === 4) return 'full';

  // フロントコーナーが両方埋まっている場合はフル
  if (frontCorners.every(([r, c]) => isOccupied(r, c))) return 'full';

  return 'mini';
}
