import { useRef, useEffect } from 'react';
import type { PieceType } from '@tetris/engine/src/types.ts';
import { PIECE_SHAPES, PIECE_CELL } from '@tetris/engine/src/piece.ts';
import { CELL_COLORS } from './GameCanvas.tsx';

const CELL_SIZE = 24;

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

function drawMiniGlossy(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, baseColor: string) {
  const bevel = 2;
  const pad = 1;
  const cx = x + pad; const cy = y + pad; const s = size - pad * 2;
  ctx.fillStyle = lighten(baseColor, 60);
  ctx.fillRect(cx, cy, s, bevel);
  ctx.fillRect(cx, cy, bevel, s);
  ctx.fillStyle = darken(baseColor, 60);
  ctx.fillRect(cx, cy + s - bevel, s, bevel);
  ctx.fillRect(cx + s - bevel, cy, bevel, s);
  const grad = ctx.createLinearGradient(cx, cy, cx, cy + s);
  grad.addColorStop(0, lighten(baseColor, 30));
  grad.addColorStop(0.4, baseColor);
  grad.addColorStop(1, darken(baseColor, 30));
  ctx.fillStyle = grad;
  ctx.fillRect(cx + bevel, cy + bevel, s - bevel * 2, s - bevel * 2);
  const shine = ctx.createRadialGradient(cx + s * 0.3, cy + s * 0.25, 0, cx + s * 0.3, cy + s * 0.25, s * 0.45);
  shine.addColorStop(0, 'rgba(255,255,255,0.4)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(cx + bevel, cy + bevel, s - bevel * 2, (s - bevel * 2) * 0.5);
}

interface Props {
  holdPiece: PieceType | null;
  holdUsed: boolean;
}

export default function HoldBox({ holdPiece, holdUsed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 4 * CELL_SIZE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0, 8, 20, 0.7)';
    ctx.fillRect(0, 0, size, size);

    if (!holdPiece) return;

    const shape = PIECE_SHAPES[holdPiece];
    const color = CELL_COLORS[PIECE_CELL[holdPiece]];
    ctx.globalAlpha = holdUsed ? 0.35 : 1;

    // ピースの実際のバウンディングボックスを計算
    const minR = Math.min(...shape.map(([r]) => r));
    const maxR = Math.max(...shape.map(([r]) => r));
    const minC = Math.min(...shape.map(([, c]) => c));
    const maxC = Math.max(...shape.map(([, c]) => c));
    const pieceH = maxR - minR + 1;
    const pieceW = maxC - minC + 1;
    // 正規化した座標でセンタリング
    const offX = Math.round((size - pieceW * CELL_SIZE) / 2);
    const offY = Math.round((size - pieceH * CELL_SIZE) / 2);

    for (const [r, c] of shape) {
      const drawX = (c - minC) * CELL_SIZE + offX;
      const drawY = (r - minR) * CELL_SIZE + offY;
      drawMiniGlossy(ctx, drawX, drawY, CELL_SIZE, color);
    }

    ctx.globalAlpha = 1;
  });

  return (
    <div className="t99-frame" style={{ padding: 6, position: 'relative' }}>
      <div className="t99-frame-label">HOLD</div>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ display: 'block', borderRadius: 2 }}
      />
    </div>
  );
}
