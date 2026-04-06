import { useEffect } from 'react';
import { socket } from '../socket.ts';
import { soundManager } from '../sounds.ts';

interface GameOverData {
  winnerId: string;
  ranking: Array<{ socketId: string; nickname: string; rank: number; score?: number; linesCleared?: number }>;
}

interface Props {
  gameOverData: GameOverData | null;
  goToLobby: () => void;
  goToRoom: () => void;
  isSolo: boolean;
}

export default function ResultPage({ gameOverData, goToLobby, goToRoom, isSolo }: Props) {
  useEffect(() => {
    soundManager.playBGM('result');
    return () => {
      soundManager.stopBGM();
    };
  }, []);

  if (!gameOverData) return null;

  const { ranking } = gameOverData;
  const sorted = [...ranking].sort((a, b) => a.rank - b.rank);

  return (
    <div className="page" style={{ maxWidth: 500 }}>
      <h1 style={{ textAlign: 'center' }}>ゲーム終了</h1>

      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #3a3a5c', textAlign: 'left' }}>
              <th style={{ padding: '8px 4px' }}>順位</th>
              <th style={{ padding: '8px 4px' }}>プレイヤー</th>
              <th style={{ padding: '8px 4px' }}>スコア</th>
              <th style={{ padding: '8px 4px' }}>ライン</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const isMe = p.socketId === socket.id;
              const isWinner = p.rank === 1;
              return (
                <tr
                  key={p.socketId}
                  style={{
                    borderBottom: '1px solid #2a2a4a',
                    background: isMe ? 'rgba(74,108,247,0.1)' : 'transparent',
                  }}
                >
                  <td style={{
                    padding: '10px 4px',
                    fontSize: isWinner ? 20 : 16,
                    fontWeight: isWinner ? 900 : 400,
                    color: isWinner ? '#f0a000' : '#e0e0e0',
                  }}>
                    {isWinner ? '🏆 ' : ''}{p.rank}位
                  </td>
                  <td style={{ padding: '10px 4px' }}>
                    {p.nickname}
                    {isMe && <span style={{ fontSize: 12, color: '#4a6cf7', marginLeft: 4 }}>(自分)</span>}
                  </td>
                  <td style={{ padding: '10px 4px' }}>{p.score ?? 0}</td>
                  <td style={{ padding: '10px 4px' }}>{p.linesCleared ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
        {!isSolo && (
          <button className="btn-primary" onClick={goToRoom} style={{ padding: '12px 28px', fontSize: 16 }}>
            ルームに戻る
          </button>
        )}
        <button className="btn-secondary" onClick={goToLobby} style={{ padding: '12px 28px', fontSize: 16 }}>
          ロビーへ戻る
        </button>
      </div>
    </div>
  );
}
