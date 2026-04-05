import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket.ts';
import type { Board, Piece, PieceType, Action, GameState } from '@tetris/engine/src/types.ts';
import { PIECE_SHAPES, PIECE_GRID_SIZE, PIECE_CELL } from '@tetris/engine/src/piece.ts';
import GameCanvas from '../components/GameCanvas.tsx';
import type { GameCanvasHandle } from '../components/GameCanvas.tsx';
import HoldBox from '../components/HoldBox.tsx';
import NextQueue from '../components/NextQueue.tsx';
import MiniBoard from '../components/MiniBoard.tsx';
import ChatBox from '../components/ChatBox.tsx';
import { useInputHandler } from '../hooks/useInputHandler.ts';
import { soundManager } from '../sounds.ts';

interface RoomState {
  room: { id: string; name: string };
  players: Array<{ socketId: string; nickname: string }>;
  hostSocketId: string;
  status: string;
}

interface GameReadyData {
  startAt: number;
  settings: { das: number; arr: number };
}

interface Props {
  roomState: RoomState | null;
  gameReadyData: GameReadyData | null;
  nickname: string;
}

function getPieceCellsForRender(piece: Piece): [number, number][] {
  const shape = PIECE_SHAPES[piece.type];
  const gridSize = PIECE_GRID_SIZE[piece.type];
  let cells = shape.map(([r, c]) => [r, c] as [number, number]);
  for (let i = 0; i < piece.rotation; i++) {
    cells = cells.map(([r, c]) => [c, gridSize - 1 - r]);
  }
  return cells.map(([r, c]) => [r + piece.y, c + piece.x]);
}

