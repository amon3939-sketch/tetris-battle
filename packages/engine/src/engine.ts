import {
  type Action,
  type Board,
  type GameConfig,
  type GameState,
  type LineClearResult,
  type Piece,
  type PieceType,
} from './types.js';
import { createEmptyBoard, isValidPosition, placePiece, clearLines, addGarbage, isBoardEmpty } from './board.js';
import { spawnPiece, getPieceCells } from './piece.js';
import { tryRotate, detectTSpin } from './rotation.js';
import { SevenBag } from './randomizer.js';
import { calculateLineClear } from './scoring.js';

const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
const NEXT_QUEUE_SIZE = 5;

/** Gravity interval (ms) per level, indexed by level (1-based). Level 11+ uses index 11. */
const GRAVITY_TABLE: Record<number, number> = {
  1: 1000,
  2: 793,
  3: 618,
  4: 473,
  5: 355,
  6: 262,
  7: 190,
  8: 135,
  9: 94,
  10: 64,
  11: 48,
};

export class GameEngine {
  private board: Board;
  private currentPiece: Piece | null = null;
  private holdPiece: PieceType | null = null;
  private holdUsed = false;
  private nextQueue: PieceType[] = [];
  private isGameOver = false;
  private combo = -1;
  private b2bActive = false;
  private score = 0;
  private totalLinesCleared = 0;
  private level: number;
  private bag: SevenBag;

  // Lock delay state
  private lockTimer = 0;
  private isGrounded = false;
  private lockResets = 0;

  // Gravity
  private gravityTimer = 0;
  private gravityInterval = 1000; // ms per cell drop (level 1 = 1 second)

  // T-spin tracking
  private lastKickUsed = -1;
  private lastActionWasRotation = false;

  // Pending garbage (holes: サーバーが指定した穴位置。未指定ならランダム)
  private pendingGarbage: { lines: number; holes?: number[] }[] = [];

  // Pause state
  private paused = false;

  constructor(config: GameConfig) {
    this.level = config.level ?? 1;
    this.bag = new SevenBag(config.seed);
    this.board = createEmptyBoard();
    this.updateGravity();
    this.fillNextQueue();
    this.spawnNextPiece();
  }

