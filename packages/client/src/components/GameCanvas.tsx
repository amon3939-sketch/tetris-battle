import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { Board, Piece } from '@tetris/engine/src/types.ts';
import { PIECE_SHAPES, PIECE_GRID_SIZE, PIECE_CELL } from '@tetris/engine/src/piece.ts';

const CELL_SIZE = 30;
const BOARD_WIDTH = 10 * CELL_SIZE;
const BOARD_HEIGHT = 20 * CELL_SIZE;

export const CELL_COLORS: Record<number, string> = {
  0: '#0a0e1a',
  1: '#00f0f0',   // I: シアン
  2: '#f0f000',   // O: 黄
  3: '#a000f0',   // T: 紫
  4: '#00f000',   // S: 緑
  5: '#f00000',   // Z: 赤
  6: '#0000f0',   // J: 青
  7: '#f0a000',   // L: オレンジ
  8: '#808080',   // おじゃま: グレー
};

// Glossy version colors (lighter center)
const CELL_GLOSS: Record<number, string> = {
  1: '#66ffff',
  2: '#ffff66',
  3: '#cc66ff',
  4: '#66ff66',
  5: '#ff6666',
  6: '#6666ff',
  7: '#ffcc66',
  8: '#b0b0b0',
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

/** TETRIS 99 style glossy block with shine highlight */
function drawGlossyCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, cellType: number) {
  const baseColor = CELL_COLORS[cellType] || CELL_COLORS[0];
  const glossColor = CELL_GLOSS[cellType] || baseColor;
  const bevel = 3;
  const pad = 1; // gap between cells

  const cx = x + pad;
  const cy = y + pad;
  const s = size - pad * 2;

  // Outer bevel (lighter top-left, darker bottom-right)
  // Top edge
  ctx.fillStyle = lighten(baseColor, 80);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + s, cy);
  ctx.lineTo(cx + s - bevel, cy + bevel);
  ctx.lineTo(cx + bevel, cy + bevel);
  ctx.closePath();
  ctx.fill();

  // Left edge
  ctx.fillStyle = lighten(baseColor, 50);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + bevel, cy + bevel);
  ctx.lineTo(cx + bevel, cy + s - bevel);
  ctx.lineTo(cx, cy + s);
  ctx.closePath();
  ctx.fill();

  // Bottom edge
  ctx.fillStyle = darken(baseColor, 70);
  ctx.beginPath();
  ctx.moveTo(cx, cy + s);
  ctx.lineTo(cx + s, cy + s);
  ctx.lineTo(cx + s - bevel, cy + s - bevel);
  ctx.lineTo(cx + bevel, cy + s - bevel);
  ctx.closePath();
  ctx.fill();

  // Right edge
  ctx.fillStyle = darken(baseColor, 50);
  ctx.beginPath();
  ctx.moveTo(cx + s, cy);
  ctx.lineTo(cx + s, cy + s);
  ctx.lineTo(cx + s - bevel, cy + s - bevel);
  ctx.lineTo(cx + s - bevel, cy + bevel);
  ctx.closePath();
  ctx.fill();

  // Inner face with gradient (glossy effect)
  const innerX = cx + bevel;
  const innerY = cy + bevel;
  const innerS = s - bevel * 2;
  const grad = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerS);
  grad.addColorStop(0, glossColor);
  grad.addColorStop(0.4, baseColor);
  grad.addColorStop(1, darken(baseColor, 30));
  ctx.fillStyle = grad;
  ctx.fillRect(innerX, innerY, innerS, innerS);

  // Shine highlight (top-left corner reflection)
  const shineGrad = ctx.createRadialGradient(
    cx + s * 0.3, cy + s * 0.25, 0,
    cx + s * 0.3, cy + s * 0.25, s * 0.5
  );
  shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
  shineGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
  shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = shineGrad;
  ctx.fillRect(cx + bevel, cy + bevel, innerS, innerS * 0.6);
}

/** Empty cell with subtle grid */
function drawEmptyCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = 'rgba(0, 15, 40, 0.6)';
  ctx.fillRect(x, y, size, size);
  // Subtle border
  ctx.strokeStyle = 'rgba(0, 100, 180, 0.08)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
}

const GHOST_ALPHA = 0.35;

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
  life: number;
  maxLife: number;
  born: number;
  size: number;
  color: string;
}

