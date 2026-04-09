import { useState, useEffect } from 'react';
import { socket } from '../socket.ts';
import { generateFingerprint } from '../fingerprint.ts';
import { soundManager } from '../sounds.ts';

interface RoomListItem {
  id: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  hasPassword: boolean;
  status: string;
}

interface RankingEntry {
  nickname: string;
  totalWins: number;
  totalMatches: number;
  winRate: number;
  bestScore: number;
  totalLines: number;
  bestLines: number;
}

interface Props {
  nickname: string;
  setNickname: (n: string) => void;
}

export default function LobbyPage({ nickname, setNickname }: Props) {
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [soloRanking, setSoloRanking] = useState<RankingEntry[]>([]);
  const [multiRanking, setMultiRanking] = useState<RankingEntry[]>([]);
  const [rankingTab, setRankingTab] = useState<'solo' | 'multi'>('solo');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showPassword, setShowPassword] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    soundManager.load();

    const startBGMOnInteraction = () => {
      soundManager.playBGM('lobby');
      document.removeEventListener('click', startBGMOnInteraction);
      document.removeEventListener('keydown', startBGMOnInteraction);
    };
    soundManager.playBGM('lobby');
    document.addEventListener('click', startBGMOnInteraction);
    document.addEventListener('keydown', startBGMOnInteraction);

    const onConnect = () => {
      setConnected(true);
      const name = nickname || 'Guest';
      socket.emit('player:setNickname', {
        nickname: name,
        fingerprint: generateFingerprint(),
      });
      socket.emit('ranking:get', { mode: 'solo' });
      socket.emit('ranking:get', { mode: 'multi' });
    };

    const onDisconnect = () => setConnected(false);
    const onRoomList = (list: RoomListItem[]) => setRooms(list);
    const onRoomError = (data: { code: string; message: string }) => setError(data.message);
    const onRanking = (data: { mode: string; ranking: RankingEntry[] }) => {
      if (data.mode === 'solo') setSoloRanking(data.ranking);
      else if (data.mode === 'multi') setMultiRanking(data.ranking);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:list', onRoomList);
    socket.on('room:error', onRoomError);
    socket.on('ranking:data', onRanking);

    if (!socket.connected) {
      socket.connect();
    } else {
      onConnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:list', onRoomList);
      socket.off('room:error', onRoomError);
      socket.off('ranking:data', onRanking);
      document.removeEventListener('click', startBGMOnInteraction);
      document.removeEventListener('keydown', startBGMOnInteraction);
    };
  }, []);

  const handleNicknameChange = (name: string) => {
    setNickname(name);
    localStorage.setItem('tetris_nickname', name);
    if (socket.connected) {
      socket.emit('player:setNickname', {
        nickname: name || 'Guest',
        fingerprint: generateFingerprint(),
      });
    }
  };

  const handleJoin = (room: RoomListItem) => {
    setError('');
    if (room.hasPassword) {
      setShowPassword(room.id);
    } else {
      socket.emit('room:join', { roomId: room.id });
    }
  };

  const handlePasswordJoin = (roomId: string, password: string) => {
    setShowPassword(null);
    socket.emit('room:join', { roomId, password });
  };

  const currentRanking = rankingTab === 'solo' ? soloRanking : multiRanking;

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
        maxWidth: 900, margin: '0 auto', padding: '30px 20px',
      }}>
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{
            fontSize: 48, fontWeight: 900, letterSpacing: 8,
            color: '#00ccff',
            textShadow: '0 0 20px rgba(0,200,255,0.6), 0 0 60px rgba(0,200,255,0.3), 0 2px 4px rgba(0,0,0,0.8)',
            margin: 0,
          }}>TETRIS BATTLE</h1>
          <div style={{
            fontSize: 13, color: 'rgba(0,200,255,0.5)', letterSpacing: 4,
            marginTop: 4,
          }}>ONLINE MULTIPLAYER</div>
        </div>

        {/* Nickname + Connection */}
        <div className="t99-frame" style={{
          padding: '14px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ color: 'rgba(0,200,255,0.7)', fontSize: 12, fontWeight: 700, letterSpacing: 1, whiteSpace: 'nowrap' }}>
            PLAYER NAME
          </span>
          <input
            value={nickname}
            onChange={e => handleNicknameChange(e.target.value)}
            placeholder="名前を入力"
            style={{
              flex: 1, maxWidth: 280,
              background: 'rgba(0,15,40,0.6)', border: '1px solid rgba(0,200,255,0.3)',
              borderRadius: 6, padding: '8px 12px', color: '#fff', fontSize: 15,
              outline: 'none',
            }}
          />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#00ff88' : '#ff4444',
              boxShadow: connected ? '0 0 8px rgba(0,255,136,0.6)' : '0 0 8px rgba(255,68,68,0.6)',
            }} />
            <span style={{ fontSize: 12, color: connected ? '#00ff88' : '#ff4444', fontWeight: 600 }}>
              {connected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Share URL */}
        <ShareUrlBox />

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <button onClick={() => {
            if (!connected) return;
            socket.emit('game:solo');
          }} style={{
            padding: '14px 32px', fontSize: 16, fontWeight: 900,
            background: 'linear-gradient(180deg, #00cc88, #008855)',
            color: '#fff', border: '2px solid rgba(0,255,136,0.5)',
            borderRadius: 8, cursor: 'pointer', letterSpacing: 2,
            boxShadow: '0 0 20px rgba(0,200,100,0.3)',
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}>
            SOLO PLAY
          </button>
          <button onClick={() => setShowCreate(true)} style={{
            padding: '14px 32px', fontSize: 16, fontWeight: 900,
            background: 'linear-gradient(180deg, #0088ff, #0055cc)',
            color: '#fff', border: '2px solid rgba(0,150,255,0.5)',
            borderRadius: 8, cursor: 'pointer', letterSpacing: 2,
            boxShadow: '0 0 20px rgba(0,136,255,0.3)',
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}>
            CREATE ROOM
          </button>
          <button onClick={() => socket.emit('room:list')} style={{
            padding: '14px 20px', fontSize: 14, fontWeight: 700,
            background: 'rgba(0,30,60,0.8)', color: '#00ccff',
            border: '1px solid rgba(0,200,255,0.3)', borderRadius: 8,
            cursor: 'pointer',
          }}>
            REFRESH
          </button>
        </div>

        {error && <div style={{ color: '#ff4444', fontSize: 13, marginBottom: 12, textShadow: '0 0 8px rgba(255,68,68,0.4)' }}>{error}</div>}

        {/* Room List */}
        <div className="t99-frame" style={{ padding: 0, marginBottom: 24, overflow: 'hidden', position: 'relative' }}>
          <div className="t99-frame-label">ROOMS</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(0,50,100,0.3)' }}>
                <th style={thStyle}>ルーム名</th>
                <th style={{ ...thStyle, width: 80 }}>人数</th>
                <th style={{ ...thStyle, width: 50 }}>鍵</th>
                <th style={{ ...thStyle, width: 80 }}>状態</th>
                <th style={{ ...thStyle, width: 70 }}></th>
              </tr>
            </thead>
            <tbody>
              {rooms.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'rgba(0,200,255,0.4)', fontSize: 14 }}>
                    ルームがありません
                  </td>
                </tr>
              )}
              {rooms.map(room => (
                <tr key={room.id} style={{ borderBottom: '1px solid rgba(0,150,200,0.15)' }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600, color: '#fff' }}>{room.name}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      color: room.playerCount >= room.maxPlayers ? '#ff4444' : '#00ccff',
                      fontWeight: 700,
                    }}>
                      {room.playerCount}/{room.maxPlayers}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {room.hasPassword ? <span style={{ color: '#ffaa00' }}>🔒</span> : <span style={{ color: 'rgba(0,200,255,0.3)' }}>-</span>}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: 1,
                      color: room.status === 'waiting' ? '#00ff88' : '#ffaa00',
                    }}>
                      {room.status === 'waiting' ? 'WAITING' : 'PLAYING'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => handleJoin(room)}
                      disabled={room.status === 'playing' || room.playerCount >= room.maxPlayers}
                      style={{
                        padding: '5px 14px', fontSize: 12, fontWeight: 700,
                        background: room.status === 'playing' || room.playerCount >= room.maxPlayers
                          ? 'rgba(0,30,60,0.5)' : 'linear-gradient(180deg, #0088ff, #0055cc)',
                        color: '#fff', border: '1px solid rgba(0,150,255,0.4)',
                        borderRadius: 5, cursor: 'pointer',
                        opacity: room.status === 'playing' || room.playerCount >= room.maxPlayers ? 0.4 : 1,
                      }}
                    >
                      JOIN
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Ranking */}
        <div className="t99-frame" style={{ padding: 0, overflow: 'hidden', position: 'relative' }}>
          <div className="t99-frame-label">RANKING</div>

          {/* Tabs */}
          <div style={{ display: 'flex', background: 'rgba(0,30,60,0.4)' }}>
            <button onClick={() => setRankingTab('solo')} style={{
              flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, letterSpacing: 2,
              background: rankingTab === 'solo' ? 'rgba(0,100,200,0.3)' : 'transparent',
              color: rankingTab === 'solo' ? '#00ccff' : 'rgba(0,200,255,0.4)',
              border: 'none', borderBottom: rankingTab === 'solo' ? '2px solid #00ccff' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s',
            }}>SOLO</button>
            <button onClick={() => setRankingTab('multi')} style={{
              flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700, letterSpacing: 2,
              background: rankingTab === 'multi' ? 'rgba(0,100,200,0.3)' : 'transparent',
              color: rankingTab === 'multi' ? '#00ccff' : 'rgba(0,200,255,0.4)',
              border: 'none', borderBottom: rankingTab === 'multi' ? '2px solid #00ccff' : '2px solid transparent',
              cursor: 'pointer', transition: 'all 0.2s',
            }}>MULTI</button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(0,50,100,0.2)' }}>
                <th style={{ ...thStyle, width: 36 }}>#</th>
                <th style={thStyle}>プレイヤー</th>
                {rankingTab === 'multi' && <th style={{ ...thStyle, width: 60 }}>勝利</th>}
                {rankingTab === 'multi' && <th style={{ ...thStyle, width: 60 }}>勝率</th>}
                <th style={{ ...thStyle, width: 100 }}>最高スコア</th>
                <th style={{ ...thStyle, width: 80 }}>
                  {rankingTab === 'solo' ? '最高ライン' : '総ライン'}
                </th>
              </tr>
            </thead>
            <tbody>
              {currentRanking.length === 0 && (
                <tr>
                  <td colSpan={rankingTab === 'multi' ? 6 : 4} style={{ padding: 30, textAlign: 'center', color: 'rgba(0,200,255,0.4)', fontSize: 14 }}>
                    まだ記録がありません
                  </td>
                </tr>
              )}
              {currentRanking.map((entry, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(0,150,200,0.1)' }}>
                  <td style={{
                    ...tdStyle, fontWeight: 900, fontSize: 16, textAlign: 'center',
                    color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'rgba(0,200,255,0.5)',
                    textShadow: i === 0 ? '0 0 10px rgba(255,215,0,0.5)' : 'none',
                  }}>
                    {i + 1}
                  </td>
                  <td style={{ ...tdStyle, color: '#fff', fontWeight: 600 }}>{entry.nickname}</td>
                  {rankingTab === 'multi' && (
                    <td style={{ ...tdStyle, color: '#00ff88', fontWeight: 700 }}>{entry.totalWins}</td>
                  )}
                  {rankingTab === 'multi' && (
                    <td style={{ ...tdStyle, color: '#00ccff' }}>{(entry.winRate * 100).toFixed(0)}%</td>
                  )}
                  <td style={{ ...tdStyle, color: '#ffaa00', fontWeight: 700 }}>
                    {entry.bestScore.toLocaleString()}
                  </td>
                  <td style={{ ...tdStyle, color: 'rgba(0,200,255,0.6)' }}>
                    {rankingTab === 'solo' ? entry.bestLines : entry.totalLines}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Modals */}
        {showCreate && <CreateRoomModal onClose={() => setShowCreate(false)} nickname={nickname} />}
        {showPassword && <PasswordModal roomId={showPassword} onClose={() => setShowPassword(null)} onJoin={handlePasswordJoin} />}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px', textAlign: 'left',
  color: 'rgba(0,200,255,0.7)', fontSize: 11, fontWeight: 700,
  letterSpacing: 1, textTransform: 'uppercase' as const,
  borderBottom: '1px solid rgba(0,150,200,0.2)',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 14,
};

function CreateRoomModal({ onClose, nickname }: { onClose: () => void; nickname: string }) {
  const [name, setName] = useState(`${nickname || 'Guest'}の部屋`);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [password, setPassword] = useState('');

  const handleCreate = () => {
    socket.emit('room:create', {
      name: name || 'ルーム',
      maxPlayers,
      password: password || undefined,
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 100 }} onClick={onClose}>
      <div className="t99-frame" style={{ padding: 28, minWidth: 360 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ color: '#00ccff', fontSize: 18, marginBottom: 20, textAlign: 'center', letterSpacing: 2, textShadow: '0 0 10px rgba(0,200,255,0.4)' }}>
          CREATE ROOM
        </h2>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'rgba(0,200,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>ROOM NAME</div>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'rgba(0,200,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>MAX PLAYERS</div>
          <select value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))} style={inputStyle}>
            {[2, 3, 4, 5, 6, 7, 8].map(n => (
              <option key={n} value={n}>{n}人</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: 'rgba(0,200,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>PASSWORD (OPTIONAL)</div>
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="未入力で公開" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>CANCEL</button>
          <button onClick={handleCreate} style={btnPrimary}>CREATE</button>
        </div>
      </div>
    </div>
  );
}

function ShareUrlBox() {
  const [copied, setCopied] = useState(false);
  const { hostname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="t99-frame" style={{ padding: '10px 14px', marginBottom: 20, fontSize: 13 }}>
      {isLocal ? (
        <div style={{ color: 'rgba(0,200,255,0.4)', fontSize: 12 }}>
          ローカル環境で実行中です。離れた場所の相手と対戦するにはクラウドにデプロイしてください。
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'rgba(0,200,255,0.6)', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>SHARE URL</span>
          <code style={{
            flex: 1, background: 'rgba(0,15,40,0.6)', padding: '4px 10px', borderRadius: 4,
            color: '#00ccff', fontSize: 12, wordBreak: 'break-all', userSelect: 'all',
            border: '1px solid rgba(0,150,200,0.2)',
          }}>
            {window.location.origin}
          </code>
          <button onClick={handleCopy} style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 700,
            background: copied ? 'rgba(0,200,100,0.3)' : 'rgba(0,60,120,0.5)',
            color: copied ? '#00ff88' : '#00ccff',
            border: '1px solid rgba(0,200,255,0.3)', borderRadius: 4, cursor: 'pointer',
          }}>
            {copied ? 'COPIED' : 'COPY'}
          </button>
        </div>
      )}
    </div>
  );
}

