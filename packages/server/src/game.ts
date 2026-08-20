import type { Server } from 'socket.io';
import type { RoomPlayer } from './room.js';
import type { Database } from './db.js';
import { saveMatch } from './db.js';
import { selectTarget } from './attack.js';

interface PlayerStats {
  score: number;
  linesCleared: number;
  tspinCount: number;
}

export class ServerGameRoom {
  private playerOrder: string[];
  private aliveIds: Set<string>;
  private startTime = 0;
  private isSolo: boolean;

  // Stats tracked server-side
  private attackSent = new Map<string, number>();
  private koCount = new Map<string, number>();
  private ranks = new Map<string, number>();

  // Stats reported by clients (via board:sync and game:localGameOver)
  private playerStats = new Map<string, PlayerStats>();

  private fingerprints = new Map<string, string>();
  private nicknames = new Map<string, string>();

  constructor(
    private players: RoomPlayer[],
    private io: Server,
    private roomId: string,
    private db: Database,
  ) {
    this.playerOrder = players.map(p => p.socketId);
    this.aliveIds = new Set(this.playerOrder);
    this.isSolo = players.length === 1;

    for (const p of players) {
      this.attackSent.set(p.socketId, 0);
      this.koCount.set(p.socketId, 0);
      this.nicknames.set(p.socketId, p.nickname);
      this.playerStats.set(p.socketId, { score: 0, linesCleared: 0, tspinCount: 0 });
    }
  }

  setFingerprint(socketId: string, fingerprint: string): void {
    this.fingerprints.set(socketId, fingerprint);
  }

  start(): void {
    // 各プレイヤーに独立したseedを配布（クライアントがローカルエンジンを動かす）
    for (const socketId of this.playerOrder) {
      const seed = Math.floor(Math.random() * 2147483647);
      this.io.to(socketId).emit('game:ready', {
        startAt: Date.now() + 3000,
        settings: { das: 200, arr: 50 },
        seed,
      });
    }

    this.startTime = Date.now();
  }

  /** クライアントが攻撃発生を報告 → サーバーがターゲット選択してルーティング */
  routeAttack(fromSocketId: string, lines: number, holes: number[], attackType: string): void {
    if (!this.aliveIds.has(fromSocketId)) return;

    const targetId = selectTarget(fromSocketId, Array.from(this.aliveIds));
    if (!targetId) return;

    this.attackSent.set(fromSocketId, (this.attackSent.get(fromSocketId) ?? 0) + lines);

    // 全員に攻撃通知（エフェクト表示用）
    this.io.to(this.roomId).emit('attack:send', {
      from: fromSocketId,
      to: targetId,
      lines,
      type: attackType,
    });

    // ターゲットにおじゃまを届ける
    this.io.to(targetId).emit('attack:receive', { lines, holes });
  }

  /** board:sync からクライアントの最新スタッツをキャッシュ */
  updateStats(socketId: string, stats: PlayerStats): void {
    this.playerStats.set(socketId, stats);
  }

  /** クライアントがローカルゲームオーバーを通知 */
  reportGameOver(socketId: string, stats?: PlayerStats): void {
    if (stats) {
      this.playerStats.set(socketId, stats);
    }
    this.handleKO(socketId);
  }

  private handleKO(socketId: string): void {
    if (!this.aliveIds.has(socketId)) return;
    this.aliveIds.delete(socketId);

    const rank = this.aliveIds.size + 1;
    this.ranks.set(socketId, rank);

    this.io.to(this.roomId).emit('player:ko', { socketId, rank });

    if (this.isSolo) {
      this.handleGameOver();
      return;
    }

    if (this.aliveIds.size <= 1) {
      this.handleGameOver();
    }
  }

  private handleGameOver(): void {
    const winnerId = this.aliveIds.size === 1 ? Array.from(this.aliveIds)[0] : null;
    if (winnerId) {
      this.ranks.set(winnerId, 1);
    }

    const durationSec = Math.floor((Date.now() - this.startTime) / 1000);

    const ranking = this.playerOrder.map(sid => {
      const stats = this.playerStats.get(sid) ?? { score: 0, linesCleared: 0, tspinCount: 0 };
      return {
        socketId: sid,
        nickname: this.nicknames.get(sid) ?? 'Unknown',
        rank: this.ranks.get(sid) ?? this.playerOrder.length,
        linesCleared: stats.linesCleared,
        attackSent: this.attackSent.get(sid) ?? 0,
        tspinCount: stats.tspinCount,
        koCount: this.koCount.get(sid) ?? 0,
        score: stats.score,
      };
    }).sort((a, b) => a.rank - b.rank);

    const winnerFingerprint = winnerId ? (this.fingerprints.get(winnerId) ?? winnerId) : null;
    try {
      saveMatch(this.db, {
        roomName: this.roomId,
        playerCount: this.playerOrder.length,
        durationSec,
        winnerId: winnerFingerprint,
        isSolo: this.isSolo,
        players: ranking.map(r => ({
          fingerprint: this.fingerprints.get(r.socketId) ?? r.socketId,
          nickname: r.nickname,
          rank: r.rank,
          score: r.score,
          linesCleared: r.linesCleared,
          attackSent: r.attackSent,
          tspinCount: r.tspinCount,
          koCount: r.koCount,
        })),
      });
    } catch (e) {
      console.error('Failed to save match:', e);
    }

    this.io.to(this.roomId).emit('game:over', { winnerId, ranking });
  }

  stop(): void {
    // relay-only モードではtickがないため何もしない
  }
}
