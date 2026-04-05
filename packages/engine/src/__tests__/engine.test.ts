import { describe, it, expect } from 'vitest';
import { GameEngine } from '../engine.js';

describe('engine', () => {
  it('ハードドロップで即固定される', () => {
    const engine = new GameEngine({ seed: 42 });
    const stateBefore = engine.getState();
    expect(stateBefore.currentPiece).not.toBeNull();

    engine.applyAction('hard_drop');
    const stateAfter = engine.getState();
    // ハードドロップ後、新しいピースがスポーンされている
    expect(stateAfter.currentPiece).not.toBeNull();
    // 盤面にブロックが固定されている
    const hasBlocks = stateAfter.board.some(row => row.some(cell => cell !== 0));
    expect(hasBlocks).toBe(true);
  });

  it('Lock delay 15回リセット後に強制固定', () => {
    const engine = new GameEngine({ seed: 42 });

    // ピースをソフトドロップで着地させる
    for (let i = 0; i < 25; i++) {
      engine.applyAction('soft_drop');
    }

    // 着地後に移動を繰り返してリセットを使い切る
    for (let i = 0; i < 16; i++) {
      // 少し時間を経過させてgroundedにする
      engine.tick(10);
      // 左右に交互に移動してリセットを消費
      engine.applyAction(i % 2 === 0 ? 'move_left' : 'move_right');
    }

    // 15回リセット消費後、tickで固定される
    // lockResets >= MAX_LOCK_RESETS の状態でlock delay経過で固定
    engine.tick(600);

    const state = engine.getState();
    // 固定されて新しいピースがスポーンされている
    const hasBlocks = state.board.some(row => row.some(cell => cell !== 0));
    expect(hasBlocks).toBe(true);
  });

  it('ホールドで手持ちピースと入れ替わる', () => {
    const engine = new GameEngine({ seed: 42 });
    const firstPiece = engine.getState().currentPiece!.type;

    engine.applyAction('hold');
    const stateAfterHold = engine.getState();
    expect(stateAfterHold.holdPiece).toBe(firstPiece);
    // 新しいピースがスポーンされている
    expect(stateAfterHold.currentPiece).not.toBeNull();
  });

  it('同じターンに2回ホールドできない', () => {
    const engine = new GameEngine({ seed: 42 });

    engine.applyAction('hold');
    const stateAfterFirst = engine.getState();
    const pieceAfterFirst = stateAfterFirst.currentPiece!.type;

    // 2回目のホールドは無視される
    engine.applyAction('hold');
    const stateAfterSecond = engine.getState();
    expect(stateAfterSecond.currentPiece!.type).toBe(pieceAfterFirst);
  });

  it('ゲームオーバー判定（スポーン位置ブロック）', () => {
    const engine = new GameEngine({ seed: 42 });

    // 盤面上部をブロックで埋めてゲームオーバーにする
    // ハードドロップを繰り返す
    let gameOver = false;
    for (let i = 0; i < 200; i++) {
      engine.applyAction('hard_drop');
      if (engine.getState().isGameOver) {
        gameOver = true;
        break;
      }
    }
    expect(gameOver).toBe(true);
  });
});
