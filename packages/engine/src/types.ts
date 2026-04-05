// 盤面
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
// 0=空, 1=I, 2=O, 3=T, 4=S, 5=Z, 6=J, 7=L, 8=おじゃま(gray)

export type Board = Cell[][]; // [row][col], 20行×10列, row0が最上段

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';

export type RotationState = 0 | 1 | 2 | 3;
// 0=spawn, 1=右回転後, 2=180度, 3=左回転後

export interface Piece {
  type: PieceType;
  rotation: RotationState;
  x: number; // 盤面左端からの列オフセット
  y: number; // 盤面上端からの行オフセット（負値あり=出現時）
}

export type Action =
  | 'move_left'
  | 'move_right'
  | 'rotate_cw' // 時計回り
  | 'rotate_ccw' // 反時計回り
  | 'rotate_180'
  | 'soft_drop'
  | 'hard_drop'
  | 'hold';

export type TSpinType = 'none' | 'mini' | 'full';

export interface LineClearResult {
  linesCleared: number;
  tSpin: TSpinType;
  isB2B: boolean; // 前のアクションもTetris or T-spinだったか
  combo: number; // 連続ライン消去数（0始まり）
  isPerfectClear: boolean;
  attackLines: number; // 相手に送るおじゃまライン数
}

export interface GameState {
  board: Board;
  currentPiece: Piece | null;
  holdPiece: PieceType | null;
  holdUsed: boolean; // 同じピースで2回ホールド禁止
  nextQueue: PieceType[]; // 常に5個以上保持
  isGameOver: boolean;
  combo: number;
  b2bActive: boolean; // B2B継続中フラグ
  score: number;
  linesCleared: number;
  level: number; // v1は固定レベル(1)でよい
}

export interface GameConfig {
  seed: number;
  level?: number;
}
