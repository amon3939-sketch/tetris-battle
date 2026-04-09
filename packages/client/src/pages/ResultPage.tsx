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
  const myRank = sorted.find(p => p.socketId === socket.id)?.rank ?? 0;

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
        maxWidth: 560, margin: '0 auto', padding: '40px 20px',
      }}>
        {/* Result Title */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          {myRank === 1 && !isSolo ? (
            <>
              <div style={{
                fontSize: 56, fontWeight: 900, letterSpacing: 6,
                color: '#ffd700',
                textShadow: '0 0 30px rgba(255,215,0,0.6), 0 0 80px rgba(255,215,0,0.3), 0 2px 4px rgba(0,0,0,0.8)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}>WINNER!</div>
              <div style={{ fontSize: 13, color: 'rgba(255,215,0,0.6)', letterSpacing: 4, marginTop: 4 }}>
                CONGRATULATIONS
              </div>
            </>
          ) : (
            <>
              <div style={{
                fontSize: 40, fontWeight: 900, letterSpacing: 4,
                color: '#00ccff',
                textShadow: '0 0 20px rgba(0,200,255,0.5), 0 2px 4px rgba(0,0,0,0.8)',
              }}>RESULT</div>
              <div style={{ fontSize: 13, color: 'rgba(0,200,255,0.4)', letterSpacing: 3, marginTop: 4 }}>
                {isSolo ? 'SOLO GAME' : 'MULTIPLAYER'}
              </div>
            </>
          )}
        </div>

        {/* Ranking Table */}
        <div className="t99-frame" style={{ padding: 0, marginBottom: 24, overflow: 'hidden', position: 'relative' }}>
          <div className="t99-frame-label">RANKING</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(0,50,100,0.3)' }}>
                <th style={thStyle}>順位</th>
                <th style={thStyle}>プレイヤー</th>
                <th style={thStyle}>スコア</th>
                <th style={thStyle}>ライン</th>
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
                      borderBottom: '1px solid rgba(0,150,200,0.1)',
                      background: isMe ? 'rgba(0,136,255,0.15)' : 'transparent',
                    }}
                  >
                    <td style={{
                      ...tdStyle,
                      fontSize: isWinner ? 22 : 16,
                      fontWeight: 900,
                      color: isWinner ? '#ffd700' : p.rank === 2 ? '#c0c0c0' : p.rank === 3 ? '#cd7f32' : 'rgba(0,200,255,0.5)',
                      textShadow: isWinner ? '0 0 10px rgba(255,215,0,0.5)' : 'none',
                      textAlign: 'center',
                      width: 60,
                    }}>
                      {p.rank}
                    </td>
                    <td style={{ ...tdStyle, color: '#fff', fontWeight: 600 }}>
                      {p.nickname}
                      {isMe && <span style={{ fontSize: 11, color: '#00ccff', marginLeft: 6, fontWeight: 400 }}>YOU</span>}
                    </td>
                    <td style={{ ...tdStyle, color: '#ffaa00', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {(p.score ?? 0).toLocaleString()}
                    </td>
                    <td style={{ ...tdStyle, color: 'rgba(0,200,255,0.6)' }}>
                      {p.linesCleared ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          {!isSolo && (
            <button onClick={goToRoom} style={{
              padding: '14px 32px', fontSize: 16, fontWeight: 900,
              background: 'linear-gradient(180deg, #0088ff, #0055cc)',
              color: '#fff', border: '2px solid rgba(0,150,255,0.5)',
              borderRadius: 8, cursor: 'pointer', letterSpacing: 2,
              boxShadow: '0 0 20px rgba(0,136,255,0.3)',
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
            }}>
              REMATCH
            </button>
          )}
          <button onClick={goToLobby} style={{
            padding: '14px 32px', fontSize: 16, fontWeight: 700,
            background: 'rgba(0,30,60,0.8)', color: '#00ccff',
            border: '1px solid rgba(0,200,255,0.3)', borderRadius: 8, cursor: 'pointer',
            letterSpacing: 1,
          }}>
            LOBBY
          </button>
        </div>
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
  padding: '12px 12px', fontSize: 15,
};
