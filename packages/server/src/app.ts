import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from './db.js';
import { RoomManager } from './room.js';
import { registerEvents } from './events.js';

// クラッシュ防止: 未処理エラーをキャッチしてログに出す
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Express
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    nodeVersion: process.version,
    port: PORT,
  });
});

// クライアントのビルド済みファイルを配信（離れた場所からのプレイ対応）
// tsx実行時: src/app.ts → ../../client/dist
// ビルド後: dist/app.js → ../../../client/dist
let clientDist = resolve(__dirname, '../../client/dist');
if (!existsSync(clientDist)) {
  clientDist = resolve(__dirname, '../../../client/dist');
}
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA のフォールバック
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/socket.io')) return next();
    res.sendFile(resolve(clientDist, 'index.html'));
  });
  console.log(`Serving client from: ${clientDist}`);
}

// HTTP server
const httpServer = createServer(app);

// Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// DB（インメモリ実装 - ネイティブモジュール不要）
const db = initDatabase();

// Room Manager
const roomManager = new RoomManager();

// Register Socket.io events
registerEvents(io, roomManager, db);

// Start
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Tetris server listening on port ${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
  console.log('Database: in-memory');
  if (existsSync(clientDist)) {
    console.log(`Open http://localhost:${PORT} to play!`);
  }
});
