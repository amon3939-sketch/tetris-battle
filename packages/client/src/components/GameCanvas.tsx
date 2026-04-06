import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { Board, Piece } from '@tetris/engine/src/types.ts';
import { PIECE_SHAPES, PIECE_GRID_SIZE, PIECE_CELL } from '@tetris/engine/src/piece.ts';

const CELL_SIZE = 30;
const BOARD_WIDTH = 10 * CELL_SIZE;
const BOARD_HEIGHT = 20 * CELL_SIZE;

export const CELL_COLORS: Record<number, string> = {
  0: '#1a1a2e',
  1: '#00f0f0',   // I: シアン
  2: '#f0f000',   // O: 黄
  3: '#a000f0',   // T: 紫
  4: '#00f000',   // S: 緑
  5: '#f00000',   // Z: 赤
  6: '#0000f0',   // J: 青
  7: '#f0a000',   // L: オレンジ
  8: '#808080',   // おじゃま: グレー
};

function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `rgb(${r},${g},${b})`;
}

function drawTileCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, baseColor: string) {
  const bevel = 3;
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = lighten(baseColor, 60);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + size, y); ctx.lineTo(x + size - bevel, y + bevel); ctx.lineTo(x + bevel, y + bevel);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lighten(baseColor, 40);
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + bevel, y + bevel); ctx.lineTo(x + bevel, y + size - bevel); ctx.lineTo(x, y + size);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = darken(baseColor, 60);
  ctx.beginPath();
  ctx.moveTo(x, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size - bevel, y + size - bevel); ctx.lineTo(x + bevel, y + size - bevel);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = darken(baseColor, 40);
  ctx.beginPath();
  ctx.moveTo(x + size, y); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size - bevel, y + size - bevel); ctx.lineTo(x + size - bevel, y + bevel);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = lighten(baseColor, 20);
  ctx.fillRect(x + bevel, y + bevel, size - bevel * 2, size - bevel * 2);
}

const GHOST_ALPHA = 0.25;

function getPieceCellsForRender(piece: Piece): [number, number][] {
  const shape = PIECE_SHAPES[piece.type];
  const gridSize = PIECE_GRID_SIZE[piece.type];
  let cells = shape.map(([r, c]) => [r, c] as [number, number]);
  for (let i = 0; i < piece.rotation; i++) {
    cells = cells.map(([r, c]) => [c, gridSize - 1 - r]);
  }
  return cells.map(([r, c]) => [r + piece.y, c + piece.x]);
}

function getGhostY(board: Board, piece: Piece): number {
  let y = piece.y;
  while (true) {
    const nextY = y + 1;
    const testCells = getPieceCellsForRender({ ...piece, y: nextY });
    const collision = testCells.some(([r, c]) => {
      if (c < 0 || c >= 10 || r >= 20) return true;
      if (r >= 0 && board[r][c] !== 0) return true;
      return false;
    });
    if (collision) break;
    y = nextY;
  }
  return y;
}

// ========== エフェクト型 ==========
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;   // 0~1
  maxLife: number; // ms
  born: number;
  size: number;
  color: string;
}

interface LineClearEffect {
  rows: number[];
  startTime: number;
  duration: number; // ms (フラッシュ + フェードアウト合計)
}

interface HardDropEffect {
  cells: [number, number][];
  startTime: number;
  duration: number;
}

export interface GameCanvasHandle {
  triggerHardDrop: (cells: [number, number][]) => void;
  triggerLineClear: (rows: number[]) => void;
}

interface Props {
  board: Board | null;
  currentPiece: Piece | null;
  incomingAttack: number;
  isGameOver: boolean;
}

