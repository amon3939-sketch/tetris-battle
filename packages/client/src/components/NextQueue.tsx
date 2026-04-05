import { useRef, useEffect } from 'react';
import type { PieceType } from '@tetris/engine/src/types.ts';
import { PIECE_SHAPES, PIECE_CELL } from '@tetris/engine/src/piece.ts';
import { CELL_COLORS } from './GameCanvas.tsx';

const CELL_SIZE = 20;
const BEVEL = 2;
const SLOT_HEIGHT = 3 * CELL_SIZE;
const WIDTH = 4 * CELL_SIZE;
const MAX_NEXT = 5;

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
  nextQueue: PieceType[];
}

export default function NextQueue({ nextQueue }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const totalHeight = MAX_NEXT * SLOT_HEIGHT;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, WIDTH, totalHeight);

    const queue = nextQueue.slice(0, MAX_NEXT);

    for (let i = 0; i < queue.length; i++) {
      const type = queue[i];
      const shape = PIECE_SHAPES[type];
      const color = CELL_COLORS[PIECE_CELL[type]];
      const yOff = i * SLOT_HEIGHT;

      const minR = Math.min(...shape.map(([r]) => r));
      const maxR = Math.max(...shape.map(([r]) => r));
      const minC = Math.min(...shape.map(([, c]) => c));
      const maxC = Math.max(...shape.map(([, c]) => c));
      const pieceH = maxR - minR + 1;
      const pieceW = maxC - minC + 1;
      const offR = Math.floor((3 - pieceH) / 2) - minR;
      const offC = Math.floor((4 - pieceW) / 2) - minC;

      for (const [r, c] of shape) {
        drawMiniTile(ctx, (c + offC) * CELL_SIZE, yOff + (r + offR) * CELL_SIZE, CELL_SIZE, color);
      }
    }
  });

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={totalHeight}
        style={{ border: '1px solid #3a3a5c', borderRadius: 4, background: '#1a1a2e' }}
      />
    </div>
  );
}
