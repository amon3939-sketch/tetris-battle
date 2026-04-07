import { type Board, type Cell, type Piece } from './types.js';
import { getPieceCells, PIECE_CELL } from './piece.js';

const ROWS = 20;
const COLS = 10;

export function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0) as Cell[]);
}

export function isValidPosition(board: Board, piece: Piece): boolean {
  const cells = getPieceCells(piece);
  for (const [r, c] of cells) {
    // 列は盤面内であること
    if (c < 0 || c >= COLS) return false;
    // 行は盤面下端を超えないこと
    if (r >= ROWS) return false;
    // 盤面内（r >= 0）なら衝突チェック
    if (r >= 0 && board[r][c] !== 0) return false;
  }
  return true;
}

export function placePiece(board: Board, piece: Piece): Board {
  const newBoard = board.map(row => [...row]) as Board;
  const cells = getPieceCells(piece);
  const cellValue = PIECE_CELL[piece.type];
  for (const [r, c] of cells) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      newBoard[r][c] = cellValue;
    }
  }
  return newBoard;
}

export function clearLines(board: Board): { board: Board; linesCleared: number; clearedRows: number[] } {
  const clearedRows: number[] = [];
  const remaining: Cell[][] = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r].every(cell => cell !== 0)) {
      clearedRows.push(r);
    } else {
      remaining.push(board[r]);
    }
  }
  const linesCleared = clearedRows.length;
  if (linesCleared === 0) return { board, linesCleared: 0, clearedRows: [] };

  const emptyRows: Board = Array.from({ length: linesCleared }, () =>
    Array(COLS).fill(0) as Cell[]
  );
  return {
    board: [...emptyRows, ...remaining] as Board,
    linesCleared,
    clearedRows,
  };
}

/**
 * ガーベージ行を追加する。
 * @param board 現在のボード
 * @param lines 追加する行数
 * @param holes 各行の穴位置（省略時はランダム生成）。サーバーが生成しクライアントに送ることで同期を保つ。
 * @returns 新しいボードと生成された穴位置
 */
export function addGarbage(board: Board, lines: number, holes?: number[]): { board: Board; holes: number[] } {
  const newBoard = board.map(row => [...row]) as Board;
  // 上にlines行分スクロール（上の行は消える）
  newBoard.splice(0, lines);
  // 穴位置を決定（渡されなければランダム生成）
  const actualHoles: number[] = [];
  for (let i = 0; i < lines; i++) {
    const hole = holes?.[i] ?? Math.floor(Math.random() * COLS);
    actualHoles.push(hole);
    const garbageRow = Array(COLS).fill(8 as Cell) as Cell[];
    garbageRow[hole] = 0 as Cell;
    newBoard.push(garbageRow);
  }
  return { board: newBoard as Board, holes: actualHoles };
}

export function isBoardEmpty(board: Board): boolean {
  return board.every(row => row.every(cell => cell === 0));
}
