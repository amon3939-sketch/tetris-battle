import { useState, useEffect } from 'react';
import { socket } from '../socket.ts';
import { generateFingerprint } from '../fingerprint.ts';

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
}

interface Props {
  nickname: string;
  setNickname: (n: string) => void;
}

export default function LobbyPage({ nickname, setNickname }: Props) {
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showPassword, setShowPassword] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  // 接続 + ニックネーム設定
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const name = nickname || 'Guest';
      socket.emit('player:setNickname', {
        nickname: name,
        fingerprint: generateFingerprint(),
      });
      // ランキング取得
      socket.emit('ranking:get');
    };

    const onDisconnect = () => setConnected(false);
    const onRoomList = (list: RoomListItem[]) => setRooms(list);
    const onRoomError = (data: { code: string; message: string }) => setError(data.message);
    const onRanking = (data: RankingEntry[]) => setRanking(data);

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

  return (
    <div className="page">
      <h1>Tetris Battle</h1>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ color: '#aaa', whiteSpace: 'nowrap' }}>ニックネーム:</label>
        <input
          value={nickname}
          onChange={e => handleNicknameChange(e.target.value)}
          placeholder="名前を入力"
          style={{ flex: 1, maxWidth: 240 }}
        />
        <span style={{ fontSize: 12, color: connected ? '#4caf50' : '#e74c3c' }}>
          {connected ? '接続中' : '切断'}
        </span>
      </div>

      {/* 対戦用URL */}
      <ShareUrlBox />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + 新しいルームを作成
          </button>
          <button
            style={{
              padding: '8px 20px',
              background: 'linear-gradient(135deg, #4caf50, #2e7d32)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
            onClick={() => {
              if (!connected) return;
              socket.emit('game:solo');
            }}
          >
            🎮 1人プレイ
          </button>
        </div>
        <button className="btn-secondary" onClick={() => socket.emit('room:list')}>
          更新
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #3a3a5c', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>ルーム名</th>
              <th style={{ padding: '8px 4px' }}>人数</th>
              <th style={{ padding: '8px 4px' }}>パス</th>
              <th style={{ padding: '8px 4px' }}>状態</th>
              <th style={{ padding: '8px 4px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#666' }}>
                  ルームがありません
                </td>
              </tr>
            )}
            {rooms.map(room => (
              <tr key={room.id} style={{ borderBottom: '1px solid #2a2a4a' }}>
                <td style={{ padding: '8px 4px' }}>{room.name}</td>
                <td style={{ padding: '8px 4px' }}>{room.playerCount}/{room.maxPlayers}</td>
                <td style={{ padding: '8px 4px' }}>{room.hasPassword ? '🔒' : '-'}</td>
                <td style={{ padding: '8px 4px', fontSize: 12 }}>
                  {room.status === 'waiting' ? '待機中' : 'プレイ中'}
                </td>
                <td style={{ padding: '8px 4px' }}>
                  <button
                    className="btn-primary"
                    onClick={() => handleJoin(room)}
                    disabled={room.status === 'playing' || room.playerCount >= room.maxPlayers}
                    style={{ padding: '4px 12px', fontSize: 13 }}
                  >
                    参加
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ランキング */}
      <div style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>🏆 スコアランキング</h2>
        <div className="card">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #3a3a5c', textAlign: 'left' }}>
                <th style={{ padding: '8px 4px', width: 40 }}>#</th>
                <th style={{ padding: '8px 4px' }}>プレイヤー</th>
                <th style={{ padding: '8px 4px' }}>勝利</th>
                <th style={{ padding: '8px 4px' }}>試合</th>
                <th style={{ padding: '8px 4px' }}>勝率</th>
                <th style={{ padding: '8px 4px' }}>最高スコア</th>
                <th style={{ padding: '8px 4px' }}>総ライン</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#666' }}>
                    まだランキングデータがありません
                  </td>
                </tr>
              )}
              {ranking.map((entry, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #2a2a4a' }}>
                  <td style={{ padding: '6px 4px', fontWeight: 700, color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#aaa' }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '6px 4px' }}>{entry.nickname}</td>
                  <td style={{ padding: '6px 4px', color: '#4caf50', fontWeight: 700 }}>{entry.totalWins}</td>
                  <td style={{ padding: '6px 4px' }}>{entry.totalMatches}</td>
                  <td style={{ padding: '6px 4px', color: '#4a6cf7' }}>{(entry.winRate * 100).toFixed(0)}%</td>
                  <td style={{ padding: '6px 4px', color: '#f0a000', fontWeight: 700 }}>{entry.bestScore.toLocaleString()}</td>
                  <td style={{ padding: '6px 4px', color: '#aaa' }}>{entry.totalLines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <CreateRoomModal
          onClose={() => setShowCreate(false)}
          nickname={nickname}
        />
      )}

      {showPassword && (
        <PasswordModal
          roomId={showPassword}
          onClose={() => setShowPassword(null)}
          onJoin={handlePasswordJoin}
        />
      )}
    </div>
  );
}

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>新しいルームを作成</h2>
        <label>
          <span>ルーム名</span>
          <input value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label>
          <span>最大人数</span>
          <select value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))}>
            {[2, 3, 4, 5, 6, 7, 8].map(n => (
              <option key={n} value={n}>{n}人</option>
            ))}
          </select>
        </label>
        <label>
          <span>パスワード（任意）</span>
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="未入力で公開" />
        </label>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={handleCreate}>作成</button>
        </div>
      </div>
    </div>
  );
}

