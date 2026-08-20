/**
 * クラウドセーブの同期。
 *
 * ログインが確認できたら pull → マージ → localStorage へ反映 → push。
 * 以降は設定を触るたびに遅延つきで push する。
 *
 * 失敗しても黙って諦める。設定が同期できないことは、ゲームを止める
 * 理由にならない。
 */

import { ConflictError, fetchSave, pushSave } from './api.js';
import { applyPayload, mergePayloads, normalizePayload, snapshotLocal } from './save.js';

const SEQ_KEY = 'tetris_cloud_seq';
/** 音量スライダーのような連続操作をまとめる。 */
const PUSH_DEBOUNCE_MS = 3000;

export type SyncOutcome = 'synced' | 'not-linked' | 'failed';

let enabled = false;
let inFlight: Promise<SyncOutcome> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** applyPayload 由来の localStorage 書き込みを push で拾わないための門。 */
let applying = false;

export function isCloudEnabled(): boolean {
  return enabled;
}

/** ログアウト時に呼ぶ。次のアカウントが前の連番を引き継がないように。 */
export function resetCloud(): void {
  enabled = false;
  try {
    window.localStorage.removeItem(SEQ_KEY);
  } catch {
    /* ignore */
  }
}

export function syncNow(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<SyncOutcome> {
  try {
    const envelope = await fetchSave();
    const local = snapshotLocal();

    if (envelope === null) {
      await write(local, 1);
      enabled = true;
      return 'synced';
    }

    const remote = normalizePayload(envelope.payload);
    const merged = remote ? mergePayloads(local, remote) : local;
    if (remote) {
      applying = true;
      try {
        applyPayload(merged);
      } finally {
        applying = false;
      }
    }
    await write(merged, envelope.save_seq + 1);
    enabled = true;
    return 'synced';
  } catch (e) {
    if (notLinked(e)) {
      enabled = false;
      return 'not-linked';
    }
    console.warn('[cloud] sync failed', e);
    return 'failed';
  }
}

/**
 * 押し込む。競合したら勝った側を取り込んで一度だけ再送する。
 * 二度目も競合するなら、別端末が今まさに書いているということなので
 * 次回の同期に任せる。
 */
async function write(payload: ReturnType<typeof snapshotLocal>, seq: number): Promise<void> {
  try {
    const res = await pushSave(payload, seq);
    setSeq(res.save_seq);
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    const winner = normalizePayload(e.current?.payload);
    const merged = winner ? mergePayloads(payload, winner) : payload;
    applying = true;
    try {
      applyPayload(merged);
    } finally {
      applying = false;
    }
    const res = await pushSave(merged, (e.current?.save_seq ?? seq) + 1);
    setSeq(res.save_seq);
  }
}

/** 設定を変えたあとに呼ぶ。連携していなければ何もしない。 */
export function scheduleCloudPush(): void {
  if (!enabled || applying) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pushLocal();
  }, PUSH_DEBOUNCE_MS);
}

/** ページを離れる直前など、待てない場面で即座に押し込む。 */
export async function flushCloudPush(): Promise<void> {
  if (!enabled) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  await pushLocal();
}

async function pushLocal(): Promise<void> {
  try {
    await write(snapshotLocal(), getSeq() + 1);
  } catch (e) {
    if (notLinked(e)) {
      enabled = false;
      return;
    }
    console.warn('[cloud] push failed', e);
  }
}

function notLinked(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === 'NOT_LINKED' || code === 'UNAUTHENTICATED';
}

function getSeq(): number {
  try {
    const n = Number(window.localStorage.getItem(SEQ_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function setSeq(seq: number): void {
  try {
    window.localStorage.setItem(SEQ_KEY, String(seq));
  } catch {
    /* ignore */
  }
}
