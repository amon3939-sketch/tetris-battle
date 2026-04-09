import type { Server, Socket } from 'socket.io';
import type { Action } from '@tetris/engine/src/types.js';
import { RoomManager } from './room.js';
import { ServerGameRoom } from './game.js';
import type { Database } from './db.js';
import { getRanking } from './db.js';

function sanitize(text: string): string {
  return text.replace(/<[^>]*>/g, '').slice(0, 140);
}

function emitRoomState(io: Server, room: ReturnType<RoomManager['getRoom']>) {
  if (!room) return;
  io.to(room.id).emit('room:state', {
    room: { id: room.id, name: room.name },
    players: room.players,
    hostSocketId: room.hostSocketId,
    maxPlayers: room.maxPlayers,
    hasPassword: !!room.password,
    status: room.status,
  });
}

export function registerEvents(io: Server, roomManager: RoomManager, db: Database): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Connected: ${socket.id}`);

    // ニックネーム設定
    socket.on('player:setNickname', ({ nickname, fingerprint }: { nickname: string; fingerprint: string }) => {
      socket.data.nickname = nickname;
      socket.data.fingerprint = fingerprint;
      socket.emit('room:list', roomManager.getRoomList());
    });

    // ルーム作成
    socket.on('room:create', ({ name, maxPlayers, password }: { name: string; maxPlayers: number; password?: string }) => {
      const nickname = socket.data.nickname ?? 'Guest';
      const room = roomManager.createRoom(socket.id, nickname, name, maxPlayers, password);
      socket.join(room.id);
      emitRoomState(io, room);
      io.emit('room:list', roomManager.getRoomList());
    });

    // ルーム参加
    socket.on('room:join', ({ roomId, password }: { roomId: string; password?: string }) => {
      const nickname = socket.data.nickname ?? 'Guest';
      const result = roomManager.joinRoom(roomId, socket.id, nickname, password);
      if (!result.ok) {
        socket.emit('room:error', { code: 'JOIN_FAILED', message: result.error });
        return;
      }
      const room = result.room!;
      socket.join(room.id);
      emitRoomState(io, room);
      io.emit('room:list', roomManager.getRoomList());
    });

    // ルーム退出
    socket.on('room:leave', () => {
      const { room, wasHost } = roomManager.leaveRoom(socket.id);
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      for (const r of rooms) {
        socket.leave(r);
      }
      if (room) {
        emitRoomState(io, room);
      }
      io.emit('room:list', roomManager.getRoomList());
    });

    // ルーム一覧取得
    socket.on('room:list', () => {
      socket.emit('room:list', roomManager.getRoomList());
    });

    // ランキング取得
    socket.on('ranking:get', () => {
      try {
        const ranking = getRanking(db, 20);
        socket.emit('ranking:data', ranking);
      } catch (e) {
        socket.emit('ranking:data', []);
      }
    });

    // ルーム設定変更（ホストのみ）
    socket.on('room:update', ({ maxPlayers, password }: { maxPlayers?: number; password?: string | null }) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;
      if (room.hostSocketId !== socket.id) return;
      if (maxPlayers != null) {
        room.maxPlayers = Math.max(1, Math.min(8, maxPlayers));
      }
      if (password !== undefined) {
        room.password = password || undefined;
      }
      emitRoomState(io, room);
      io.emit('room:list', roomManager.getRoomList());
    });

    // ゲーム終了後にルームへ戻る（waitingに戻す）
    socket.on('game:backToRoom', () => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;
      // ゲームが終了している場合のみ
      if (room.status === 'playing' && room.gameRoom) {
        room.gameRoom.stop();
        room.gameRoom = undefined;
      }
      room.status = 'waiting';
      emitRoomState(io, room);
      io.emit('room:list', roomManager.getRoomList());
    });

    // ソロプレイ（1人用）
    socket.on('game:solo', () => {
      const nickname = socket.data.nickname ?? 'Guest';
      const room = roomManager.createRoom(socket.id, nickname, `${nickname}のソロ`, 1);
      socket.join(room.id);
      emitRoomState(io, room);

      room.status = 'playing';
      const gameRoom = new ServerGameRoom(room.players, io, room.id, db);
      room.gameRoom = gameRoom;

      if (socket.data.fingerprint) {
        gameRoom.setFingerprint(socket.id, socket.data.fingerprint);
      }

      gameRoom.start();
      io.emit('room:list', roomManager.getRoomList());
    });

    // ゲーム開始（ホストのみ）
    socket.on('game:start', () => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) {
        socket.emit('room:error', { code: 'NOT_IN_ROOM', message: 'Not in a room' });
        return;
      }

      const result = roomManager.startGame(room.id, socket.id);
      if (!result.ok) {
        socket.emit('room:error', { code: 'START_FAILED', message: result.error });
        return;
      }

      const gameRoom = new ServerGameRoom(room.players, io, room.id, db);
      room.gameRoom = gameRoom;

      for (const player of room.players) {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket?.data.fingerprint) {
          gameRoom.setFingerprint(player.socketId, playerSocket.data.fingerprint);
        }
      }

      gameRoom.start();
    });

    // 入力アクション
    socket.on('input:action', ({ action, seq }: { action: Action; seq: number }) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room?.gameRoom) return;
      room.gameRoom.processAction(socket.id, action, seq);
    });

    // チャット
    socket.on('chat:send', ({ text }: { text: string }) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;
      const sanitized = sanitize(text);
      if (!sanitized) return;

      io.to(room.id).emit('chat:message', {
        nickname: socket.data.nickname ?? 'Guest',
        text: sanitized,
        ts: Date.now(),
      });
    });

    // ローカルボード同期（クライアントのローカルエンジン状態を他プレイヤーに転送）
    socket.on('board:sync', (data: { board: any; currentPiece: any; score: number; linesCleared: number }) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;
      // 他プレイヤーのミニボード用にbroadcast（ローカルの正確な状態）
      io.to(room.id).emit('board:update', {
        socketId: socket.id,
        board: data.board,
        currentPiece: data.currentPiece,
        score: data.score,
        linesCleared: data.linesCleared,
      });
    });

    // スタンプ送信
    socket.on('stamp:send', ({ text, style }: { text: string; style: string }) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;
      io.to(room.id).emit('stamp:receive', {
        nickname: socket.data.nickname ?? 'Guest',
        text,
        style,
      });
    });

    // 切断
    socket.on('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`);
      const { room } = roomManager.leaveRoom(socket.id);
      if (room) {
        emitRoomState(io, room);
      }
      io.emit('room:list', roomManager.getRoomList());
    });
  });
}
