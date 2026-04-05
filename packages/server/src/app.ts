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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DATABASE_PATH = process.env.DATABASE_PATH || './tetris.db';

// Express
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
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

// DB
const db = initDatabase(DATABASE_PATH);

// Room Manager
const roomManager = new RoomManager();

// Register Socket.io events
registerEvents(io, roomManager, db);

// Start
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Tetris server listening on port ${PORT}`);
  console.log(`CORS origin: ${CORS_ORIGIN}`);
  console.log(`Database: ${DATABASE_PATH}`);
  if (existsSync(clientDist)) {
    console.log(`Open http://localhost:${PORT} to play!`);
  }
});
