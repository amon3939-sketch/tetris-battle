/**
 * インメモリデータベース実装
 * better-sqlite3 のネイティブモジュール依存を排除し、
 * Render等のクラウド環境での互換性を確保する。
 */

export interface PlayerRecord {
  id: number;
  nickname: string;
  fingerprint: string;
  totalMatches: number;
  totalWins: number;
}

export interface MatchRecord {
  id: number;
  roomName: string;
  playerCount: number;
  winnerId: number | null;
  durationSec: number;
  playedAt: string;
}

export interface MatchPlayerRecord {
  matchId: number;
  playerId: number;
  rank: number;
  score: number;
  linesCleared: number;
  attackSent: number;
  tspinCount: number;
  koCount: number;
}

export interface Database {
  players: PlayerRecord[];
  matches: MatchRecord[];
  matchPlayers: MatchPlayerRecord[];
  nextPlayerId: number;
  nextMatchId: number;
}

export function initDatabase(_path?: string): Database {
  console.log('Using in-memory database (no native modules)');
  return {
    players: [],
    matches: [],
    matchPlayers: [],
    nextPlayerId: 1,
    nextMatchId: 1,
  };
}

function getOrCreatePlayer(db: Database, fingerprint: string, nickname: string): number {
  const existing = db.players.find(p => p.fingerprint === fingerprint);
  if (existing) {
    existing.nickname = nickname;
    return existing.id;
  }

  const id = db.nextPlayerId++;
  db.players.push({
    id,
    nickname,
    fingerprint,
    totalMatches: 0,
    totalWins: 0,
  });
  return id;
}

export function saveMatch(db: Database, params: {
  roomName: string;
  playerCount: number;
  durationSec: number;
  winnerId: string | null; // fingerprint
  players: Array<{
    fingerprint: string;
    nickname: string;
    rank: number;
    score: number;
    linesCleared: number;
    attackSent: number;
    tspinCount: number;
    koCount: number;
  }>;
}): void {
  // Resolve player IDs
  const playerIds = new Map<string, number>();
  for (const p of params.players) {
    const id = getOrCreatePlayer(db, p.fingerprint, p.nickname);
    playerIds.set(p.fingerprint, id);
  }

  const winnerDbId = params.winnerId ? (playerIds.get(params.winnerId) ?? null) : null;

  // Insert match
  const matchId = db.nextMatchId++;
  db.matches.push({
    id: matchId,
    roomName: params.roomName,
    playerCount: params.playerCount,
    winnerId: winnerDbId,
    durationSec: params.durationSec,
    playedAt: new Date().toISOString(),
  });

  // Insert match_players and update stats
  for (const p of params.players) {
    const playerId = playerIds.get(p.fingerprint)!;
    db.matchPlayers.push({
      matchId,
      playerId,
      rank: p.rank,
      score: p.score,
      linesCleared: p.linesCleared,
      attackSent: p.attackSent,
      tspinCount: p.tspinCount,
      koCount: p.koCount,
    });

    const player = db.players.find(pl => pl.id === playerId);
    if (player) {
      player.totalMatches++;
      if (p.rank === 1) {
        player.totalWins++;
      }
    }
  }
}

export function getRanking(db: Database, limit = 20): Array<{
  nickname: string;
  totalWins: number;
  totalMatches: number;
  winRate: number;
  bestScore: number;
  totalLines: number;
}> {
  return db.players
    .filter(p => p.totalMatches > 0)
    .sort((a, b) => b.totalWins - a.totalWins)
    .slice(0, limit)
    .map(p => {
      const playerMatches = db.matchPlayers.filter(mp => mp.playerId === p.id);
      const bestScore = playerMatches.length > 0
        ? Math.max(...playerMatches.map(mp => mp.score))
        : 0;
      const totalLines = playerMatches.reduce((sum, mp) => sum + mp.linesCleared, 0);
      return {
        nickname: p.nickname,
        totalWins: p.totalWins,
        totalMatches: p.totalMatches,
        winRate: p.totalMatches > 0 ? p.totalWins / p.totalMatches : 0,
        bestScore,
        totalLines,
      };
    });
}
