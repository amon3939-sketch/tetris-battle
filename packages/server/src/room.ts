import { v4 as uuidv4 } from 'uuid';
import type { ServerGameRoom } from './game.js';

export interface RoomPlayer {
  socketId: string;
  nickname: string;
}

export interface Room {
  id: string;
  name: string;
  hostSocketId: string;
  maxPlayers: number;
  password?: string;
  players: RoomPlayer[];
  status: 'waiting' | 'playing';
  gameRoom?: ServerGameRoom;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(
    socketId: string,
    nickname: string,
    name: string,
    maxPlayers: number,
    password?: string,
  ): Room {
    const room: Room = {
      id: uuidv4(),
      name,
      hostSocketId: socketId,
      maxPlayers: Math.max(1, Math.min(8, maxPlayers)),
      password,
      players: [{ socketId, nickname }],
      status: 'waiting',
    };
    this.rooms.set(room.id, room);
    return room;
  }

  joinRoom(
    roomId: string,
    socketId: string,
    nickname: string,
    password?: string,
  ): { ok: boolean; error?: string; room?: Room } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.status === 'playing') return { ok: false, error: 'Game already in progress' };
    if (room.players.length >= room.maxPlayers) return { ok: false, error: 'Room is full' };
    if (room.password && room.password !== password) return { ok: false, error: 'Incorrect password' };

    room.players.push({ socketId, nickname });
    return { ok: true, room };
  }

  leaveRoom(socketId: string): { room: Room | null; wasHost: boolean } {
    const room = this.getRoomBySocketId(socketId);
    if (!room) return { room: null, wasHost: false };

    const wasHost = room.hostSocketId === socketId;
    room.players = room.players.filter(p => p.socketId !== socketId);

    if (room.players.length === 0) {
      if (room.gameRoom) room.gameRoom.stop();
      this.rooms.delete(room.id);
      return { room: null, wasHost };
    }

    if (wasHost) {
      room.hostSocketId = room.players[0].socketId;
    }

    return { room, wasHost };
  }

  getRoomList(): Array<{
    id: string;
    name: string;
    playerCount: number;
    maxPlayers: number;
    hasPassword: boolean;
    status: string;
  }> {
    return Array.from(this.rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      playerCount: r.players.length,
      maxPlayers: r.maxPlayers,
      hasPassword: !!r.password,
      status: r.status,
    }));
  }

  getRoom(roomId: string): Room | null {
    return this.rooms.get(roomId) ?? null;
  }

  getRoomBySocketId(socketId: string): Room | null {
    for (const room of this.rooms.values()) {
      if (room.players.some(p => p.socketId === socketId)) return room;
    }
    return null;
  }

  startGame(roomId: string, socketId: string): { ok: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.hostSocketId !== socketId) return { ok: false, error: 'Only host can start the game' };
    if (room.status === 'playing') return { ok: false, error: 'Game already in progress' };
    if (room.players.length < 1) return { ok: false, error: 'Not enough players' };

    room.status = 'playing';
    return { ok: true };
  }
}
