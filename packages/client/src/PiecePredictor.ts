/**
 * PiecePredictor: クライアント側のピース位置予測
 *
 * GameEngineは使わない。isValidPosition + tryRotateのみを使い、
 * 移動/回転の視覚的な即時反映を行う。
 * ロック・ライン消去・スポーン・ホールド等のゲームロジックは一切含まない。
 */
import type { Board, Piece, Action } from '@tetris/engine/src/types.ts';
import { isValidPosition } from '@tetris/engine/src/board.ts';
import { tryRotate } from '@tetris/engine/src/rotation.ts';

export class PiecePredictor {
  private board: Board;
  private piece: Piece | null = null;
  // サーバー確認済みのピース状態
  private confirmedPiece: Piece | null = null;
  // 未確認アクション（seqで追跡）
  private pendingActions: { action: Action; seq: number }[] = [];

  constructor() {
    this.board = Array.from({ length: 20 }, () => Array(10).fill(0)) as Board;
  }

  /** サーバーからの状態を反映 */
  onServerState(board: Board, piece: Piece | null, ackSeq: number): void {
    this.board = board;
    this.confirmedPiece = piece ? { ...piece } : null;

    // ackSeq以下のpendingActionsを消す
    if (ackSeq >= 0) {
      this.pendingActions = this.pendingActions.filter(a => a.seq > ackSeq);
    }

    // サーバー確認済みピースから未確認アクションを再適用
    this.reconcile();
  }

  /** 楽観的にアクションを適用（move/rotate/soft_dropのみ） */
  applyOptimistic(action: Action, seq: number): void {
    if (!this.piece) return;
    const moved = this.applyMovement(this.piece, action);
    if (moved) {
      this.piece = moved;
      this.pendingActions.push({ action, seq });
    }
  }

  /** 現在のピース位置（表示用） */
  getPiece(): Piece | null {
    return this.piece;
  }

  /** ゴーストピース計算 */
  getGhostPiece(): Piece | null {
    if (!this.piece) return null;
    let ghost = { ...this.piece };
    while (isValidPosition(this.board, { ...ghost, y: ghost.y + 1 })) {
      ghost = { ...ghost, y: ghost.y + 1 };
    }
    return ghost;
  }

  /** 新しいピースがスポーンされた（サーバーから） */
  resetPiece(piece: Piece | null): void {
    this.piece = piece ? { ...piece } : null;
    this.confirmedPiece = piece ? { ...piece } : null;
    this.pendingActions = [];
  }

  private reconcile(): void {
    // サーバー確認済みピースをベースに未確認アクションを再適用
    let piece = this.confirmedPiece ? { ...this.confirmedPiece } : null;
    if (!piece) {
      this.piece = null;
      return;
    }

    for (const { action } of this.pendingActions) {
      const moved = this.applyMovement(piece, action);
      if (moved) {
        piece = moved;
      }
    }
    this.piece = piece;
  }

  private applyMovement(piece: Piece, action: Action): Piece | null {
    switch (action) {
      case 'move_left': {
        const moved = { ...piece, x: piece.x - 1 };
        return isValidPosition(this.board, moved) ? moved : null;
      }
      case 'move_right': {
        const moved = { ...piece, x: piece.x + 1 };
        return isValidPosition(this.board, moved) ? moved : null;
      }
      case 'soft_drop': {
        const moved = { ...piece, y: piece.y + 1 };
        return isValidPosition(this.board, moved) ? moved : null;
      }
      case 'rotate_cw':
      case 'rotate_ccw':
      case 'rotate_180': {
        const dir = action === 'rotate_cw' ? 'cw' : action === 'rotate_ccw' ? 'ccw' : '180';
        const result = tryRotate(this.board, piece, dir);
        return result.success ? result.piece : null;
      }
      default:
        return null;
    }
  }
}