  /** Recalculate level and gravity interval based on totalLinesCleared. */
  private updateGravity(): void {
    this.level = Math.floor(this.totalLinesCleared / 10) + 1;
    const cappedLevel = Math.min(this.level, 11);
    this.gravityInterval = GRAVITY_TABLE[cappedLevel];
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private fillNextQueue(): void {
    while (this.nextQueue.length < NEXT_QUEUE_SIZE + 1) {
      this.nextQueue.push(this.bag.next());
    }
  }

  private spawnNextPiece(): boolean {
    this.fillNextQueue();
    const nextType = this.nextQueue.shift()!;
    this.fillNextQueue();
    const piece = spawnPiece(nextType);

    // ゲームオーバー判定：スポーン位置のブロックが既存ブロックと完全に重なる場合のみ
    // ピースの全セルがボード内かつ全て衝突している場合にゲームオーバー
    if (!isValidPosition(this.board, piece)) {
      this.isGameOver = true;
      this.currentPiece = null;
      return false;
    }

    this.currentPiece = piece;
    this.holdUsed = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.isGrounded = false;
    this.lastKickUsed = -1;
    this.lastActionWasRotation = false;
    return true;
  }

  private checkGrounded(): boolean {
    if (!this.currentPiece) return false;
    const below: Piece = { ...this.currentPiece, y: this.currentPiece.y + 1 };
    return !isValidPosition(this.board, below);
  }

  private resetLockDelay(): void {
    if (this.isGrounded && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  private lockPiece(): LineClearResult | null {
    if (!this.currentPiece) return null;

    // T-spin判定
    const tSpin = this.lastActionWasRotation
      ? detectTSpin(this.board, this.currentPiece, this.lastKickUsed)
      : 'none';

    // ピースを盤面に固定
    this.board = placePiece(this.board, this.currentPiece);

    // ライン消去
    const { board: newBoard, linesCleared, clearedRows } = clearLines(this.board);
    this.board = newBoard;

    // Perfect Clear判定
    const isPerfectClear = linesCleared > 0 && isBoardEmpty(this.board);

    // スコア計算
    const result = calculateLineClear(
      linesCleared,
      tSpin,
      this.combo,
      this.b2bActive,
      isPerfectClear,
      clearedRows,
    );

    // 状態更新
    this.score += result.linesCleared > 0 ? this.calculateScore(result) : 0;
    this.totalLinesCleared += linesCleared;
    this.updateGravity();
    this.combo = result.combo;

    // B2B更新
    if (linesCleared > 0) {
      const isBTBAction = linesCleared === 4 || tSpin !== 'none';
      if (isBTBAction) {
        this.b2bActive = true;
      } else {
        this.b2bActive = false;
      }
    }

    // おじゃま処理（ボード上部のブロックが押し出されても即ゲームオーバーにはしない。
    // 次のピースがスポーンできない場合にのみゲームオーバーとなる）
    for (const garbage of this.pendingGarbage) {
      const garbageResult = addGarbage(this.board, garbage.lines, garbage.holes);
      this.board = garbageResult.board;
    }
    this.pendingGarbage = [];

    // 次のピースをスポーン
    this.spawnNextPiece();

    return result;
  }

  private calculateScore(result: LineClearResult): number {
    // スコアはcalculateLineClearで計算済みのattackLinesではなく、
    // 直接scoring.tsのロジックに基づく
    // ここではresultからスコアを再計算するのではなく、
    // calculateLineClearの戻り値を信頼する
    // ただしLineClearResultにはscoreフィールドがないので、ここで計算する

    let baseScore = 0;
    const { linesCleared, tSpin, isB2B, combo, isPerfectClear } = result;

    if (tSpin === 'none') {
      switch (linesCleared) {
        case 1: baseScore = 100; break;
        case 2: baseScore = 300; break;
        case 3: baseScore = 500; break;
        case 4: baseScore = 800; break;
      }
    } else if (tSpin === 'mini') {
      switch (linesCleared) {
        case 0: baseScore = 100; break;
        case 1: baseScore = 200; break;
      }
    } else {
      switch (linesCleared) {
        case 0: baseScore = 400; break;
        case 1: baseScore = 800; break;
        case 2: baseScore = 1200; break;
        case 3: baseScore = 1600; break;
      }
    }

    if (isPerfectClear) {
      switch (linesCleared) {
        case 1: baseScore = 800; break;
        case 2: baseScore = 1200; break;
        case 3: baseScore = 1800; break;
        case 4: baseScore = 2000; break;
      }
    }

    let score = baseScore;
    if (isB2B) {
      score = Math.floor(baseScore * 1.5);
    }

    if (combo > 0) {
      score += 50 * combo;
    }

    return score;
  }

  applyAction(action: Action): LineClearResult | null {
    if (this.paused) return null;
    if (this.isGameOver || !this.currentPiece) return null;

    switch (action) {
      case 'move_left': {
        const moved: Piece = { ...this.currentPiece, x: this.currentPiece.x - 1 };
        if (isValidPosition(this.board, moved)) {
          this.currentPiece = moved;
          this.lastActionWasRotation = false;
          this.resetLockDelay();
        }
        return null;
      }
      case 'move_right': {
        const moved: Piece = { ...this.currentPiece, x: this.currentPiece.x + 1 };
        if (isValidPosition(this.board, moved)) {
          this.currentPiece = moved;
          this.lastActionWasRotation = false;
          this.resetLockDelay();
        }
        return null;
      }
      case 'rotate_cw':
      case 'rotate_ccw':
      case 'rotate_180': {
        const dir = action === 'rotate_cw' ? 'cw' : action === 'rotate_ccw' ? 'ccw' : '180';
        const result = tryRotate(this.board, this.currentPiece, dir);
        if (result.success) {
          this.currentPiece = result.piece;
          this.lastKickUsed = result.kickUsed;
          this.lastActionWasRotation = true;
          this.resetLockDelay();
        }
        return null;
      }
      case 'soft_drop': {
        const moved: Piece = { ...this.currentPiece, y: this.currentPiece.y + 1 };
        if (isValidPosition(this.board, moved)) {
          this.currentPiece = moved;
          this.lastActionWasRotation = false;
        }
        return null;
      }
      case 'hard_drop': {
        // ゴースト位置まで落とす
        this.currentPiece = this.getGhostPieceInternal();
        return this.lockPiece();
      }
      case 'hold': {
        if (this.holdUsed) return null;
        const currentType = this.currentPiece.type;
        if (this.holdPiece) {
          const swapType = this.holdPiece;
          this.holdPiece = currentType;
          const swapPiece = spawnPiece(swapType);
          if (isValidPosition(this.board, swapPiece)) {
            this.currentPiece = swapPiece;
          } else {
            // 配置できない → ゲームオーバー
            this.isGameOver = true;
            this.currentPiece = null;
          }
        } else {
          this.holdPiece = currentType;
          this.spawnNextPiece();
        }
        this.holdUsed = true;
        this.lockTimer = 0;
        this.lockResets = 0;
        this.isGrounded = false;
        this.lastActionWasRotation = false;
        return null;
      }
    }
  }

  tick(deltaMs: number): LineClearResult | null {
    if (this.paused) return null;
    if (this.isGameOver || !this.currentPiece) return null;

    const grounded = this.checkGrounded();

    if (grounded) {
      if (!this.isGrounded) {
        this.isGrounded = true;
        this.lockTimer = 0;
      }
      this.lockTimer += deltaMs;
      if (this.lockTimer >= LOCK_DELAY_MS || this.lockResets >= MAX_LOCK_RESETS) {
        if (this.lockTimer >= LOCK_DELAY_MS) {
          return this.lockPiece();
        }
      }
    } else {
      this.isGrounded = false;
      this.lockTimer = 0;

      // Gravity: ピースを自然落下させる
      this.gravityTimer += deltaMs;
      if (this.gravityTimer >= this.gravityInterval) {
        this.gravityTimer -= this.gravityInterval;
        const moved: Piece = { ...this.currentPiece, y: this.currentPiece.y + 1 };
        if (isValidPosition(this.board, moved)) {
          this.currentPiece = moved;
          this.lastActionWasRotation = false;
        }
      }
    }

    return null;
  }

  getState(): GameState {
    return {
      board: this.board.map(row => [...row]) as Board,
      currentPiece: this.currentPiece ? { ...this.currentPiece } : null,
      holdPiece: this.holdPiece,
      holdUsed: this.holdUsed,
      nextQueue: [...this.nextQueue.slice(0, NEXT_QUEUE_SIZE)],
      isGameOver: this.isGameOver,
      combo: this.combo,
      b2bActive: this.b2bActive,
      score: this.score,
      linesCleared: this.totalLinesCleared,
      level: this.level,
    };
  }

  private getGhostPieceInternal(): Piece {
    if (!this.currentPiece) return spawnPiece('T'); // fallback
    let ghost = { ...this.currentPiece };
    while (isValidPosition(this.board, { ...ghost, y: ghost.y + 1 })) {
      ghost = { ...ghost, y: ghost.y + 1 };
    }
    return ghost;
  }

  getGhostPiece(): Piece {
    return this.getGhostPieceInternal();
  }

  receiveGarbage(lines: number, holes?: number[]): void {
    this.pendingGarbage.push({ lines, holes });
  }

  /**
   * サーバーの権威的ボード状態でローカルエンジンを同期する。
   * ボード（確定済みブロック）とホールド/ネクストを同期し、
   * 操作中ピースのみローカルを維持（即時レスポンス）。
   */
  syncFromServer(serverState: {
    board: Board;
    holdPiece: PieceType | null;
    holdUsed: boolean;
    nextQueue: PieceType[];
    isGameOver: boolean;
    currentPiece: Piece | null;
  }): void {
    // ボード（確定ブロック）を同期
    this.board = serverState.board.map(row => [...row]) as Board;
    // ホールド/ネクスト同期
    this.holdPiece = serverState.holdPiece;
    this.holdUsed = serverState.holdUsed;
    // ※ ゲームオーバーはローカルエンジンのスポーン判定でのみ決定（サーバーからの同期はしない）
    // 操作中ピースが大きくズレている場合はサーバーに合わせる
    // （ピースタイプが違う＝別のピースになっている場合）
    if (serverState.currentPiece && this.currentPiece) {
      if (serverState.currentPiece.type !== this.currentPiece.type) {
        this.currentPiece = { ...serverState.currentPiece };
      }
    } else if (serverState.currentPiece && !this.currentPiece) {
      this.currentPiece = { ...serverState.currentPiece };
    }
  }
}
