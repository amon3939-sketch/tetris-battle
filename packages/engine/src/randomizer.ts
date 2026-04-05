import { type PieceType } from './types.js';

const ALL_PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// シンプルなシード付き乱数生成器（mulberry32）
function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SevenBag {
  private bag: PieceType[] = [];
  private rng: () => number;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  private refillBag(): void {
    const pieces = [...ALL_PIECES];
    // Fisher-Yatesシャッフル
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    this.bag.push(...pieces);
  }

  next(): PieceType {
    if (this.bag.length === 0) this.refillBag();
    return this.bag.shift()!;
  }

  peek(n: number): PieceType[] {
    while (this.bag.length < n) this.refillBag();
    return this.bag.slice(0, n);
  }
}
