import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket.ts';
import type { Board, Piece, PieceType, Action, GameState } from '@tetris/engine/src/types.ts';
import { GameEngine } from '@tetris/engine/src/engine.ts';
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

// キー設定のデフォルト
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

  // ローカルエンジン（クライアント側予測用）
  const localEngineRef = useRef<GameEngine | null>(null);
  const localTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // サーバーから受信したスコア/ライン（権威的データ）
  const serverScoreRef = useRef(0);
  const serverLinesRef = useRef(0);

  // ポーズ（ソロのみ）
  const [paused, setPaused] = useState(false);
  // メニュー
  const [showMenu, setShowMenu] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  // オプション
  const [bgmVol, setBgmVol] = useState(() => {
    const v = localStorage.getItem('tetris_bgm_vol');
    return v ? Number(v) : 35;
  });
  const [seVol, setSeVol] = useState(() => {
    const v = localStorage.getItem('tetris_se_vol');
    return v ? Number(v) : 60;
  });
  // キー設定
  const [keyMap, setKeyMap] = useState(loadKeyMap);
  const [rebindAction, setRebindAction] = useState<Action | null>(null);

  // サウンドのプリロード
  useEffect(() => {
    soundManager.load();
  }, []);

  // Countdown + ローカルエンジン初期化
  useEffect(() => {
    if (!gameReadyData) return;

    // seedがあればローカルエンジンを作成
    if (gameReadyData.seed != null && !localEngineRef.current) {
      localEngineRef.current = new GameEngine({ seed: gameReadyData.seed });
      const state = localEngineRef.current.getState();
      setLocalState(state);
    }

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
          soundManager.playBGM('play');

          // ローカルの重力tickを開始
          if (localEngineRef.current) {
            localTickRef.current = setInterval(() => {
              const engine = localEngineRef.current;
              if (!engine) return;
              const result = engine.tick(16);
              // 重力やロックによるライン消去
              if (result && result.linesCleared > 0) {
                soundManager.playLineClear(result.linesCleared);
                if (canvasRef.current) {
                  canvasRef.current.triggerLineClear(result.clearedRows);
                }
              }
              setLocalState(engine.getState());
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

  // Socket events（サーバーからの権威的データ受信）
  useEffect(() => {
    const onStateAck = (data: any) => {
      // サーバーのスコア/ラインを権威的データとして保存
      serverScoreRef.current = data.score ?? 0;
      serverLinesRef.current = data.linesCleared ?? 0;

      // ゲームオーバーはサーバーの判定を信頼
      if (data.isGameOver && localEngineRef.current) {
        setLocalState(prev => prev ? { ...prev, isGameOver: true, score: data.score, linesCleared: data.linesCleared } : prev);
      }

      // ローカルエンジンがない場合（seed未対応のフォールバック）
      if (!localEngineRef.current) {
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
      }
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
      // ローカルエンジンにもおじゃまを反映
      if (localEngineRef.current) {
        localEngineRef.current.receiveGarbage(data.lines);
      }
      if (attackTimeoutRef.current) clearTimeout(attackTimeoutRef.current);
      attackTimeoutRef.current = setTimeout(() => setIncomingAttack(0), 1000);
    };

    const onPlayerKO = (data: { socketId: string; rank: number }) => {
      setKoList(prev => new Set(prev).add(data.socketId));
    };

    // サーバーからのライン消去イベント（ローカルエンジンがない場合のフォールバック）
    const onLineClear = (data: { linesCleared: number; clearedRows?: number[] }) => {
      if (localEngineRef.current) return; // ローカルエンジンが処理済み
      if (data.linesCleared > 0) {
        soundManager.playLineClear(data.linesCleared);
      }
      if (canvasRef.current && data.linesCleared > 0) {
        const rows = data.clearedRows ?? Array.from({ length: data.linesCleared }, (_, i) => 19 - i);
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

  // Send action + ローカル即時反映 + SE + エフェクト
  const sendAction = useCallback((action: Action) => {
    seqRef.current++;
    // サーバーにも送信（攻撃処理・スコア記録等のため）
    socket.emit('input:action', { action, seq: seqRef.current });

    // アクション別SE
    if (action === 'hard_drop') soundManager.playSE('harddrop');
    else if (action === 'rotate_cw' || action === 'rotate_ccw') soundManager.playSE('rotate');
    else if (action === 'hold') soundManager.playSE('hold');

    const engine = localEngineRef.current;
    if (engine) {
      // ハードドロップエフェクト（ローカルエンジンの現在ピースから計算）
      const stateBefore = engine.getState();
      if (action === 'hard_drop' && stateBefore.currentPiece && canvasRef.current) {
        const piece = stateBefore.currentPiece;
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
            if (r >= 0 && stateBefore.board[r][c] !== 0) return true;
            return false;
          });
          if (collision) break;
          y = nextY;
        }
        const finalCells = getPieceCellsForRender({ ...piece, y });
        canvasRef.current.triggerHardDrop(finalCells);
      }

      // ローカルエンジンに即座に適用
      const result = engine.applyAction(action);

      // ライン消去SE＋エフェクト（ハードドロップによるライン消去）
      if (result && result.linesCleared > 0) {
        soundManager.playLineClear(result.linesCleared);
        if (canvasRef.current) {
          canvasRef.current.triggerLineClear(result.clearedRows);
        }
      }

      // 即座にローカル状態を更新（遅延ゼロ）
      setLocalState(engine.getState());
    } else {
      // ローカルエンジンがない場合の旧フォールバック
      if (action === 'hard_drop' && localState?.currentPiece && localState?.board && canvasRef.current) {
        const piece = localState.currentPiece;
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
    }
  }, [localState]);

  // ポーズ切替
  const togglePause = useCallback(() => {
    if (!isSolo || !gameActive || localState?.isGameOver) return;
    const engine = localEngineRef.current;
    if (!engine) return;
    if (engine.isPaused()) {
      engine.resume();
      setPaused(false);
    } else {
      engine.pause();
      setPaused(true);
    }
  }, [isSolo, gameActive, localState?.isGameOver]);

  // メニュー表示
  const openMenu = useCallback(() => {
    if (isSolo && localEngineRef.current && gameActive && !localState?.isGameOver) {
      localEngineRef.current.pause();
      setPaused(true);
    }
    setShowMenu(true);
    setShowOptions(false);
  }, [isSolo, gameActive, localState?.isGameOver]);

  const closeMenu = useCallback(() => {
    setShowMenu(false);
    setShowOptions(false);
    if (isSolo && localEngineRef.current) {
      localEngineRef.current.resume();
      setPaused(false);
    }
  }, [isSolo]);

  // Escキーでメニュー表示/非表示
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showMenu) closeMenu();
        else if (gameActive && !localState?.isGameOver) openMenu();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showMenu, gameActive, localState?.isGameOver, openMenu, closeMenu]);

  // キー割り当てリスナー
  useEffect(() => {
    if (!rebindAction) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') { setRebindAction(null); return; }
      // 既存のキーを削除してから新しいキーを設定
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

  // 音量変更
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

  // 初期音量設定
  useEffect(() => {
    soundManager.setBGMVolume(bgmVol);
    soundManager.setSEVolume(seVol);
  }, []);

  // Input handler (ポーズ中・メニュー中は無効)
  useInputHandler(gameActive && !(localState?.isGameOver) && !paused && !showMenu, settings, sendAction, keyMap);

  const otherPlayers = (roomState?.players ?? []).filter(p => p.socketId !== socket.id);

  // 対戦で勝者かどうか
  const isWinner = !isSolo && gameOverData?.winnerId === socket.id;

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
      {/* Top right buttons */}
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 300, display: 'flex', gap: 8 }}>
        {/* Menu button */}
        <button
          onClick={openMenu}
          style={{
            background: 'rgba(30,30,60,0.8)',
            border: '1px solid #3a3a5c',
            borderRadius: 8,
            padding: '6px 12px',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          MENU
        </button>
        {/* Solo pause button */}
        {isSolo && gameActive && !localState?.isGameOver && (
          <button
            onClick={togglePause}
            style={{
              background: paused ? 'rgba(74,108,247,0.8)' : 'rgba(30,30,60,0.8)',
              border: '1px solid #3a3a5c',
              borderRadius: 8,
              padding: '6px 12px',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {paused ? '▶' : '⏸'}
          </button>
        )}
        {/* Mute button */}
        <button
          onClick={() => setMuted(soundManager.toggleMute())}
          style={{
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
      </div>

      {/* Pause overlay (solo) */}
      {paused && !showMenu && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', zIndex: 200,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, fontWeight: 900, color: '#fff', marginBottom: 16 }}>PAUSE</div>
            <button className="btn-primary" onClick={togglePause} style={{ padding: '12px 32px', fontSize: 16 }}>
              再開
            </button>
          </div>
        </div>
      )}

      {/* Menu overlay */}
      {showMenu && !showOptions && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', zIndex: 250,
        }}>
          <div style={{
            background: '#16162a', border: '1px solid #3a3a5c', borderRadius: 12,
            padding: 32, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <h2 style={{ textAlign: 'center', margin: 0, fontSize: 20 }}>メニュー</h2>
            <button className="btn-primary" onClick={closeMenu} style={{ padding: '12px', fontSize: 16 }}>
              プレイ中画面に戻る
            </button>
            <button className="btn-secondary" onClick={() => setShowOptions(true)} style={{ padding: '12px', fontSize: 16 }}>
              オプション
            </button>
            <button className="btn-danger" onClick={quitGame} style={{ padding: '12px', fontSize: 16 }}>
              終了する
            </button>
          </div>
        </div>
      )}

      {/* Options overlay */}
      {showMenu && showOptions && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)', zIndex: 250,
        }}>
          <div style={{
            background: '#16162a', border: '1px solid #3a3a5c', borderRadius: 12,
            padding: 28, minWidth: 360, maxHeight: '80vh', overflowY: 'auto',
          }}>
            <h2 style={{ textAlign: 'center', margin: '0 0 16px', fontSize: 20 }}>オプション</h2>

            {/* BGM Volume */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#aaa', fontSize: 14 }}>
                <span style={{ minWidth: 80 }}>BGM音量</span>
                <input type="range" min={0} max={100} value={bgmVol}
                  onChange={e => handleBgmVol(Number(e.target.value))}
                  style={{ flex: 1 }} />
                <span style={{ minWidth: 36, textAlign: 'right', color: '#fff' }}>{bgmVol}%</span>
              </label>
            </div>

            {/* SE Volume */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#aaa', fontSize: 14 }}>
                <span style={{ minWidth: 80 }}>SE音量</span>
                <input type="range" min={0} max={100} value={seVol}
                  onChange={e => handleSeVol(Number(e.target.value))}
                  style={{ flex: 1 }} />
                <span style={{ minWidth: 36, textAlign: 'right', color: '#fff' }}>{seVol}%</span>
              </label>
            </div>

            {/* Key bindings */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: '#aaa', fontSize: 14, marginBottom: 8 }}>ボタン割り当て</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {([
                    ['move_left', '左移動'],
                    ['move_right', '右移動'],
                    ['soft_drop', 'ソフトドロップ'],
                    ['hard_drop', 'ハードドロップ'],
                    ['rotate_cw', '右回転'],
                    ['rotate_ccw', '左回転'],
                    ['hold', 'ホールド'],
                  ] as [Action, string][]).map(([action, label]) => {
                    const currentKey = Object.entries(keyMap).find(([, v]) => v === action)?.[0] ?? '-';
                    const isRebinding = rebindAction === action;
                    return (
                      <tr key={action} style={{ borderBottom: '1px solid #2a2a4a' }}>
                        <td style={{ padding: '6px 4px', color: '#ccc' }}>{label}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                          <button
                            onClick={() => setRebindAction(isRebinding ? null : action)}
                            style={{
                              background: isRebinding ? '#4a6cf7' : '#2a2a4a',
                              color: '#fff', border: 'none', borderRadius: 4,
                              padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                              minWidth: 80,
                            }}
                          >
                            {isRebinding ? 'キーを押して...' : displayKey(currentKey)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button className="btn-secondary" onClick={() => setShowOptions(false)}
              style={{ width: '100%', padding: '10px', fontSize: 15 }}>
              戻る
            </button>
          </div>
        </div>
      )}

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
        {/* ソロ: GAME OVER + リザルトへボタン */}
        {isSolo && localState?.isGameOver && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.7)',
            borderRadius: 4,
            gap: 24,
          }}>
            <div style={{
              fontSize: 40,
              fontWeight: 900,
              color: '#e74c3c',
              textShadow: '0 0 30px rgba(231,76,60,0.6)',
              letterSpacing: 4,
            }}>
              GAME OVER
            </div>
            <button
              className="btn-primary"
              onClick={goToResult}
              style={{
                padding: '14px 36px',
                fontSize: 18,
                fontWeight: 700,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              リザルトを見る
            </button>
          </div>
        )}
        {/* 対戦: 自分がゲームオーバー */}
        {!isSolo && localState?.isGameOver && !isWinner && (
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
        {/* 対戦: WINNER!! */}
        {!isSolo && isWinner && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            borderRadius: 4,
          }}>
            <div style={{
              fontSize: 44,
              fontWeight: 900,
              color: '#ffd700',
              textShadow: '0 0 40px rgba(255,215,0,0.8), 0 0 80px rgba(255,215,0,0.4)',
              letterSpacing: 6,
              animation: 'pulse 1s ease-in-out infinite',
            }}>
              WINNER!!
            </div>
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

function displayKey(key: string): string {
  const map: Record<string, string> = {
    ' ': 'Space',
    'ArrowLeft': '←',
    'ArrowRight': '→',
    'ArrowUp': '↑',
    'ArrowDown': '↓',
    'Shift': 'Shift',
    'Control': 'Ctrl',
    'Alt': 'Alt',
    'Meta': 'Cmd',
    'Enter': 'Enter',
    'Backspace': 'BS',
    'Tab': 'Tab',
  };
  return map[key] ?? key.toUpperCase();
}
