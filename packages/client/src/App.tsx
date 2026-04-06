import { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from './socket.ts';
import LobbyPage from './pages/LobbyPage.tsx';
import WaitingPage from './pages/WaitingPage.tsx';
import GamePage from './pages/GamePage.tsx';
import ResultPage from './pages/ResultPage.tsx';
import { soundManager } from './sounds.ts';
import type { Board } from '@tetris/engine/src/types.ts';

type Screen = 'lobby' | 'waiting' | 'game' | 'result';

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

export default function App() {
  const [screen, setScreen] = useState<Screen>('lobby');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameReadyData, setGameReadyData] = useState<GameReadyData | null>(null);
  const [gameOverData, setGameOverData] = useState<GameOverData | null>(null);
  const [nickname, setNickname] = useState(() => localStorage.getItem('tetris_nickname') || '');
  // ソロモード時: game:over を受けても即座に result に遷移せず GamePage 内で待つ
  const pendingGameOverRef = useRef<GameOverData | null>(null);
  const isSoloRef = useRef(false);

  useEffect(() => {
    const onRoomState = (data: RoomState) => {
      setRoomState(data);
      if (data.status === 'waiting' && screen === 'lobby') {
        setScreen('waiting');
      }
      // 1人プレイかどうかを記録
      isSoloRef.current = data.players.length === 1;
    };

    const onGameReady = (data: GameReadyData) => {
      setGameReadyData(data);
      pendingGameOverRef.current = null;
      setScreen('game');
    };

    const onGameOver = (data: GameOverData) => {
      setGameOverData(data);
      // Don't auto-navigate. GamePage will show overlay and user clicks to proceed.
    };

    socket.on('room:state', onRoomState);
    socket.on('game:ready', onGameReady);
    socket.on('game:over', onGameOver);

    return () => {
      socket.off('room:state', onRoomState);
      socket.off('game:ready', onGameReady);
      socket.off('game:over', onGameOver);
    };
  }, [screen]);

  const goToLobby = useCallback(() => {
    socket.emit('room:leave');
    setRoomState(null);
    setGameReadyData(null);
    setGameOverData(null);
    pendingGameOverRef.current = null;
    isSoloRef.current = false;
    soundManager.stopBGM();
    soundManager.playBGM('lobby');
    setScreen('lobby');
  }, []);

  // ソロモード: ゲームオーバー画面から明示的にリザルトへ遷移
  const goToResult = useCallback(() => {
    if (gameOverData) {
      soundManager.stopBGM();
      soundManager.playBGM('result');
      setScreen('result');
    }
  }, [gameOverData]);

  // ゲーム終了後にルームに戻る（同じメンバーで再戦）
  const goToRoom = useCallback(() => {
    socket.emit('game:backToRoom');
    setGameReadyData(null);
    setGameOverData(null);
    pendingGameOverRef.current = null;
    soundManager.stopBGM();
    setScreen('waiting');
  }, []);

  // プレイ中メニューからの終了（ロビーに戻る）
  const quitGame = useCallback(() => {
    socket.emit('room:leave');
    setRoomState(null);
    setGameReadyData(null);
    setGameOverData(null);
    pendingGameOverRef.current = null;
    isSoloRef.current = false;
    soundManager.stopBGM();
    soundManager.playBGM('lobby');
    setScreen('lobby');
  }, []);

  // ソロかどうかを判定（GamePageに渡す）
  const isSolo = (roomState?.players.length ?? 0) <= 1;

  switch (screen) {
    case 'lobby':
      return <LobbyPage nickname={nickname} setNickname={setNickname} />;
    case 'waiting':
      return <WaitingPage roomState={roomState} goToLobby={goToLobby} />;
    case 'game':
      return (
        <GamePage
          roomState={roomState}
          gameReadyData={gameReadyData}
          nickname={nickname}
          isSolo={isSolo}
          gameOverData={gameOverData}
          goToResult={goToResult}
          quitGame={quitGame}
        />
      );
    case 'result':
      return <ResultPage gameOverData={gameOverData} goToLobby={goToLobby} goToRoom={goToRoom} isSolo={isSolo} />;
  }
}
