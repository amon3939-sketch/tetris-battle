import type { Server } from 'socket.io';
import { GameEngine } from '@tetris/engine/src/engine.js';
import type { Action, LineClearResult } from '@tetris/engine/src/types.js';
import type { RoomPlayer } from './room.js';
import type { Database } from './db.js';
import { saveMatch } from './db.js';
import { selectTarget } from './attack.js';

// Socket data に保存される fingerprint を取得するためのヘルパー型
interface SocketData {
  nickname?: string;
  fingerprint?: string;
}

export class ServerGameRoom {
  private engines = new Map<string, GameEngine>();
  private playerOrder: string[];
  private aliveIds: Set<string>;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private isSolo: boolean;

  // 統計追跡
  private attackSent = new Map<string, number>();
  private tspinCount = new Map<string, number>();
  private koCount = new Map<string, number>();
  private ranks = new Map<string, number>();

  // fingerprint マッピング
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
      this.tspinCount.set(p.socketId, 0);
      this.koCount.set(p.socketId, 0);
      this.nicknames.set(p.socketId, p.nickname);
    }
  }

  setFingerprint(socketId: string, fingerprint: string): void {
    this.fingerprints.set(socketId, fingerprint);
  }

  private seeds = new Map<string, number>();

  start(): void {
    // 各プレイヤーにランダムなseedを割り当ててGameEngineを生成
    for (const socketId of this.playerOrder) {
      const seed = Math.floor(Math.random() * 2147483647);
      this.seeds.set(socketId, seed);
      const engine = new GameEngine({ seed });
      this.engines.set(socketId, engine);
    }

    // game:ready を各プレイヤーに個別送信（seedを含める）
    for (const socketId of this.playerOrder) {
      this.io.to(socketId).emit('game:ready', {
        startAt: Date.now() + 3000,
        settings: { das: 200, arr: 50 },
        seed: this.seeds.get(socketId),
      });
    }

    // 3秒後にtick開始 + 初期状態を送信
    setTimeout(() => {
      this.startTime = Date.now();

      // 初期状態を全プレイヤーに送信
      for (const socketId of this.playerOrder) {
        const engine = this.engines.get(socketId);
        if (!engine) continue;
        const state = engine.getState();
        this.io.to(socketId).emit('game:state_ack', { seq: 0, ...state });
      }

      this.tickInterval = setInterval(() => this.tick(), 16);
    }, 3000);
  }

  processAction(socketId: string, action: Action, seq: number): void {
    const engine = this.engines.get(socketId);
    if (!engine || !this.aliveIds.has(socketId)) return;

    const result = engine.applyAction(action);

    // 攻撃処理
    if (result && result.attackLines > 0) {
      this.processAttack(socketId, result);
    }

    // T-spin統計
    if (result && result.tSpin !== 'none') {
      this.tspinCount.set(socketId, (this.tspinCount.get(socketId) ?? 0) + 1);
    }

    // state_ack を送信者に返す（スコア等の権威的データ）
    const state = engine.getState();
    this.io.to(socketId).emit('game:state_ack', { seq, ...state });

    // ※ board:updateはクライアントのboard:syncから送信（サーバーからは送らない）

    // ライン消去イベント
    if (result && result.linesCleared > 0) {
      this.io.to(socketId).emit('game:line_clear', { linesCleared: result.linesCleared, clearedRows: result.clearedRows });
    }

    // ※ ゲームオーバーはクライアントからの通知 (game:localGameOver) で判定
  }

  /** クライアントがローカルエンジンでゲームオーバーを検出した場合に呼ばれる */
  reportGameOver(socketId: string): void {
    this.handleKO(socketId);
  }

  private processAttack(socketId: string, result: LineClearResult): void {
    const targetId = selectTarget(socketId, Array.from(this.aliveIds));
    if (!targetId) return;

    const lines = result.attackLines;
    this.attackSent.set(socketId, (this.attackSent.get(socketId) ?? 0) + lines);

    // 攻撃送信イベント
    this.io.to(this.roomId).emit('attack:send', {
      from: socketId,
      to: targetId,
      lines,
      type: result.tSpin !== 'none' ? 'tspin' : result.linesCleared === 4 ? 'tetris' : 'normal',
    });

    // ターゲットにおじゃまを送る（穴位置をサーバーで生成し、クライアントと同期）
    const targetEngine = this.engines.get(targetId);
    if (targetEngine) {
      const holes = Array.from({ length: lines }, () => Math.floor(Math.random() * 10));
      targetEngine.receiveGarbage(lines, holes);
      this.io.to(targetId).emit('attack:receive', { lines, holes });
    }
  }

  private tick(): void {
    for (const socketId of Array.from(this.aliveIds)) {
      const engine = this.engines.get(socketId);
      if (!engine) continue;

      const stateBefore = engine.getState();
      const result = engine.tick(16);

      if (result && result.attackLines > 0) {
        this.processAttack(socketId, result);
      }

      if (result && result.tSpin !== 'none') {
        this.tspinCount.set(socketId, (this.tspinCount.get(socketId) ?? 0) + 1);
      }

      const stateAfter = engine.getState();

      // ピース位置が変わった（重力落下）またはロック発生時に送信
      const pieceChanged =
        stateBefore.currentPiece?.y !== stateAfter.currentPiece?.y ||
        stateBefore.currentPiece?.type !== stateAfter.currentPiece?.type ||
        stateBefore.currentPiece === null !== (stateAfter.currentPiece === null);

      if (result || pieceChanged) {
        this.io.to(socketId).emit('game:state_ack', { seq: -1, ...stateAfter });
        if (result && result.linesCleared > 0) {
          this.io.to(socketId).emit('game:line_clear', { linesCleared: result.linesCleared, clearedRows: result.clearedRows });
        }
      }

      // ※ ゲームオーバーはクライアントからの通知で判定（サーバーでは検知しない）
    }
  }

  private handleKO(socketId: string): void {
    if (!this.aliveIds.has(socketId)) return;
    this.aliveIds.delete(socketId);

    const rank = this.aliveIds.size + 1;
    this.ranks.set(socketId, rank);

    this.io.to(this.roomId).emit('player:ko', { socketId, rank });

    // ソロモード: プレイヤーが死んだら即ゲームオーバー
    if (this.isSolo) {
      this.handleGameOver();
      return;
    }

    if (this.aliveIds.size <= 1) {
      this.handleGameOver();
    }
  }

  private handleGameOver(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    const winnerId = this.aliveIds.size === 1 ? Array.from(this.aliveIds)[0] : null;
    if (winnerId) {
      this.ranks.set(winnerId, 1);
    }

    const durationSec = Math.floor((Date.now() - this.startTime) / 1000);

    // 統計収集
    const ranking = this.playerOrder.map(sid => {
      const engine = this.engines.get(sid);
      const state = engine?.getState();
      return {
        socketId: sid,
        nickname: this.nicknames.get(sid) ?? 'Unknown',
        rank: this.ranks.get(sid) ?? this.playerOrder.length,
        linesCleared: state?.linesCleared ?? 0,
        attackSent: this.attackSent.get(sid) ?? 0,
        tspinCount: this.tspinCount.get(sid) ?? 0,
        koCount: this.koCount.get(sid) ?? 0,
        score: state?.score ?? 0,
      };
    }).sort((a, b) => a.rank - b.rank);

    // DB保存
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

    // game:over を全員に送信
    this.io.to(this.roomId).emit('game:over', {
      winnerId,
      ranking,
    });
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}
