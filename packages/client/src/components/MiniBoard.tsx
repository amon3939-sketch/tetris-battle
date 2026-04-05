import { useRef, useEffect } from 'react';
import type { Board } from '@tetris/engine/src/types.ts';
import { CELL_COLORS } from './GameCanvas.tsx';

const MINI_CELL_SIZE = 10;
const MINI_WIDTH = 10 * MINI_CELL_SIZE;
const MINI_HEIGHT = 20 * MINI_CELL_SIZE;

interface Props {
  board: Board;
  nickname: string;
  isKO: boolean;
  attackLines?: number;
}

export default function MiniBoard({ board, nickname, isKO, attackLines }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw board
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 10; c++) {
        const cell = board[r]?.[c] ?? 0;
        ctx.fillStyle = CELL_COLORS[cell] || CELL_COLORS[0];
        ctx.fillRect(c * MINI_CELL_SIZE, r * MINI_CELL_SIZE, MINI_CELL_SIZE, MINI_CELL_SIZE);
      }
    }

    // KO overlay
    if (isKO) {
      ctx.fillStyle = 'rgba(231, 76, 60, 0.5)';
      ctx.fillRect(0, 0, MINI_WIDTH, MINI_HEIGHT);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('KO', MINI_WIDTH / 2, MINI_HEIGHT / 2);
    }
  });

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <div style={{
        fontSize: 13,
        color: '#fff',
        marginBottom: 4,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: MINI_WIDTH,
        fontWeight: 700,
        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
      }}>
        {nickname}
      </div>
      <canvas
        ref={canvasRef}
        width={MINI_WIDTH}
        height={MINI_HEIGHT}
        style={{ border: '1px solid #3a3a5c', borderRadius: 3, background: '#1a1a2e' }}
      />
      {(attackLines ?? 0) > 0 && (
        <div style={{
          position: 'absolute',
          top: 20,
          right: -4,
          background: '#e74c3c',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 10,
          minWidth: 20,
          textAlign: 'center',
        }}>
          {attackLines}
        </div>
      )}
    </div>
  );
}