const GameCanvas = forwardRef<GameCanvasHandle, Props>(({ board, currentPiece, incomingAttack, isGameOver }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectsRef = useRef<{
    hardDrops: HardDropEffect[];
    lineClears: LineClearEffect[];
    particles: Particle[];
  }>({ hardDrops: [], lineClears: [], particles: [] });
  const animFrameRef = useRef<number>(0);
  const gameOverStartRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    triggerHardDrop(cells: [number, number][]) {
      const now = performance.now();
      // 着地光エフェクト
      effectsRef.current.hardDrops.push({
        cells,
        startTime: now,
        duration: 250,
      });
      // パーティクルバースト
      for (const [r, c] of cells) {
        if (r < 0 || r >= 20 || c < 0 || c >= 10) continue;
        const cx = c * CELL_SIZE + CELL_SIZE / 2;
        const cy = r * CELL_SIZE + CELL_SIZE / 2;
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI * 2 * i) / 6 + (Math.random() - 0.5) * 0.6;
          const speed = 80 + Math.random() * 120;
          effectsRef.current.particles.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 40, // 上方向バイアス
            life: 1,
            maxLife: 350 + Math.random() * 200,
            born: now,
            size: 2 + Math.random() * 3,
            color: `hsl(${40 + Math.random() * 30}, 100%, ${70 + Math.random() * 20}%)`,
          });
        }
      }
    },
    triggerLineClear(rows: number[]) {
      effectsRef.current.lineClears.push({
        rows,
        startTime: performance.now(),
        duration: 600, // 白フラッシュ+フェードアウト合計
      });
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const now = performance.now();

      // Clear
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

      if (!board) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // ライン消去エフェクト中の行情報を収集
      const clearingRows = new Map<number, { progress: number; startTime: number }>();
      for (const eff of effectsRef.current.lineClears) {
        const elapsed = now - eff.startTime;
        const progress = Math.min(1, elapsed / eff.duration);
        for (const row of eff.rows) {
          clearingRows.set(row, { progress, startTime: eff.startTime });
        }
      }

      // Draw board cells
      for (let r = 0; r < 20; r++) {
        for (let c = 0; c < 10; c++) {
          const cell = board[r][c];
          if (cell === 0) {
            ctx.fillStyle = CELL_COLORS[0];
            ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          } else {
            const baseColor = CELL_COLORS[cell] || CELL_COLORS[0];
            const clearInfo = clearingRows.get(r);
            if (clearInfo) {
              const p = clearInfo.progress;
              // フェーズ1 (0~0.45): 白フラッシュ（行全体が白く光る）~270ms
              // フェーズ2 (0.45~1.0): 右下→左上にフェードアウト
              if (p < 0.45) {
                // 白フラッシュ中はブロックを描いてから白オーバーレイ
                drawTileCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, baseColor);
                // 急速に白くなり、ピークを維持してからフェード
                const t = p / 0.45;
                const flashAlpha = t < 0.3 ? (t / 0.3) * 0.95 : 0.95 - (t - 0.3) * 0.5;
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, flashAlpha)})`;
                ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
              } else {
                // 右下→左上フェードアウト
                const fadeProgress = (p - 0.45) / 0.55; // 0~1
                // セルの「消え度」を対角線に沿って計算 (右下=0, 左上=1 の正規化座標)
                const cellDiag = (c / 9 + (1 - r / 19)) / 2; // 左上=1, 右下=0
                const threshold = fadeProgress * 1.4; // 1.4で少しオーバーシュートさせて全セル消す
                const cellAlpha = Math.max(0, 1 - Math.max(0, threshold - (1 - cellDiag)) * 4);
                if (cellAlpha > 0.01) {
                  ctx.globalAlpha = cellAlpha;
                  drawTileCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, baseColor);
                  // まだ白い残光
                  ctx.fillStyle = `rgba(255, 255, 255, ${cellAlpha * 0.3})`;
                  ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                  ctx.globalAlpha = 1;
                }
              }
            } else {
              drawTileCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, baseColor);
            }
          }
        }
      }

      // Game over gray-out animation (top to bottom, one row at a time)
      if (isGameOver && board) {
        if (!gameOverStartRef.current) {
          gameOverStartRef.current = now;
        }
        const elapsed = now - gameOverStartRef.current;
        const ROW_DELAY = 50; // ms per row
        for (let r = 0; r < 20; r++) {
          const rowStart = r * ROW_DELAY;
          if (elapsed >= rowStart) {
            const rowProgress = Math.min(1, (elapsed - rowStart) / 200); // 200ms fade per row
            const alpha = rowProgress * 0.75;
            ctx.fillStyle = `rgba(60, 60, 60, ${alpha})`;
            ctx.fillRect(0, r * CELL_SIZE, BOARD_WIDTH, CELL_SIZE);
          }
        }
      } else {
        gameOverStartRef.current = null;
      }

      // Draw ghost piece
      if (currentPiece) {
        const ghostY = getGhostY(board, currentPiece);
        if (ghostY !== currentPiece.y) {
          const ghostCells = getPieceCellsForRender({ ...currentPiece, y: ghostY });
          const color = CELL_COLORS[PIECE_CELL[currentPiece.type]] || '#fff';
          ctx.globalAlpha = GHOST_ALPHA;
          for (const [r, c] of ghostCells) {
            if (r >= 0 && r < 20 && c >= 0 && c < 10) {
              ctx.fillStyle = color;
              ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }
          }
          ctx.globalAlpha = 1;
        }

        // Draw current piece
        const pieceCells = getPieceCellsForRender(currentPiece);
        const pieceColor = CELL_COLORS[PIECE_CELL[currentPiece.type]] || '#fff';
        for (const [r, c] of pieceCells) {
          if (r >= 0 && r < 20 && c >= 0 && c < 10) {
            drawTileCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, pieceColor);
          }
        }
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let r = 0; r <= 20; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * CELL_SIZE);
        ctx.lineTo(BOARD_WIDTH, r * CELL_SIZE);
        ctx.stroke();
      }
      for (let c = 0; c <= 10; c++) {
        ctx.beginPath();
        ctx.moveTo(c * CELL_SIZE, 0);
        ctx.lineTo(c * CELL_SIZE, BOARD_HEIGHT);
        ctx.stroke();
      }

      // Hard drop light effects
      for (const eff of effectsRef.current.hardDrops) {
        const elapsed = now - eff.startTime;
        const progress = Math.min(1, elapsed / eff.duration);
        const alpha = (1 - progress) * 0.7;
        const glowSize = progress * 10;

        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = glowSize;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        for (const [r, c] of eff.cells) {
          if (r >= 0 && r < 20 && c >= 0 && c < 10) {
            ctx.fillRect(
              c * CELL_SIZE + 2,
              r * CELL_SIZE + 2,
              CELL_SIZE - 4,
              CELL_SIZE - 4,
            );
          }
        }
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // パーティクル描画（ハードドロップバースト）
      for (const p of effectsRef.current.particles) {
        const elapsed = now - p.born;
        const t = elapsed / p.maxLife;
        if (t >= 1) continue;

        const alpha = 1 - t;
        const dt = elapsed / 1000;
        const px = p.x + p.vx * dt;
        const py = p.y + p.vy * dt + 200 * dt * dt; // 重力

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Incoming attack indicator
      if (incomingAttack > 0) {
        const barHeight = Math.min(incomingAttack, 20) * CELL_SIZE;
        ctx.fillStyle = 'rgba(231, 76, 60, 0.6)';
        ctx.fillRect(0, BOARD_HEIGHT - barHeight, 5, barHeight);
      }

      // Clean up expired effects
      effectsRef.current.hardDrops = effectsRef.current.hardDrops.filter(
        e => now - e.startTime < e.duration
      );
      effectsRef.current.lineClears = effectsRef.current.lineClears.filter(
        e => now - e.startTime < e.duration
      );
      effectsRef.current.particles = effectsRef.current.particles.filter(
        p => now - p.born < p.maxLife
      );

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [board, currentPiece, incomingAttack, isGameOver]);

  return (
    <canvas
      ref={canvasRef}
      width={BOARD_WIDTH}
      height={BOARD_HEIGHT}
      style={{ border: '2px solid #3a3a5c', borderRadius: 4 }}
    />
  );
});

GameCanvas.displayName = 'GameCanvas';
export default GameCanvas;
