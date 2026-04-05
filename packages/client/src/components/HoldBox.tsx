import { useRef, useEffect } from 'react';
import type { PieceType } from '@tetris/engine/src/types.ts';
import { PIECE_SHAPES, PIECE_CELL } from '@tetris/engine/src/piece.ts';
import { CELL_COLORS } from './GameCanvas.tsx';

const CELL_SIZE = 24;
const BEVEL = 2;

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

function drawMiniTile(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, baseColor: string) {
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = lighten(baseColor, 50);
  ctx.fillRect(x, y, size, BEVEL);
  ctx.fillRect(x, y, BEVEL, size);
  ctx.fillStyle = darken(baseColor, 50);
  ctx.fillRect(x, y + size - BEVEL, size, BEVEL);
  ctx.fillRect(x + size - BEVEL, y, BEVEL, size);
  ctx.fillStyle = lighten(baseColor, 15);
  ctx.fillRect(x + BEVEL, y + BEVEL, size - BEVEL * 2, size - BEVEL * 2);
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

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, size, size);

    if (!holdPiece) return;

    const shape = PIECE_SHAPES[holdPiece];
    const color = CELL_COLORS[PIECE_CELL[holdPiece]];
    ctx.globalAlpha = holdUsed ? 0.4 : 1;

    const minR = Math.min(...shape.map(([r]) => r));
    const maxR = Math.max(...shape.map(([r]) => r));
    const minC = Math.min(...shape.map(([, c]) => c));
    const maxC = Math.max(...shape.map(([, c]) => c));
    const pieceH = maxR - minR + 1;
    const pieceW = maxC - minC + 1;
    const offR = Math.floor((4 - pieceH) / 2) - minR;
    const offC = Math.floor((4 - pieceW) / 2) - minC;

    for (const [r, c] of shape) {
      drawMiniTile(ctx, (c + offC) * CELL_SIZE, (r + offR) * CELL_SIZE, CELL_SIZE, color);
    }

    ctx.globalAlpha = 1;
  });

  return (
    <div>
      <div style={{ fontSize: 13, color: '#fff', marginBottom: 4, textAlign: 'center', fontWeight: 700, letterSpacing: 2 }}>HOLD</div>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ border: '1px solid #3a3a5c', borderRadius: 4, background: '#1a1a2e' }}
      />
    </div>
  );
}