interface LineClearEffect {
  rows: number[];
  startTime: number;
  duration: number;
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
  collisionCells?: [number, number][];
}

const GameCanvas = forwardRef<GameCanvasHandle, Props>(({ board, currentPiece, incomingAttack, isGameOver, collisionCells }, ref) => {
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
      effectsRef.current.hardDrops.push({
        cells,
        startTime: now,
        duration: 250,
      });
      for (const [r, c] of cells) {
        if (r < 0 || r >= 20 || c < 0 || c >= 10) continue;
        const cx = c * CELL_SIZE + CELL_SIZE / 2;
        const cy = r * CELL_SIZE + CELL_SIZE / 2;
        for (let i = 0; i < 8; i++) {
          const angle = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.5;
          const speed = 100 + Math.random() * 140;
          effectsRef.current.particles.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 60,
            life: 1,
            maxLife: 400 + Math.random() * 250,
            born: now,
            size: 2 + Math.random() * 3.5,
            color: `hsl(${190 + Math.random() * 30}, 100%, ${70 + Math.random() * 25}%)`,
          });
        }
      }
    },
    triggerLineClear(rows: number[]) {
      const now = performance.now();
      effectsRef.current.lineClears.push({
        rows,
        startTime: now,
        duration: 700,
      });
      // Line clear particles
      for (const row of rows) {
        for (let c = 0; c < 10; c++) {
          const cx = c * CELL_SIZE + CELL_SIZE / 2;
          const cy = row * CELL_SIZE + CELL_SIZE / 2;
          for (let i = 0; i < 3; i++) {
            effectsRef.current.particles.push({
              x: cx,
              y: cy,
              vx: (Math.random() - 0.5) * 200,
              vy: -60 - Math.random() * 100,
              life: 1,
              maxLife: 500 + Math.random() * 300,
              born: now,
              size: 1.5 + Math.random() * 2,
              color: `hsl(${190 + Math.random() * 40}, 100%, ${80 + Math.random() * 15}%)`,
            });
          }
        }
      }
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const now = performance.now();

      // Clear with deep blue/dark background
      ctx.fillStyle = 'rgba(0, 8, 20, 0.95)';
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

      if (!board) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      // Draw board cells
      for (let r = 0; r < 20; r++) {
        for (let c = 0; c < 10; c++) {
          const cell = board[r][c];
          if (cell === 0) {
            drawEmptyCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE);
          } else {
            drawGlossyCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, cell);
          }
        }
      }

      // ライン消去エフェクト
      for (const eff of effectsRef.current.lineClears) {
        const elapsed = now - eff.startTime;
        const p = Math.min(1, elapsed / eff.duration);
        for (const row of eff.rows) {
          if (row < 0 || row >= 20) continue;
          const y = row * CELL_SIZE;
          if (p < 0.3) {
            // Flash phase - bright cyan/white
            const t = p / 0.3;
            const flashAlpha = t < 0.3 ? (t / 0.3) * 0.95 : 0.95 * (1 - (t - 0.3) / 0.7);
            ctx.fillStyle = `rgba(100, 220, 255, ${Math.max(0, flashAlpha)})`;
            ctx.fillRect(0, y, BOARD_WIDTH, CELL_SIZE);
            // Add white core
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, flashAlpha * 0.6)})`;
            ctx.fillRect(0, y + CELL_SIZE * 0.2, BOARD_WIDTH, CELL_SIZE * 0.6);
          } else {
            // Fade out
            const fadeProgress = (p - 0.3) / 0.7;
            const alpha = (1 - fadeProgress) * 0.4;
            if (alpha > 0.01) {
              ctx.fillStyle = `rgba(100, 220, 255, ${alpha})`;
              ctx.fillRect(0, y, BOARD_WIDTH, CELL_SIZE);
            }
          }
        }
      }

      // Game over gray-out + collision highlight
      if (isGameOver && board) {
        if (!gameOverStartRef.current) {
          gameOverStartRef.current = now;
        }
        const elapsed = now - gameOverStartRef.current;
        const ROW_DELAY = 40;
        for (let r = 0; r < 20; r++) {
          const rowStart = r * ROW_DELAY;
          if (elapsed >= rowStart) {
            const rowProgress = Math.min(1, (elapsed - rowStart) / 200);
            const alpha = rowProgress * 0.7;
            ctx.fillStyle = `rgba(20, 20, 40, ${alpha})`;
            ctx.fillRect(0, r * CELL_SIZE, BOARD_WIDTH, CELL_SIZE);
          }
        }

        // Collision cells highlight (blinking red)
        if (collisionCells && collisionCells.length > 0 && elapsed > 300) {
          const blinkPhase = Math.sin((now - gameOverStartRef.current) * 0.008) * 0.5 + 0.5;
          for (const [r, c] of collisionCells) {
            if (r >= 0 && r < 20 && c >= 0 && c < 10) {
              ctx.fillStyle = `rgba(255, 30, 30, ${0.3 + blinkPhase * 0.5})`;
              ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
              ctx.strokeStyle = `rgba(255, 100, 100, ${0.5 + blinkPhase * 0.5})`;
              ctx.lineWidth = 2;
              ctx.strokeRect(c * CELL_SIZE + 1, r * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            }
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
          for (const [r, c] of ghostCells) {
            if (r >= 0 && r < 20 && c >= 0 && c < 10) {
              const x = c * CELL_SIZE;
              const y = r * CELL_SIZE;
              ctx.globalAlpha = GHOST_ALPHA;
              ctx.fillStyle = color;
              ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
              ctx.globalAlpha = 0.6;
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.strokeRect(x + 2, y + 2, CELL_SIZE - 4, CELL_SIZE - 4);
              ctx.globalAlpha = 1;
            }
          }
        }

        // Draw current piece (glossy)
        const pieceCells = getPieceCellsForRender(currentPiece);
        const cellType = PIECE_CELL[currentPiece.type];
        for (const [r, c] of pieceCells) {
          if (r >= 0 && r < 20 && c >= 0 && c < 10) {
            drawGlossyCell(ctx, c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, cellType);
          }
        }
      }

      // Hard drop light effects (cyan glow)
      for (const eff of effectsRef.current.hardDrops) {
        const elapsed = now - eff.startTime;
        const progress = Math.min(1, elapsed / eff.duration);
        const alpha = (1 - progress) * 0.8;
        const glowSize = progress * 12;

        ctx.shadowColor = 'rgba(0, 200, 255, 0.9)';
        ctx.shadowBlur = glowSize;
        ctx.fillStyle = `rgba(150, 230, 255, ${alpha})`;
        for (const [r, c] of eff.cells) {
          if (r >= 0 && r < 20 && c >= 0 && c < 10) {
            ctx.fillRect(c * CELL_SIZE + 2, r * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
          }
        }
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Particles
      for (const p of effectsRef.current.particles) {
        const elapsed = now - p.born;
        const t = elapsed / p.maxLife;
        if (t >= 1) continue;

        const alpha = 1 - t;
        const dt = elapsed / 1000;
        const px = p.x + p.vx * dt;
        const py = p.y + p.vy * dt + 200 * dt * dt;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(px, py, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Incoming attack indicator (right side, red bar)
      if (incomingAttack > 0) {
        const barHeight = Math.min(incomingAttack, 20) * CELL_SIZE;
        const gradient = ctx.createLinearGradient(BOARD_WIDTH - 6, BOARD_HEIGHT - barHeight, BOARD_WIDTH - 6, BOARD_HEIGHT);
        gradient.addColorStop(0, 'rgba(255, 80, 50, 0.9)');
        gradient.addColorStop(1, 'rgba(255, 30, 30, 0.9)');
        ctx.fillStyle = gradient;
        ctx.fillRect(BOARD_WIDTH - 6, BOARD_HEIGHT - barHeight, 5, barHeight);
        // Glow
        ctx.shadowColor = 'rgba(255, 50, 30, 0.7)';
        ctx.shadowBlur = 10;
        ctx.fillRect(BOARD_WIDTH - 6, BOARD_HEIGHT - barHeight, 5, barHeight);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
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
  }, [board, currentPiece, incomingAttack, isGameOver, collisionCells]);

  return (
    <canvas
      ref={canvasRef}
      width={BOARD_WIDTH}
      height={BOARD_HEIGHT}
      style={{ display: 'block', borderRadius: 4 }}
    />
  );
});

GameCanvas.displayName = 'GameCanvas';
export default GameCanvas;