function PasswordModal({ roomId, onClose, onJoin }: { roomId: string; onClose: () => void; onJoin: (id: string, pw: string) => void }) {
  const [pw, setPw] = useState('');

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', zIndex: 100 }} onClick={onClose}>
      <div className="t99-frame" style={{ padding: 28, minWidth: 320 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ color: '#00ccff', fontSize: 18, marginBottom: 20, textAlign: 'center', letterSpacing: 2 }}>
          PASSWORD
        </h2>
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: 'rgba(0,200,255,0.6)', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>ENTER PASSWORD</div>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onJoin(roomId, pw)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>CANCEL</button>
          <button onClick={() => onJoin(roomId, pw)} style={btnPrimary}>JOIN</button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(0,15,40,0.6)',
  border: '1px solid rgba(0,200,255,0.3)', borderRadius: 6,
  padding: '8px 12px', color: '#fff', fontSize: 14, outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  padding: '10px 24px', fontSize: 14, fontWeight: 700,
  background: 'linear-gradient(180deg, #0088ff, #0055cc)',
  color: '#fff', border: '2px solid rgba(0,150,255,0.5)',
  borderRadius: 6, cursor: 'pointer', letterSpacing: 1,
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 24px', fontSize: 14, fontWeight: 700,
  background: 'rgba(0,30,60,0.8)', color: 'rgba(0,200,255,0.7)',
  border: '1px solid rgba(0,200,255,0.3)', borderRadius: 6, cursor: 'pointer',
};
