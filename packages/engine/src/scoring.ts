import { type TSpinType, type LineClearResult } from './types.js';

// Comboテーブル: index 0から [0,0,1,1,2,2,3,3,4,4,4,5,5,5,...] で5以上は全て5
const COMBO_TABLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5];

function getComboAttack(combo: number): number {
  if (combo < 0) return 0;
  if (combo >= COMBO_TABLE.length) return 5;
  return COMBO_TABLE[combo];
}

export function calculateLineClear(
  linesCleared: number,
  tSpin: TSpinType,
  combo: number,
  b2bActive: boolean,
  isPerfectClear: boolean,
  clearedRows: number[] = [],
): LineClearResult {
  if (linesCleared === 0 && tSpin === 'none') {
    return {
      linesCleared: 0,
      tSpin: 'none',
      isB2B: false,
      combo: -1,
      isPerfectClear: false,
      attackLines: 0,
      clearedRows: [],
    };
  }

  // 今回のアクションがB2B対象か（Tetris or T-spin）
  const isBTBAction = linesCleared === 4 || (tSpin !== 'none' && linesCleared > 0);
  // T-spin (0 lines) もB2B対象とする
  const isBTBActionFull = linesCleared === 4 || tSpin !== 'none';

  const isB2B = b2bActive && isBTBActionFull;

  // 基本スコア計算
  let baseScore = 0;
  if (tSpin === 'none') {
    // 通常ライン消去
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
      case 2: baseScore = 400; break; // mini double (rare)
    }
  } else {
    // full T-spin
    switch (linesCleared) {
      case 0: baseScore = 400; break;
      case 1: baseScore = 800; break;
      case 2: baseScore = 1200; break;
      case 3: baseScore = 1600; break;
    }
  }

  // Perfect Clear スコア上書き
  if (isPerfectClear && linesCleared > 0) {
    switch (linesCleared) {
      case 1: baseScore = 800; break;
      case 2: baseScore = 1200; break;
      case 3: baseScore = 1800; break;
      case 4: baseScore = 2000; break;
    }
  }

  // B2Bボーナス（1.5倍）
  let score = baseScore;
  if (isB2B) {
    score = Math.floor(baseScore * 1.5);
  }

  // コンボボーナス
  const newCombo = linesCleared > 0 ? combo + 1 : -1;
  if (linesCleared > 0 && newCombo > 0) {
    score += 50 * newCombo;
  }

  // 攻撃ライン計算
  let attackLines = 0;
  if (tSpin === 'none') {
    switch (linesCleared) {
      case 1: attackLines = 0; break;
      case 2: attackLines = 1; break;
      case 3: attackLines = 2; break;
      case 4: attackLines = 4; break;
    }
  } else if (tSpin === 'mini') {
    attackLines = 0; // mini T-spin: 0 attack
  } else {
    // full T-spin
    switch (linesCleared) {
      case 0: attackLines = 0; break;
      case 1: attackLines = 2; break;
      case 2: attackLines = 4; break;
      case 3: attackLines = 6; break;
    }
  }

  // Perfect Clear: +10
  if (isPerfectClear && linesCleared > 0) {
    attackLines += 10;
  }

  // B2Bボーナス: +1（Tetris or T-spin時）
  if (isB2B) {
    attackLines += 1;
  }

  // Comboボーナス
  if (linesCleared > 0 && newCombo > 0) {
    attackLines += getComboAttack(newCombo);
  }

  return {
    linesCleared,
    tSpin,
    isB2B,
    combo: newCombo,
    isPerfectClear: isPerfectClear && linesCleared > 0,
    attackLines,
    clearedRows,
  };
}
