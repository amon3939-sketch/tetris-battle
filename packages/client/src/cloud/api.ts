/**
 * /api/auth/techmana/* と /api/sync/* の薄いラッパ。
 *
 * クライアントはこのサーバ自身が配信しているので、宛先は全部相対パス。
 * ベースURLを組み立てる仕組みも CORS の考慮も要らない。
 */

import type { SavePayload } from './save.js';

export interface TechmanaStatus {
  enabled: boolean;
  linked: boolean;
  nickname: string | null;
  sub: string | null;
}

export interface SaveEnvelope {
  slot: string;
  payload: unknown;
  save_seq: number;
  updated_at?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 別端末が先に進めていたときに投げる。current にはその中身が入る。 */
export class ConflictError extends Error {
  constructor(readonly current: SaveEnvelope | null) {
    super('cloud save conflict');
    this.name = 'ConflictError';
  }
}

/** ログイン開始。fetch ではなく画面遷移でないといけない(Cookie と 302 のため)。 */
export const LOGIN_PATH = '/api/auth/techmana/start';

export async function fetchStatus(): Promise<TechmanaStatus> {
  try {
    return await call<TechmanaStatus>('GET', '/api/auth/techmana/status');
  } catch {
    // 状態表示は飾り。取れなければ「未連携」として扱い、ゲームは進める。
    return { enabled: false, linked: false, nickname: null, sub: null };
  }
}

export async function logout(): Promise<void> {
  await call<void>('POST', '/api/auth/techmana/logout');
}

/** @returns まだ一度も保存していなければ null。 */
export async function fetchSave(): Promise<SaveEnvelope | null> {
  try {
    return await call<SaveEnvelope>('GET', '/api/sync/save');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function pushSave(payload: SavePayload, saveSeq: number): Promise<{ save_seq: number }> {
  try {
    return await call<{ save_seq: number }>('PUT', '/api/sync/save', { payload, saveSeq });
  } catch (e) {
    // 409 でもコードを見る。未連携も 409 で来る設計にはしていないが、
    // 状態を取り違えると「マージすれば直る」と誤って再送してしまう。
    if (e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT') {
      const b = e.body as { current?: SaveEnvelope } | undefined;
      throw new ConflictError(b?.current ?? null);
    }
    throw e;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const d = json as { error?: string; message?: string } | undefined;
    throw new ApiError(res.status, d?.error ?? `HTTP_${res.status}`, d?.message ?? res.statusText, json);
  }
  return (json ?? {}) as T;
}
