import { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from './socket.ts';
import LobbyPage from './pages/LobbyPage.tsx';
import WaitingPage from './pages/WaitingPage.tsx';
import GamePage from './pages/GamePage.tsx';
import ResultPage from './pages/ResultPage.tsx';
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

  useEffect(() => {
    const onRoomState = (data: RoomState) => {
      setRoomState(data);
      if (data.status === 'waiting' && screen === 'lobby') {
        setScreen('waiting');
      }
    };

    const onGameReady = (data: GameReadyData) => {
      setGameReadyData(data);
      setScreen('game');
    };

    const onGameOver = (data: GameOverData) => {
      setGameOverData(data);
      setScreen('result');
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
    setScreen('lobby');
  }, []);

  const goToWaitingFromLobby = useCallback(() => {
    setScreen('waiting');
  }, []);

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
        />
      );
    case 'result':
      return <ResultPage gameOverData={gameOverData} goToLobby={goToLobby} />;
  }
}
