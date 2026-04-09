/**
 * インメモリデータベース実装
 * ソロモードとマルチモードのランキングを分離して管理
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
  isSolo: boolean;
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
  winnerId: string | null;
  isSolo: boolean;
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
  const playerIds = new Map<string, number>();
  for (const p of params.players) {
    const id = getOrCreatePlayer(db, p.fingerprint, p.nickname);
    playerIds.set(p.fingerprint, id);
  }

  const winnerDbId = params.winnerId ? (playerIds.get(params.winnerId) ?? null) : null;

  const matchId = db.nextMatchId++;
  db.matches.push({
    id: matchId,
    roomName: params.roomName,
    playerCount: params.playerCount,
    winnerId: winnerDbId,
    durationSec: params.durationSec,
    playedAt: new Date().toISOString(),
    isSolo: params.isSolo,
  });

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

/** ランキング取得（mode: 'solo' | 'multi' | 'all'） */
export function getRanking(db: Database, limit = 10, mode: 'solo' | 'multi' | 'all' = 'all'): Array<{
  nickname: string;
  totalWins: number;
  totalMatches: number;
  winRate: number;
  bestScore: number;
  totalLines: number;
  bestLines: number;
}> {
  // mode に応じたマッチIDをフィルタリング
  const filteredMatchIds = new Set(
    db.matches
      .filter(m => {
        if (mode === 'solo') return m.isSolo;
        if (mode === 'multi') return !m.isSolo;
        return true;
      })
      .map(m => m.id)
  );

  // プレイヤーごとに該当モードの統計を集計
  const stats = new Map<number, {
    nickname: string;
    wins: number;
    matches: number;
    bestScore: number;
    totalLines: number;
    bestLines: number;
  }>();

  for (const mp of db.matchPlayers) {
    if (!filteredMatchIds.has(mp.matchId)) continue;

    const player = db.players.find(p => p.id === mp.playerId);
    if (!player) continue;

    let s = stats.get(mp.playerId);
    if (!s) {
      s = { nickname: player.nickname, wins: 0, matches: 0, bestScore: 0, totalLines: 0, bestLines: 0 };
      stats.set(mp.playerId, s);
    }

    s.matches++;
    if (mp.rank === 1) s.wins++;
    if (mp.score > s.bestScore) s.bestScore = mp.score;
    s.totalLines += mp.linesCleared;
    if (mp.linesCleared > s.bestLines) s.bestLines = mp.linesCleared;
  }

  // ソロはbestScoreで、マルチはwinsでソート
  const sorted = Array.from(stats.values()).sort((a, b) => {
    if (mode === 'solo') return b.bestScore - a.bestScore;
    return b.wins - a.wins || b.bestScore - a.bestScore;
  });

  return sorted.slice(0, limit).map(s => ({
    nickname: s.nickname,
    totalWins: s.wins,
    totalMatches: s.matches,
    winRate: s.matches > 0 ? s.wins / s.matches : 0,
    bestScore: s.bestScore,
    totalLines: s.totalLines,
    bestLines: s.bestLines,
  }));
}
