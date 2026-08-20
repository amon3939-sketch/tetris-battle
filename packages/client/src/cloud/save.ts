/**
 * テクマナのアカウントに紐づくクラウドセーブ。
 *
 * このゲームがブラウザに置いている設定は localStorage の4キーだけで、
 * どこにも控えが無い。端末を変えるとキー配置も音量も作り直しになる。
 * ここではその4キーを1つのペイロードにまとめ、テクマナ側のスロットに
 * 預ける。
 *
 * 個人記録も一緒に持つ。サーバの db.ts はインメモリなので、Railway が
 * 再起動するたびランキングは消える。クラウド側に置いた自己ベストだけは
 * 残る、という位置づけ。
 *
 * 競合は「後勝ち」にしない。2台で別々に遊べばどちらにも本物の記録が
 * 溜まるので、記録は max、設定は更新時刻が新しい方を採る。
 */

export const SAVE_VERSION = 1;

export type KeyMap = Record<string, string>;

export interface PersonalBest {
  bestScore: number;
  bestLines: number;
  totalLines: number;
  totalMatches: number;
  totalWins: number;
}

export interface SavePayload {
  v: number;
  nickname: string;
  keymap: KeyMap;
  bgmVol: number;
  seVol: number;
  best: PersonalBest;
  /** ISO文字列。マージできない項目の勝敗をここで決める。 */
  updatedAt: string;
}

export const EMPTY_BEST: PersonalBest = {
  bestScore: 0,
  bestLines: 0,
  totalLines: 0,
  totalMatches: 0,
  totalWins: 0,
};

const K = {
  nickname: 'tetris_nickname',
  keymap: 'tetris_keymap',
  bgm: 'tetris_bgm_vol',
  se: 'tetris_se_vol',
  best: 'tetris_best',
} as const;

const DEFAULT_BGM = 35;
const DEFAULT_SE = 60;

/* ------------------------------ localStorage ------------------------------ */

export function loadLocalBest(): PersonalBest {
  const raw = read(K.best);
  if (raw === null) return { ...EMPTY_BEST };
  try {
    return normalizeBest(JSON.parse(raw));
  } catch {
    return { ...EMPTY_BEST };
  }
}

export function saveLocalBest(best: PersonalBest): void {
  write(K.best, JSON.stringify(best));
}

/**
 * 1試合ぶんの結果を自己ベストに畳み込む。
 * ベスト系は max、累計系は加算。
 */
export function recordMatch(
  prev: PersonalBest,
  run: { score: number; lines: number; won: boolean },
): PersonalBest {
  return {
    bestScore: Math.max(prev.bestScore, run.score),
    bestLines: Math.max(prev.bestLines, run.lines),
    totalLines: prev.totalLines + Math.max(0, run.lines),
    totalMatches: prev.totalMatches + 1,
    totalWins: prev.totalWins + (run.won ? 1 : 0),
  };
}

export function snapshotLocal(): SavePayload {
  return {
    v: SAVE_VERSION,
    nickname: read(K.nickname) ?? '',
    keymap: parseKeyMap(read(K.keymap)),
    bgmVol: parseVol(read(K.bgm), DEFAULT_BGM),
    seVol: parseVol(read(K.se), DEFAULT_SE),
    best: loadLocalBest(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * ペイロードを localStorage へ書き戻す。
 *
 * 音量とキー配置は React の state にも載っているため、書き戻しただけでは
 * 画面に反映されない。呼び出し側が `applied` イベントで拾えるように
 * カスタムイベントを飛ばす。
 */
export function applyPayload(p: SavePayload): void {
  write(K.nickname, p.nickname);
  write(K.keymap, JSON.stringify(p.keymap));
  write(K.bgm, String(p.bgmVol));
  write(K.se, String(p.seVol));
  saveLocalBest(p.best);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<SavePayload>('tetox:cloud-applied', { detail: p }));
  }
}

/* --------------------------------- merge --------------------------------- */

export function mergePayloads(local: SavePayload, remote: SavePayload): SavePayload {
  // 設定はマージのしようがないので、最後に触った側を採る。
  const localWins = Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt);
  const pick = localWins ? local : remote;
  return {
    v: SAVE_VERSION,
    // 名前だけは空を勝たせない。未入力の端末が名前を消してしまうため。
    nickname: pick.nickname || local.nickname || remote.nickname,
    keymap: Object.keys(pick.keymap).length > 0 ? pick.keymap : local.keymap,
    bgmVol: pick.bgmVol,
    seVol: pick.seVol,
    best: mergeBest(local.best, remote.best),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 累計は和ではなく max を採る。両端末が同じ試合を数えている可能性があり、
 * 加算すると二重計上になる。max なら「少なくともこれだけは遊んだ」が保たれる。
 */
function mergeBest(a: PersonalBest, b: PersonalBest): PersonalBest {
  return {
    bestScore: Math.max(a.bestScore, b.bestScore),
    bestLines: Math.max(a.bestLines, b.bestLines),
    totalLines: Math.max(a.totalLines, b.totalLines),
    totalMatches: Math.max(a.totalMatches, b.totalMatches),
    totalWins: Math.min(Math.max(a.totalWins, b.totalWins), Math.max(a.totalMatches, b.totalMatches)),
  };
}

/* ------------------------------- normalize -------------------------------- */

/** 受け取ったものを必ず使える形にする。壊れていれば既定値へ落とす。 */
export function normalizePayload(raw: unknown): SavePayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  return {
    v: typeof d.v === 'number' ? d.v : SAVE_VERSION,
    nickname: typeof d.nickname === 'string' ? d.nickname.slice(0, 20) : '',
    keymap: isKeyMap(d.keymap) ? d.keymap : {},
    bgmVol: clampVol(d.bgmVol, DEFAULT_BGM),
    seVol: clampVol(d.seVol, DEFAULT_SE),
    best: normalizeBest(d.best),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date(0).toISOString(),
  };
}

function normalizeBest(raw: unknown): PersonalBest {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_BEST };
  const d = raw as Record<string, unknown>;
  return {
    bestScore: num(d.bestScore),
    bestLines: num(d.bestLines),
    totalLines: num(d.totalLines),
    totalMatches: num(d.totalMatches),
    totalWins: num(d.totalWins),
  };
}

function isKeyMap(v: unknown): v is KeyMap {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

function parseKeyMap(raw: string | null): KeyMap {
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return isKeyMap(v) ? v : {};
  } catch {
    return {};
  }
}

function parseVol(raw: string | null, fallback: number): number {
  return clampVol(raw === null ? undefined : Number(raw), fallback);
}

function clampVol(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/* ------------------------------ storage io -------------------------------- */

function read(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 容量超過・プライベートモード。設定が保存できないだけで遊べる。 */
  }
}