export default function GamePage({ roomState, gameReadyData, nickname }: Props) {
  const [localState, setLocalState] = useState<GameState | null>(null);
  const [otherBoards, setOtherBoards] = useState<Map<string, Board>>(new Map());
  const [koList, setKoList] = useState<Set<string>>(new Set());
  const [incomingAttack, setIncomingAttack] = useState(0);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [gameActive, setGameActive] = useState(false);
  const seqRef = useRef(0);
  const attackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<GameCanvasHandle>(null);
  const prevPieceRef = useRef<Piece | null>(null);

  const settings = gameReadyData?.settings ?? { das: 200, arr: 50 };
  const [muted, setMuted] = useState(false);
  const gameOverFiredRef = useRef(false);

  // サウンドのプリロード
  useEffect(() => {
    soundManager.load();
  }, []);

  // Countdown
  useEffect(() => {
    if (!gameReadyData) return;
    const updateCountdown = () => {
      const now = Date.now();
      const diff = gameReadyData.startAt - now;
      if (diff > 2000) setCountdown('3');
      else if (diff > 1000) setCountdown('2');
      else if (diff > 0) setCountdown('1');
      else {
        setCountdown('GO!');
        setTimeout(() => {
          setCountdown(null);
          setGameActive(true);
          // BGM 再生開始
          soundManager.playBGM();
        }, 500);
        return;
      }
      requestAnimationFrame(updateCountdown);
    };
    requestAnimationFrame(updateCountdown);
    return () => {
      // アンマウント時にBGM停止
      soundManager.stopBGM();
    };
  }, [gameReadyData]);

  // Socket events
  useEffect(() => {
    const onStateAck = (data: any) => {
      setLocalState({
        board: data.board,
        currentPiece: data.currentPiece,
        holdPiece: data.holdPiece,
        holdUsed: data.holdUsed,
        nextQueue: data.nextQueue,
        isGameOver: data.isGameOver,
        combo: data.combo,
        b2bActive: data.b2bActive,
        score: data.score,
        linesCleared: data.linesCleared,
        level: data.level,
      });
    };

    const onBoardUpdate = (data: { socketId: string; board: Board }) => {
      if (data.socketId === socket.id) return;
      setOtherBoards(prev => {
        const next = new Map(prev);
        next.set(data.socketId, data.board);
        return next;
      });
    };

    const onAttackReceive = (data: { lines: number }) => {
      setIncomingAttack(prev => prev + data.lines);
      soundManager.playSE('garbage');
      if (attackTimeoutRef.current) clearTimeout(attackTimeoutRef.current);
      attackTimeoutRef.current = setTimeout(() => setIncomingAttack(0), 1000);
    };

    const onPlayerKO = (data: { socketId: string; rank: number }) => {
      setKoList(prev => new Set(prev).add(data.socketId));
    };

    const onLineClear = (data: { linesCleared: number }) => {
      // ライン消去SE
      if (data.linesCleared > 0) {
        soundManager.playLineClear(data.linesCleared);
      }
      // ライン消去エフェクトをトリガー
      if (canvasRef.current && data.linesCleared > 0) {
        const rows: number[] = [];
        for (let i = 0; i < data.linesCleared; i++) {
          rows.push(19 - i);
        }
        canvasRef.current.triggerLineClear(rows);
      }
    };

    socket.on('game:state_ack', onStateAck);
    socket.on('board:update', onBoardUpdate);
    socket.on('attack:receive', onAttackReceive);
    socket.on('player:ko', onPlayerKO);
    socket.on('game:line_clear', onLineClear);

    return () => {
      socket.off('game:state_ack', onStateAck);
      socket.off('board:update', onBoardUpdate);
      socket.off('attack:receive', onAttackReceive);
      socket.off('player:ko', onPlayerKO);
      socket.off('game:line_clear', onLineClear);
    };
  }, []);

  // ゲームオーバー検知 → SE即時再生 + BGMフェードアウト
  useEffect(() => {
    if (localState?.isGameOver && !gameOverFiredRef.current) {
      gameOverFiredRef.current = true;
      soundManager.playSE('gameover');
      soundManager.fadeOutBGM(1200);
    }
  }, [localState?.isGameOver]);

  // Send action + SE + hard drop エフェクト
  const sendAction = useCallback((action: Action) => {
    seqRef.current++;
    socket.emit('input:action', { action, seq: seqRef.current });

    // アクション別SE
    if (action === 'hard_drop') soundManager.playSE('harddrop');
    else if (action === 'rotate_cw' || action === 'rotate_ccw') soundManager.playSE('rotate');
    else if (action === 'hold') soundManager.playSE('hold');

    // ハードドロップエフェクト
    if (action === 'hard_drop' && localState?.currentPiece && localState?.board && canvasRef.current) {
      const piece = localState.currentPiece;
      // ゴースト位置を計算
      let y = piece.y;
      while (true) {
        const nextY = y + 1;
        const shape = PIECE_SHAPES[piece.type];
        const gridSize = PIECE_GRID_SIZE[piece.type];
        let cells = shape.map(([r, c]) => [r, c] as [number, number]);
        for (let i = 0; i < piece.rotation; i++) {
          cells = cells.map(([r, c]) => [c, gridSize - 1 - r]);
        }
        const boardCells = cells.map(([r, c]) => [r + nextY, c + piece.x] as [number, number]);
        const collision = boardCells.some(([r, c]) => {
          if (c < 0 || c >= 10 || r >= 20) return true;
          if (r >= 0 && localState.board[r][c] !== 0) return true;
          return false;
        });
        if (collision) break;
        y = nextY;
      }
      const finalCells = getPieceCellsForRender({ ...piece, y });
      canvasRef.current.triggerHardDrop(finalCells);
    }
  }, [localState]);

  // Input handler
  useInputHandler(gameActive && !(localState?.isGameOver), settings, sendAction);

  const otherPlayers = (roomState?.players ?? []).filter(p => p.socketId !== socket.id);

  return (
    <div style={{
      display: 'flex',
      gap: 16,
      padding: 16,
      justifyContent: 'center',
      alignItems: 'flex-start',
      minHeight: '100vh',
      position: 'relative',
    }}>
      {/* Mute button */}
      <button
        onClick={() => setMuted(soundManager.toggleMute())}
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 300,
          background: 'rgba(30,30,60,0.8)',
          border: '1px solid #3a3a5c',
          borderRadius: 8,
          padding: '6px 12px',
          color: '#fff',
          fontSize: 18,
          cursor: 'pointer',
        }}
        title={muted ? 'サウンドON' : 'ミュート'}
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {/* Countdown overlay */}
      {countdown && (
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)',
          zIndex: 200,
        }}>
          <div style={{
            fontSize: 96,
            fontWeight: 900,
            color: countdown === 'GO!' ? '#4caf50' : '#fff',
            textShadow: '0 0 40px rgba(74,108,247,0.8)',
          }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Left side: Hold + Score + Chat */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 120 }}>
        <HoldBox
          holdPiece={localState?.holdPiece ?? null}
          holdUsed={localState?.holdUsed ?? false}
        />
        <div className="card" style={{ padding: 12, fontSize: 14 }}>
          <div style={{ marginBottom: 4 }}>Score: <strong style={{ fontSize: 16 }}>{localState?.score ?? 0}</strong></div>
          <div style={{ marginBottom: 4 }}>Lines: <strong style={{ fontSize: 16 }}>{localState?.linesCleared ?? 0}</strong></div>
          <div>Combo: <strong>{Math.max(0, localState?.combo ?? 0)}</strong></div>
          {localState?.b2bActive && (
            <div style={{ color: '#f0a000', fontWeight: 700, marginTop: 4 }}>B2B</div>
          )}
        </div>
        <ChatBox roomId={roomState?.room?.id ?? ''} />
      </div>

      {/* Center: Main board */}
      <div style={{ position: 'relative' }}>
        <GameCanvas
          ref={canvasRef}
          board={localState?.board ?? null}
          currentPiece={localState?.currentPiece ?? null}
          incomingAttack={incomingAttack}
        />
        {localState?.isGameOver && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 4,
          }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#e74c3c' }}>GAME OVER</div>
          </div>
        )}
      </div>

      {/* Right side: NEXT + Opponents */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* NEXT queue */}
        <div>
          <div style={{
            fontSize: 14,
            color: '#fff',
            marginBottom: 6,
            textAlign: 'center',
            fontWeight: 700,
            letterSpacing: 2,
          }}>
            NEXT
          </div>
          <NextQueue nextQueue={localState?.nextQueue ?? []} />
        </div>

        {/* Other players' mini boards */}
        {otherPlayers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {otherPlayers.map(p => (
              <MiniBoard
                key={p.socketId}
                board={otherBoards.get(p.socketId) ?? emptyMiniBoard()}
                nickname={p.nickname}
                isKO={koList.has(p.socketId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function emptyMiniBoard(): Board {
  return Array.from({ length: 20 }, () => Array(10).fill(0));
}
