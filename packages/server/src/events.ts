import type { Server, Socket } from 'socket.io';
import type { Action } from '@tetris/engine/src/types.js';
import { RoomManager } from './room.js';
import { ServerGameRoom } from './game.js';
import type { Database } from './db.js';
import { getRanking } from './db.js';

function sanitize(text: string): string {
  return text.replace(/<[^>]*>/g, '').slice(0, 140);
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
      socket.emit('room:state', {
        room: {
          id: room.id,
          name: room.name,
        },
        players: room.players,
        hostSocketId: room.hostSocketId,
        status: room.status,
      });
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
      io.to(room.id).emit('room:state', {
        room: {
          id: room.id,
          name: room.name,
        },
        players: room.players,
        hostSocketId: room.hostSocketId,
        status: room.status,
      });
      io.emit('room:list', roomManager.getRoomList());
    });

    // ルーム退出
    socket.on('room:leave', () => {
      const { room, wasHost } = roomManager.leaveRoom(socket.id);
      // socketId が参加している全roomから離脱
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      for (const r of rooms) {
        socket.leave(r);
      }

      if (room) {
        io.to(room.id).emit('room:state', {
          room: {
            id: room.id,
            name: room.name,
          },
          players: room.players,
          hostSocketId: room.hostSocketId,
          status: room.status,
        });
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

    // ソロプレイ（1人用）
    socket.on('game:solo', () => {
      const nickname = socket.data.nickname ?? 'Guest';
      // ソロ用の一時ルームを作成
      const room = roomManager.createRoom(socket.id, nickname, `${nickname}のソロ`, 1);
      socket.join(room.id);

      // ルーム状態を送信
      socket.emit('room:state', {
        room: { id: room.id, name: room.name },
        players: room.players,
        hostSocketId: room.hostSocketId,
        status: room.status,
      });

      // 即座にゲーム開始
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

      // fingerprint を gameRoom に設定
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

    // 切断
    socket.on('disconnect', () => {
      console.log(`Disconnected: ${socket.id}`);
      const { room } = roomManager.leaveRoom(socket.id);
      if (room) {
        io.to(room.id).emit('room:state', {
          room: {
            id: room.id,
            name: room.name,
          },
          players: room.players,
          hostSocketId: room.hostSocketId,
          status: room.status,
        });
      }
      io.emit('room:list', roomManager.getRoomList());
    });
  });
}
