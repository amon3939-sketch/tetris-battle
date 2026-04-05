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

export function clearLines(board: Board): { board: Board; linesCleared: number } {
  const remaining = board.filter(row => row.some(cell => cell === 0));
  const linesCleared = ROWS - remaining.length;
  if (linesCleared === 0) return { board, linesCleared: 0 };

  const emptyRows: Board = Array.from({ length: linesCleared }, () =>
    Array(COLS).fill(0) as Cell[]
  );
  return {
    board: [...emptyRows, ...remaining] as Board,
    linesCleared,
  };
}

export function addGarbage(board: Board, lines: number, column: number): Board {
  const newBoard = board.map(row => [...row]) as Board;
  // 上にlines行分スクロール（上の行は消える）
  newBoard.splice(0, lines);
  // 下にガーベージ行を追加
  for (let i = 0; i < lines; i++) {
    const garbageRow = Array(COLS).fill(8 as Cell) as Cell[];
    garbageRow[column] = 0 as Cell; // 穴
    newBoard.push(garbageRow);
  }
  return newBoard;
}

export function isBoardEmpty(board: Board): boolean {
  return board.every(row => row.every(cell => cell === 0));
}
