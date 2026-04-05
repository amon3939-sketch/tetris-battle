import { socket } from '../socket.ts';
import ChatBox from '../components/ChatBox.tsx';

interface RoomState {
  room: { id: string; name: string };
  players: Array<{ socketId: string; nickname: string }>;
  hostSocketId: string;
  status: string;
}

interface Props {
  roomState: RoomState | null;
  goToLobby: () => void;
}

export default function WaitingPage({ roomState, goToLobby }: Props) {
  if (!roomState) return null;

  const isHost = roomState.hostSocketId === socket.id;

  const handleStart = () => {
    socket.emit('game:start');
  };

  const handleLeave = () => {
    goToLobby();
  };

  return (
    <div className="page">
      <h1>{roomState.room.name}</h1>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>
          参加者 ({roomState.players.length}人)
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {isHost && (
          <button className="btn-primary" onClick={handleStart}>
            ゲーム開始
          </button>
        )}
        <button className="btn-danger" onClick={handleLeave}>
          退出
        </button>
      </div>

      <ChatBox roomId={roomState.room.id} />
    </div>
  );
}
