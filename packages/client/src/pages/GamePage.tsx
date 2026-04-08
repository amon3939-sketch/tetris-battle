import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket.ts';
import type { Board, Piece, Action, GameState } from '@tetris/engine/src/types.ts';
import { GameEngine } from '@tetris/engine/src/engine.ts';
import { PIECE_SHAPES, PIECE_GRID_SIZE } from '@tetris/engine/src/piece.ts';
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
  seed?: number;
}

interface GameOverData {
  winnerId: string;
  ranking: Array<{ socketId: string; nickname: string; rank: number; score?: number; linesCleared?: number }>;
}

interface Props {
  roomState: RoomState | null;
  gameReadyData: GameReadyData | null;
  nickname: string;
  isSolo: boolean;
  gameOverData: GameOverData | null;
  goToResult: () => void;
  quitGame: () => void;
}

const DEFAULT_KEY_MAP: Record<string, Action> = {
  'ArrowLeft': 'move_left',
  'ArrowRight': 'move_right',
  'ArrowDown': 'soft_drop',
  'ArrowUp': 'hard_drop',
  ' ': 'rotate_cw',
  'Shift': 'hold',
};

function loadKeyMap(): Record<string, Action> {
  try {
    const saved = localStorage.getItem('tetris_keymap');
    return saved ? JSON.parse(saved) : { ...DEFAULT_KEY_MAP };
  } catch { return { ...DEFAULT_KEY_MAP }; }
}

