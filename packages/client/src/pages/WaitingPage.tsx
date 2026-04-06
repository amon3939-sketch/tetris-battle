import { useState } from 'react';
import { socket } from '../socket.ts';
import ChatBox from '../components/ChatBox.tsx';

interface RoomState {
  room: { id: string; name: string };
  players: Array<{ socketId: string; nickname: string }>;
  hostSocketId: string;
  maxPlayers?: number;
  hasPassword?: boolean;
  status: string;
}

interface Props {
  roomState: RoomState | null;
  goToLobby: () => void;
}

export default function WaitingPage({ roomState, goToLobby }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(roomState?.maxPlayers ?? 4);
  const [password, setPassword] = useState('');

  if (!roomState) return null;

  const isHost = roomState.hostSocketId === socket.id;

  const handleStart = () => {
    socket.emit('game:start');
  };

  const handleLeave = () => {
    goToLobby();
  };

  const handleUpdateSettings = () => {
    socket.emit('room:update', {
      maxPlayers,
      password: password || null,
    });
    setShowSettings(false);
  };

  return (
    <div className="page">
      <h1>{roomState.room.name}</h1>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>
          参加者 ({roomState.players.length}/{roomState.maxPlayers ?? '?'}人)
        </h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {roomState.players.map(p => (
            <li
              key={p.socketId}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #2a2a4a',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>{p.nickname}</span>
              {p.socketId === roomState.hostSocketId && (
                <span style={{
                  fontSize: 11,
                  background: '#f0a000',
                  color: '#000',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontWeight: 700,
                }}>
                  HOST
                </span>
              )}
              {p.socketId === socket.id && (
                <span style={{ fontSize: 12, color: '#4a6cf7' }}>(自分)</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {isHost && (
          <>
            <button className="btn-primary" onClick={handleStart}>
              ゲーム開始
            </button>
            <button className="btn-secondary" onClick={() => setShowSettings(!showSettings)}>
              ルーム設定
            </button>
          </>
        )}
        <button className="btn-danger" onClick={handleLeave}>
          退出
        </button>
      </div>

      {/* ホスト設定変更パネル */}
      {showSettings && isHost && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>ルーム設定変更</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ color: '#aaa', minWidth: 80 }}>上限人数</span>
              <select value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))}
                style={{ padding: '6px 10px' }}>
                {[2, 3, 4, 5, 6, 7, 8].map(n => (
                  <option key={n} value={n}>{n}人</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ color: '#aaa', minWidth: 80 }}>パスワード</span>
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="空欄で解除"
                style={{ flex: 1 }}
              />
            </label>
            <button className="btn-primary" onClick={handleUpdateSettings}
              style={{ alignSelf: 'flex-end', padding: '6px 16px', fontSize: 13 }}>
              適用
            </button>
          </div>
        </div>
      )}

      <ChatBox roomId={roomState.room.id} />
    </div>
  );
}
