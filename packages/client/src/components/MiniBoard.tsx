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
        if (cell === 0) {
          ctx.fillStyle = 'rgba(0, 10, 25, 0.7)';
        } else {
          ctx.fillStyle = CELL_COLORS[cell] || CELL_COLORS[0];
        }
        ctx.fillRect(c * MINI_CELL_SIZE, r * MINI_CELL_SIZE, MINI_CELL_SIZE, MINI_CELL_SIZE);
        // Cell border
        if (cell !== 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c * MINI_CELL_SIZE + 0.5, r * MINI_CELL_SIZE + 0.5, MINI_CELL_SIZE - 1, MINI_CELL_SIZE - 1);
        }
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
      ctx.shadowColor = 'rgba(255, 50, 30, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillText('KO', MINI_WIDTH / 2, MINI_HEIGHT / 2);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }
  });

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <div style={{
        fontSize: 11,
        color: '#00ccff',
        marginBottom: 3,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: MINI_WIDTH,
        fontWeight: 700,
        letterSpacing: 1,
        textShadow: '0 0 6px rgba(0,200,255,0.4)',
      }}>
        {nickname}
      </div>
      <div className="t99-frame" style={{ padding: 2, display: 'inline-block' }}>
        <canvas
          ref={canvasRef}
          width={MINI_WIDTH}
          height={MINI_HEIGHT}
          style={{ display: 'block', borderRadius: 2 }}
        />
      </div>
      {(attackLines ?? 0) > 0 && (
        <div style={{
          position: 'absolute',
          top: 20,
          right: -4,
          background: 'linear-gradient(135deg, #ff3333, #ff6644)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 10,
          minWidth: 20,
          textAlign: 'center',
          boxShadow: '0 0 8px rgba(255,50,30,0.5)',
        }}>
          {attackLines}
        </div>
      )}
    </div>
  );
}
