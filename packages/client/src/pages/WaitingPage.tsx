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
  const playersNeeded = (roomState.maxPlayers ?? 2) - roomState.players.length;

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
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh', overflow: 'auto' }}>
      {/* Water background */}
      <div className="water-bg">
        <div className="water-caustics-layer">
          <div className="caustic" /><div className="caustic" /><div className="caustic" />
          <div className="caustic" /><div className="caustic" />
        </div>
        <div className="water-rays" />
      </div>

      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: 600, margin: '0 auto', padding: '40px 20px',
      }}>
        {/* Room Title */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{
            fontSize: 32, fontWeight: 900, letterSpacing: 4,
            color: '#00ccff', margin: 0,
            textShadow: '0 0 15px rgba(0,200,255,0.5), 0 2px 4px rgba(0,0,0,0.8)',
          }}>{roomState.room.name}</h1>
          <div style={{
            fontSize: 12, color: 'rgba(0,200,255,0.4)', letterSpacing: 3, marginTop: 6,
          }}>WAITING FOR PLAYERS</div>
        </div>

        {/* Player List */}
        <div className="t99-frame" style={{ padding: 0, marginBottom: 20, position: 'relative' }}>
          <div className="t99-frame-label">PLAYERS</div>
          <div style={{
            padding: '14px 16px 6px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ color: 'rgba(0,200,255,0.6)', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
              {roomState.players.length} / {roomState.maxPlayers ?? '?'}
            </span>
            {playersNeeded > 0 && (
              <span style={{ color: '#ffaa00', fontSize: 11, fontWeight: 600 }}>
                あと {playersNeeded}人
              </span>
            )}
          </div>
          <div style={{ padding: '0 8px 8px' }}>
            {roomState.players.map((p, i) => (
              <div
                key={p.socketId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  borderBottom: i < roomState.players.length - 1 ? '1px solid rgba(0,150,200,0.1)' : 'none',
                }}
              >
                {/* Player icon */}
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: p.socketId === roomState.hostSocketId
                    ? 'linear-gradient(135deg, #ffaa00, #ff6600)' : 'linear-gradient(135deg, #0088ff, #0055cc)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 900, color: '#fff',
                  boxShadow: p.socketId === roomState.hostSocketId
                    ? '0 0 10px rgba(255,170,0,0.4)' : '0 0 10px rgba(0,136,255,0.3)',
                }}>
                  {i + 1}
                </div>
                <span style={{ color: '#fff', fontWeight: 600, fontSize: 15, flex: 1 }}>
                  {p.nickname}
                </span>
                {p.socketId === roomState.hostSocketId && (
                  <span style={{
                    fontSize: 10, fontWeight: 900, letterSpacing: 1,
                    background: 'linear-gradient(135deg, #ffaa00, #ff8800)',
                    color: '#000', padding: '3px 8px', borderRadius: 4,
                  }}>HOST</span>
                )}
                {p.socketId === socket.id && (
                  <span style={{ fontSize: 11, color: '#00ccff', fontWeight: 600 }}>YOU</span>
                )}
              </div>
            ))}
            {/* Empty slots */}
            {Array.from({ length: playersNeeded }).map((_, i) => (
              <div key={`empty-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                borderBottom: i < playersNeeded - 1 ? '1px solid rgba(0,150,200,0.1)' : 'none',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: 'rgba(0,30,60,0.5)', border: '2px dashed rgba(0,200,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: 'rgba(0,200,255,0.2)',
                }}>?</div>
                <span style={{ color: 'rgba(0,200,255,0.3)', fontSize: 13, fontStyle: 'italic' }}>
                  待機中...
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {isHost && (
            <>
              <button onClick={handleStart} style={{
                flex: 1, padding: '14px 24px', fontSize: 16, fontWeight: 900,
                background: playersNeeded > 0
                  ? 'rgba(0,30,60,0.5)' : 'linear-gradient(180deg, #00cc88, #008855)',
                color: '#fff',
                border: playersNeeded > 0
                  ? '2px solid rgba(0,200,255,0.2)' : '2px solid rgba(0,255,136,0.5)',
                borderRadius: 8, cursor: playersNeeded > 0 ? 'not-allowed' : 'pointer',
                letterSpacing: 2, opacity: playersNeeded > 0 ? 0.5 : 1,
                boxShadow: playersNeeded > 0 ? 'none' : '0 0 20px rgba(0,200,100,0.3)',
                textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}>
                ゲーム開始
              </button>
              <button onClick={() => setShowSettings(!showSettings)} style={{
                padding: '14px 20px', fontSize: 13, fontWeight: 700,
                background: 'rgba(0,30,60,0.8)', color: '#00ccff',
                border: '1px solid rgba(0,200,255,0.3)', borderRadius: 8, cursor: 'pointer',
              }}>
                ルーム設定
              </button>
            </>
          )}
          <button onClick={handleLeave} style={{
            padding: '14px 20px', fontSize: 13, fontWeight: 700,
            background: 'rgba(80,20,20,0.6)', color: '#ff6666',
            border: '1px solid rgba(255,100,100,0.3)', borderRadius: 8, cursor: 'pointer',
          }}>
            退出
          </button>
        </div>

        {/* Host Settings Panel */}
        {showSettings && isHost && (
          <div className="t99-frame" style={{ padding: 20, marginBottom: 20, position: 'relative' }}>
            <div className="t99-frame-label">ルーム設定</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
              <div>
                <div style={{ color: 'rgba(0,200,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>MAX PLAYERS</div>
                <select value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))}
                  style={{
                    width: '100%', background: 'rgba(0,15,40,0.6)',
                    border: '1px solid rgba(0,200,255,0.3)', borderRadius: 6,
                    padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none',
                  }}>
                  {[2, 3, 4, 5, 6, 7, 8].map(n => (
                    <option key={n} value={n}>{n}人</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={{ color: 'rgba(0,200,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>PASSWORD</div>
                <input
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="空欄で解除"
                  style={{
                    width: '100%', background: 'rgba(0,15,40,0.6)',
                    border: '1px solid rgba(0,200,255,0.3)', borderRadius: 6,
                    padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none',
                  }}
                />
              </div>
              <button onClick={handleUpdateSettings} style={{
                alignSelf: 'flex-end', padding: '8px 20px', fontSize: 13, fontWeight: 700,
                background: 'linear-gradient(180deg, #0088ff, #0055cc)',
                color: '#fff', border: '2px solid rgba(0,150,255,0.5)',
                borderRadius: 6, cursor: 'pointer',
              }}>適用</button>
            </div>
          </div>
        )}

        {/* Chat */}
        <ChatBox roomId={roomState.room.id} />
      </div>
    </div>
  );
}
