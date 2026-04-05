import { io } from 'socket.io-client';

// サーバーURLの自動判定
// - 開発時（Viteポート5173）: 同じホストのポート3001に接続
// - 本番（サーバーから配信）: 同じオリジンに接続（ポート指定不要）
function getServerUrl(): string {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  const { hostname, port, protocol } = window.location;
  if (port === '5173') {
    return `${protocol}//${hostname}:3001`;
  }
  // サーバーから配信されている場合は同一オリジン
  return `${protocol}//${hostname}:${port}`;
}

export const socket = io(getServerUrl(), {
  autoConnect: false,
});