function saveKeyMap(map: Record<string, Action>) {
  localStorage.setItem('tetris_keymap', JSON.stringify(map));
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

export default function GamePage({ roomState, gameReadyData, nickname, isSolo, gameOverData, goToResult, quitGame }: Props) {
  // ===== ローカルエンジン（表示＆操作の主体） =====
  const localEngineRef = useRef<GameEngine | null>(null);
  const localTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [localState, setLocalState] = useState<GameState | null>(null);

  // ===== サーバーから受信した権威的データ（スコア・攻撃・勝敗判定用） =====
  const serverScoreRef = useRef(0);
  const serverLinesRef = useRef(0);
  const serverLevelRef = useRef(1);
  const serverComboRef = useRef(-1);
  const serverB2bRef = useRef(false);
  // サーバーが判定したゲームオーバー（勝敗に使用）
  const serverGameOverRef = useRef(false);

  const [otherBoards, setOtherBoards] = useState<Map<string, Board>>(new Map());
  const [koList, setKoList] = useState<Set<string>>(new Set());
  const [incomingAttack, setIncomingAttack] = useState(0);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [gameActive, setGameActive] = useState(false);
  const seqRef = useRef(0);
  const attackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<GameCanvasHandle>(null);

  const settings = gameReadyData?.settings ?? { das: 200, arr: 50 };
  const [muted, setMuted] = useState(false);
  const gameOverFiredRef = useRef(false);
  const [showStamps, setShowStamps] = useState(true);
  const [receivedStamp, setReceivedStamp] = useState<{text: string; style: string; nickname: string} | null>(null);

  const STAMPS = [
    { id: 'ganbare', text: '頑張れ！', style: 'pop' },
    { id: 'yabai', text: 'やばい！', style: 'pop' },
    { id: 'nice', text: 'ナイス！', style: 'pop' },
    { id: 'sugoi', text: 'すごい！', style: 'pop' },
    { id: 'makenaizo', text: '負けないぞ', style: 'serious' },
    { id: 'mada', text: 'まだまだ', style: 'serious' },
    { id: 'gg', text: 'GG', style: 'pop' },
    { id: 'wwww', text: 'ｗｗｗｗ', style: 'pop' },
  ];

  const [paused, setPaused] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [bgmVol, setBgmVol] = useState(() => {
    const v = localStorage.getItem('tetris_bgm_vol');
    return v ? Number(v) : 35;
  });
  const [seVol, setSeVol] = useState(() => {
    const v = localStorage.getItem('tetris_se_vol');
    return v ? Number(v) : 60;
  });
  const [keyMap, setKeyMap] = useState(loadKeyMap);
  const [rebindAction, setRebindAction] = useState<Action | null>(null);

  useEffect(() => { soundManager.load(); }, []);

  // ゲーム終了判定：サーバーの判定 OR ローカルのgameOver OR game:overイベント
  const isGameOver = serverGameOverRef.current || !!localState?.isGameOver || !!gameOverData;
  const isWinner = !isSolo && gameOverData?.winnerId === socket.id;

  // ===== Countdown + ローカルエンジン初期化 =====
  useEffect(() => {
    if (!gameReadyData) return;

    // seedでローカルエンジンを作成（サーバーと同じseed → 同じピース順）
    if (gameReadyData.seed != null && !localEngineRef.current) {
      localEngineRef.current = new GameEngine({ seed: gameReadyData.seed });
      setLocalState(localEngineRef.current.getState());
    }

    let countdownSEPlayed = false;
    const updateCountdown = () => {
      const now = Date.now();
      const diff = gameReadyData.startAt - now;
      if (diff > 2000) setCountdown('3');
      else if (diff > 1000) setCountdown('2');
      else if (diff > 0) setCountdown('1');
      else setCountdown('GO!');

      if (diff <= 3000 && !countdownSEPlayed) {
        countdownSEPlayed = true;
        soundManager.playSE('countdown');
      }
      if (diff <= 0) {
        setTimeout(() => {
          setCountdown(null);
          setGameActive(true);
          soundManager.playBGM('play');

          // ローカルtick開始（重力・ロック・表示更新）
          if (localEngineRef.current) {
            localTickRef.current = setInterval(() => {
              const engine = localEngineRef.current;
              if (!engine) return;
              const result = engine.tick(16);
              if (result && result.linesCleared > 0) {
                soundManager.playLineClear(result.linesCleared);
                if (canvasRef.current) {
                  canvasRef.current.triggerLineClear(result.clearedRows);
                }
              }
              // ローカル表示更新（スコア等はサーバーの権威的データ）
              const state = engine.getState();
              setLocalState({
                ...state,
                score: serverScoreRef.current,
                linesCleared: serverLinesRef.current,
                level: serverLevelRef.current,
                combo: serverComboRef.current,
                b2bActive: serverB2bRef.current,
                isGameOver: state.isGameOver || serverGameOverRef.current,
              });
            }, 16);
          }
        }, 500);
        return;
      }
      requestAnimationFrame(updateCountdown);
    };
    requestAnimationFrame(updateCountdown);
    return () => {
      soundManager.stopBGM();
      if (localTickRef.current) {
        clearInterval(localTickRef.current);
        localTickRef.current = null;
      }
    };
  }, [gameReadyData]);

  // ===== Socket events =====
  useEffect(() => {
    // サーバーからの状態確認（スコア・攻撃・勝敗判定のみ使用。表示はローカル）
    const onStateAck = (data: any) => {
      serverScoreRef.current = data.score ?? 0;
      serverLinesRef.current = data.linesCleared ?? 0;
      serverLevelRef.current = data.level ?? 1;
      serverComboRef.current = data.combo ?? -1;
      serverB2bRef.current = data.b2bActive ?? false;
      if (data.isGameOver) serverGameOverRef.current = true;
      // 表示更新はローカルtickに任せる（setLocalState呼ばない）
    };

    // 他プレイヤーのボード（ミニボード表示用のみ。勝敗判定に使わない）
    const onBoardUpdate = (data: { socketId: string; board: Board }) => {
      if (data.socketId === socket.id) return;
      setOtherBoards(prev => {
        const next = new Map(prev);
        next.set(data.socketId, data.board);
        return next;
      });
    };

    // おじゃま受信（ローカルエンジンに即時反映）
    const onAttackReceive = (data: { lines: number; holes?: number[] }) => {
      setIncomingAttack(prev => prev + data.lines);
      soundManager.playSE('garbage');
      if (localEngineRef.current) {
        localEngineRef.current.receiveGarbage(data.lines, data.holes);
      }
      if (attackTimeoutRef.current) clearTimeout(attackTimeoutRef.current);
      attackTimeoutRef.current = setTimeout(() => setIncomingAttack(0), 1000);
    };

    const onPlayerKO = (data: { socketId: string; rank: number }) => {
      setKoList(prev => new Set(prev).add(data.socketId));
    };

    const onStamp = (data: { text: string; style: string; nickname: string }) => {
      if (data.nickname === nickname) return;
      setReceivedStamp(data);
      setTimeout(() => setReceivedStamp(null), 2000);
    };

    socket.on('game:state_ack', onStateAck);
    socket.on('board:update', onBoardUpdate);
    socket.on('attack:receive', onAttackReceive);
    socket.on('player:ko', onPlayerKO);
    socket.on('stamp:receive', onStamp);

    return () => {
      socket.off('game:state_ack', onStateAck);
      socket.off('board:update', onBoardUpdate);
      socket.off('attack:receive', onAttackReceive);
      socket.off('player:ko', onPlayerKO);
      socket.off('stamp:receive', onStamp);
    };
  }, []);

  // ゲームオーバー検知
  useEffect(() => {
    if (isGameOver && !gameOverFiredRef.current) {
      gameOverFiredRef.current = true;
      soundManager.playSE('gameover');
      soundManager.fadeOutBGM(1200);
      if (localEngineRef.current) localEngineRef.current.pause();
    }
  }, [isGameOver]);

  // ===== Send action: ローカル即時反映 + サーバーに送信 =====
  const sendAction = useCallback((action: Action) => {
    seqRef.current++;
    // サーバーにも送信（攻撃・スコア・勝敗判定）
    socket.emit('input:action', { action, seq: seqRef.current });

    // SE即時再生
    if (action === 'hard_drop') soundManager.playSE('harddrop');
    else if (action === 'rotate_cw' || action === 'rotate_ccw') soundManager.playSE('rotate');
    else if (action === 'hold') soundManager.playSE('hold');

    // ローカルエンジンに即時反映
    const engine = localEngineRef.current;
    if (engine) {
      // ハードドロップエフェクト
      if (action === 'hard_drop' && canvasRef.current) {
        const ghost = engine.getGhostPiece();
        if (ghost) {
          canvasRef.current.triggerHardDrop(getPieceCellsForRender(ghost));
        }
      }

      const result = engine.applyAction(action);

      // ライン消去SE＋エフェクト
      if (result && result.linesCleared > 0) {
        soundManager.playLineClear(result.linesCleared);
        if (canvasRef.current) {
          canvasRef.current.triggerLineClear(result.clearedRows);
        }
      }

      // 即座に表示更新
      const state = engine.getState();
      setLocalState({
        ...state,
        score: serverScoreRef.current,
        linesCleared: serverLinesRef.current,
        level: serverLevelRef.current,
        combo: serverComboRef.current,
        b2bActive: serverB2bRef.current,
        isGameOver: state.isGameOver || serverGameOverRef.current,
      });
    }
  }, []);

  // ポーズ切替（ソロのみ）
  const togglePause = useCallback(() => {
    if (!isSolo || !gameActive || isGameOver) return;
    const engine = localEngineRef.current;
    if (!engine) return;
    if (engine.isPaused()) {
      engine.resume();
      setPaused(false);
    } else {
      engine.pause();
      setPaused(true);
    }
  }, [isSolo, gameActive, isGameOver]);

  const openMenu = useCallback(() => {
    if (isSolo && localEngineRef.current && gameActive && !isGameOver) {
      localEngineRef.current.pause();
      setPaused(true);
    }
    setShowMenu(true);
    setShowOptions(false);
  }, [isSolo, gameActive, isGameOver]);

  const closeMenu = useCallback(() => {
    setShowMenu(false);
    setShowOptions(false);
    setShowQuitConfirm(false);
    if (isSolo && localEngineRef.current) {
      localEngineRef.current.resume();
      setPaused(false);
    }
  }, [isSolo]);

  useEffect(() => {
    if (!rebindAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') { setRebindAction(null); return; }
      const newMap = { ...keyMap };
      for (const [k, v] of Object.entries(newMap)) {
        if (v === rebindAction) delete newMap[k];
      }
      newMap[e.key] = rebindAction;
      setKeyMap(newMap);
      saveKeyMap(newMap);
      setRebindAction(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rebindAction, keyMap]);

  const handleBgmVol = useCallback((v: number) => {
    setBgmVol(v);
    soundManager.setBGMVolume(v);
    localStorage.setItem('tetris_bgm_vol', String(v));
  }, []);
  const handleSeVol = useCallback((v: number) => {
    setSeVol(v);
    soundManager.setSEVolume(v);
    localStorage.setItem('tetris_se_vol', String(v));
  }, []);

  const sendStamp = useCallback((stamp: typeof STAMPS[0]) => {
    socket.emit('stamp:send', { text: stamp.text, style: stamp.style });
    setShowStamps(false);
  }, []);

  useEffect(() => {
    soundManager.setBGMVolume(bgmVol);
    soundManager.setSEVolume(seVol);
  }, []);

  useInputHandler(gameActive && !isGameOver && !paused && !showMenu, settings, sendAction, keyMap);

  const otherPlayers = (roomState?.players ?? []).filter(p => p.socketId !== socket.id);

  return (
    <div style={{
      display: 'flex',
      gap: 16,
      padding: 16,
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      position: 'relative',
    }}>
      {/* Top right buttons */}
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 300, display: 'flex', gap: 8 }}>
        <button onClick={openMenu} style={{
          background: 'rgba(30,30,60,0.8)', border: '1px solid #3a3a5c', borderRadius: 8,
          padding: '6px 12px', color: '#fff', fontSize: 14, cursor: 'pointer',
        }}>MENU</button>
        <button onClick={() => { const m = soundManager.toggleMute(); setMuted(m); }} style={{
          background: 'rgba(30,30,60,0.8)', border: '1px solid #3a3a5c', borderRadius: 8,
          padding: '6px 12px', color: '#fff', fontSize: 18, cursor: 'pointer',
        }} title={muted ? 'サウンドON' : 'ミュート'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Menu overlay */}
      {showMenu && !showOptions && !showQuitConfirm && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 250 }}>
          <div style={{ background: '#16162a', border: '1px solid #3a3a5c', borderRadius: 12, padding: 32, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ textAlign: 'center', margin: 0, fontSize: 20 }}>メニュー</h2>
            <button className="btn-primary" onClick={closeMenu} style={{ padding: '12px', fontSize: 16 }}>プレイ中画面に戻る</button>
            <button className="btn-secondary" onClick={() => setShowOptions(true)} style={{ padding: '12px', fontSize: 16 }}>オプション</button>
            <button className="btn-danger" onClick={() => setShowQuitConfirm(true)} style={{ padding: '12px', fontSize: 16 }}>終了する</button>
          </div>
        </div>
      )}

      {/* Quit confirmation */}
      {showQuitConfirm && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 260 }}>
          <div style={{ background: '#16162a', border: '1px solid #3a3a5c', borderRadius: 12, padding: 32, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>終了してもよろしいですか？</h2>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
              <button className="btn-danger" onClick={() => { setShowQuitConfirm(false); setShowMenu(false); quitGame(); }} style={{ padding: '12px 28px', fontSize: 16 }}>はい</button>
              <button className="btn-secondary" onClick={() => setShowQuitConfirm(false)} style={{ padding: '12px 28px', fontSize: 16 }}>いいえ</button>
            </div>
          </div>
        </div>
      )}

      {/* Options overlay */}
      {showMenu && showOptions && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 250 }}>
          <div style={{ background: '#16162a', border: '1px solid #3a3a5c', borderRadius: 12, padding: 28, minWidth: 360, maxHeight: '80vh', overflowY: 'auto' }}>
            <h2 style={{ textAlign: 'center', margin: '0 0 16px', fontSize: 20 }}>オプション</h2>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#aaa', fontSize: 14 }}>
                <span style={{ minWidth: 80 }}>BGM音量</span>
                <input type="range" min={0} max={100} value={bgmVol} onChange={e => handleBgmVol(Number(e.target.value))} style={{ flex: 1 }} />
                <span style={{ minWidth: 36, textAlign: 'right', color: '#fff' }}>{bgmVol}%</span>
              </label>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#aaa', fontSize: 14 }}>
                <span style={{ minWidth: 80 }}>SE音量</span>
                <input type="range" min={0} max={100} value={seVol} onChange={e => handleSeVol(Number(e.target.value))} style={{ flex: 1 }} />
                <span style={{ minWidth: 36, textAlign: 'right', color: '#fff' }}>{seVol}%</span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#aaa', fontSize: 14, marginBottom: 8 }}>ボタン割り当て</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {([
                    ['move_left', '左移動'], ['move_right', '右移動'], ['soft_drop', 'ソフトドロップ'],
                    ['hard_drop', 'ハードドロップ'], ['rotate_cw', '右回転'], ['rotate_ccw', '左回転'], ['hold', 'ホールド'],
                  ] as [Action, string][]).map(([action, label]) => {
                    const currentKey = Object.entries(keyMap).find(([, v]) => v === action)?.[0] ?? '-';
                    const isRebinding = rebindAction === action;
                    return (
                      <tr key={action} style={{ borderBottom: '1px solid #2a2a4a' }}>
                        <td style={{ padding: '6px 4px', color: '#ccc' }}>{label}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                          <button onClick={() => setRebindAction(isRebinding ? null : action)} style={{
                            background: isRebinding ? '#4a6cf7' : '#2a2a4a', color: '#fff', border: 'none',
                            borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', minWidth: 80,
                          }}>{isRebinding ? 'キーを押して...' : displayKey(currentKey)}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="btn-secondary" onClick={() => setShowOptions(false)} style={{ width: '100%', padding: '10px', fontSize: 15 }}>戻る</button>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {countdown && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 200 }}>
          <div style={{ fontSize: 96, fontWeight: 900, color: countdown === 'GO!' ? '#4caf50' : '#fff', textShadow: '0 0 40px rgba(74,108,247,0.8)' }}>
            {countdown}
          </div>
        </div>
      )}

      {/* Left side: Hold + Score + Chat */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 120 }}>
        <HoldBox holdPiece={localState?.holdPiece ?? null} holdUsed={localState?.holdUsed ?? false} />
        <div className="card" style={{ padding: 12, fontSize: 14 }}>
          <div style={{ marginBottom: 4 }}>Score: <strong style={{ fontSize: 16 }}>{localState?.score ?? 0}</strong></div>
          <div style={{ marginBottom: 4 }}>Lines: <strong style={{ fontSize: 16 }}>{localState?.linesCleared ?? 0}</strong></div>
          <div>Combo: <strong>{Math.max(0, localState?.combo ?? 0)}</strong></div>
          {localState?.b2bActive && <div style={{ color: '#f0a000', fontWeight: 700, marginTop: 4 }}>B2B</div>}
        </div>
        <ChatBox roomId={roomState?.room?.id ?? ''} />
        <div style={{ position: 'relative' }}>
          <button className="btn-secondary" onClick={() => setShowStamps(!showStamps)} style={{ width: '100%', fontSize: 13, padding: '6px' }}>スタンプ</button>
          {showStamps && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: '#16162a', border: '1px solid #3a3a5c', borderRadius: 8, padding: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 4, zIndex: 50 }}>
              {STAMPS.map(s => (
                <button key={s.id} onClick={() => sendStamp(s)} style={{
                  background: s.style === 'pop' ? 'linear-gradient(135deg, #ff6b6b, #ffa500)' : '#2a2a4a',
                  color: '#fff', border: 'none', borderRadius: 6, padding: '6px 4px',
                  fontSize: s.style === 'pop' ? 13 : 12, cursor: 'pointer',
                  fontFamily: s.style === 'serious' ? '"Yu Mincho", "Hiragino Mincho ProN", serif' : 'inherit',
                  fontWeight: s.style === 'pop' ? 700 : 400,
                }}>{s.text}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: Main board */}
      <div style={{ position: 'relative' }}>
        <GameCanvas
          ref={canvasRef}
          board={localState?.board ?? null}
          currentPiece={localState?.currentPiece ?? null}
          incomingAttack={incomingAttack}
          isGameOver={isGameOver}
        />
        {isGameOver && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', borderRadius: 4, gap: 24 }}>
            {isWinner ? (
              <div style={{ fontSize: 44, fontWeight: 900, color: '#ffd700', textShadow: '0 0 40px rgba(255,215,0,0.8), 0 0 80px rgba(255,215,0,0.4)', letterSpacing: 6, animation: 'pulse 1s ease-in-out infinite' }}>WINNER!!</div>
            ) : isSolo ? (
              <div style={{ fontSize: 40, fontWeight: 900, color: '#e74c3c', textShadow: '0 0 30px rgba(231,76,60,0.6)', letterSpacing: 4 }}>GAME OVER</div>
            ) : (
              <div style={{ fontSize: 40, fontWeight: 900, color: '#e74c3c', textShadow: '0 0 30px rgba(231,76,60,0.6)', letterSpacing: 4 }}>YOU LOSE</div>
            )}
            <button className="btn-primary" onClick={goToResult} style={{ padding: '14px 36px', fontSize: 18, fontWeight: 700, animation: 'pulse 1.5s ease-in-out infinite' }}>リザルトを見る</button>
          </div>
        )}
      </div>

      {/* Right side: NEXT + Opponents */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 14, color: '#fff', marginBottom: 6, textAlign: 'center', fontWeight: 700, letterSpacing: 2 }}>NEXT</div>
          <NextQueue nextQueue={localState?.nextQueue ?? []} />
        </div>
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

      {/* Received stamp */}
      {receivedStamp && (
        <div style={{ position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)', zIndex: 400, pointerEvents: 'none', animation: 'stampAppear 0.3s ease-out' }}>
          <div style={{ padding: '16px 32px', borderRadius: 16, background: receivedStamp.style === 'pop' ? 'linear-gradient(135deg, #ff6b6b, #ffa500)' : 'rgba(22,22,42,0.95)', border: '2px solid rgba(255,255,255,0.3)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>{receivedStamp.nickname}</div>
            <div style={{ fontSize: receivedStamp.style === 'pop' ? 28 : 22, fontWeight: receivedStamp.style === 'pop' ? 900 : 400, color: '#fff', fontFamily: receivedStamp.style === 'serious' ? '"Yu Mincho", "Hiragino Mincho ProN", serif' : 'inherit', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              {receivedStamp.text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function emptyMiniBoard(): Board {
  return Array.from({ length: 20 }, () => Array(10).fill(0));
}

function displayKey(key: string): string {
  const map: Record<string, string> = {
    ' ': 'Space', 'ArrowLeft': '←', 'ArrowRight': '→', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'Shift': 'Shift', 'Control': 'Ctrl', 'Alt': 'Alt', 'Meta': 'Cmd', 'Enter': 'Enter', 'Backspace': 'BS', 'Tab': 'Tab',
  };
  return map[key] ?? key.toUpperCase();
}
