import BetterSqlite3 from 'better-sqlite3';

export type Database = BetterSqlite3.Database;

export function initDatabase(path: string): Database {
  const db = new BetterSqlite3(path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname      TEXT NOT NULL,
      fingerprint   TEXT NOT NULL,
      total_matches INTEGER NOT NULL DEFAULT 0,
      total_wins    INTEGER NOT NULL DEFAULT 0,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_players_fingerprint ON players(fingerprint);

    CREATE TABLE IF NOT EXISTS matches (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      room_name    TEXT NOT NULL,
      player_count INTEGER NOT NULL,
      winner_id    INTEGER REFERENCES players(id),
      duration_sec INTEGER NOT NULL,
      played_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS match_players (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id      INTEGER NOT NULL REFERENCES matches(id),
      player_id     INTEGER NOT NULL REFERENCES players(id),
      rank          INTEGER NOT NULL,
      score         INTEGER NOT NULL DEFAULT 0,
      lines_cleared INTEGER NOT NULL DEFAULT 0,
      attack_sent   INTEGER NOT NULL DEFAULT 0,
      tspin_count   INTEGER NOT NULL DEFAULT 0,
      ko_count      INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}

function getOrCreatePlayer(db: Database, fingerprint: string, nickname: string): number {
  const row = db.prepare(
    'SELECT id FROM players WHERE fingerprint = ?'
  ).get(fingerprint) as { id: number } | undefined;

  if (row) {
    db.prepare('UPDATE players SET nickname = ? WHERE id = ?').run(nickname, row.id);
    return row.id;
  }

  const result = db.prepare(
    'INSERT INTO players (nickname, fingerprint) VALUES (?, ?)'
  ).run(nickname, fingerprint);
  return Number(result.lastInsertRowid);
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
  const matchResult = db.prepare(
    'INSERT INTO matches (room_name, player_count, winner_id, duration_sec) VALUES (?, ?, ?, ?)'
  ).run(params.roomName, params.playerCount, winnerDbId, params.durationSec);
  const matchId = Number(matchResult.lastInsertRowid);

  // Insert match_players and update stats
  const insertMp = db.prepare(
    'INSERT INTO match_players (match_id, player_id, rank, score, lines_cleared, attack_sent, tspin_count, ko_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const updateMatches = db.prepare(
    'UPDATE players SET total_matches = total_matches + 1 WHERE id = ?'
  );
  const updateWins = db.prepare(
    'UPDATE players SET total_wins = total_wins + 1 WHERE id = ?'
  );

  for (const p of params.players) {
    const playerId = playerIds.get(p.fingerprint)!;
    insertMp.run(matchId, playerId, p.rank, p.score, p.linesCleared, p.attackSent, p.tspinCount, p.koCount);
    updateMatches.run(playerId);
    if (p.rank === 1) {
      updateWins.run(playerId);
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
  const rows = db.prepare(`
    SELECT
      p.nickname,
      p.total_wins,
      p.total_matches,
      COALESCE(MAX(mp.score), 0) as best_score,
      COALESCE(SUM(mp.lines_cleared), 0) as total_lines
    FROM players p
    LEFT JOIN match_players mp ON mp.player_id = p.id
    WHERE p.total_matches > 0
    GROUP BY p.id
    ORDER BY p.total_wins DESC
    LIMIT ?
  `).all(limit) as Array<{
    nickname: string;
    total_wins: number;
    total_matches: number;
    best_score: number;
    total_lines: number;
  }>;

  return rows.map(r => ({
    nickname: r.nickname,
    totalWins: r.total_wins,
    totalMatches: r.total_matches,
    winRate: r.total_matches > 0 ? r.total_wins / r.total_matches : 0,
    bestScore: r.best_score,
    totalLines: r.total_lines,
  }));
}