function ShareUrlBox() {
  const [copied, setCopied] = useState(false);
  const { hostname, port, protocol } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  // 表示するURL: localhostでなければそのまま表示
  const shareUrl = isLocal
    ? `このURLは自分専用です。相手に共有するには以下のコマンドを実行してください`
    : window.location.origin;

  const handleCopy = () => {
    navigator.clipboard.writeText(window.location.origin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card" style={{ padding: '10px 12px', fontSize: 13 }}>
      {isLocal ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ color: '#f0a000', fontWeight: 700 }}>共有方法</span>
          </div>
          <div style={{ marginBottom: 6, color: '#aaa', fontSize: 12 }}>
            離れた相手と対戦するには、ターミナルで以下を実行してURLを共有:
          </div>
          <code style={{
            display: 'block',
            background: '#0a0a1a',
            padding: '6px 10px',
            borderRadius: 4,
            color: '#4caf50',
            fontSize: 13,
            wordBreak: 'break-all',
            userSelect: 'all',
            marginBottom: 6,
          }}>
            npx localtunnel --port 3001
          </code>
          <div style={{ color: '#666', fontSize: 11 }}>
            表示された https://xxxxx.loca.lt のURLを相手に送ってください
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#aaa', whiteSpace: 'nowrap' }}>対戦用URL（相手に共有）:</span>
          <code style={{
            flex: 1,
            background: '#0a0a1a',
            padding: '4px 8px',
            borderRadius: 4,
            color: '#4a6cf7',
            fontSize: 13,
            wordBreak: 'break-all',
            userSelect: 'all',
          }}>
            {window.location.origin}
          </code>
          <button
            className="btn-secondary"
            style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={handleCopy}
          >
            {copied ? '✓' : 'コピー'}
          </button>
        </div>
      )}
    </div>
  );
}

function PasswordModal({ roomId, onClose, onJoin }: { roomId: string; onClose: () => void; onJoin: (id: string, pw: string) => void }) {
  const [pw, setPw] = useState('');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>パスワードを入力</h2>
        <label>
          <span>パスワード</span>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onJoin(roomId, pw)}
          />
        </label>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={() => onJoin(roomId, pw)}>参加</button>
        </div>
      </div>
    </div>
  );
}
