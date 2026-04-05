/**
 * サウンドマネージャー
 * BGM + 効果音(SE)の再生管理
 */

type SEName =
  | 'harddrop'
  | 'rotate'
  | 'hold'
  | 'gameover'
  | 'garbage'
  | 'line1'
  | 'line2'
  | 'line3'
  | 'line4';

const SE_FILES: Record<SEName, string> = {
  harddrop: '/sounds/harddrop.mp3',
  rotate:   '/sounds/rotate.mp3',
  hold:     '/sounds/hold.mp3',
  gameover: '/sounds/gameover.mp3',
  garbage:  '/sounds/garbage.mp3',
  line1:    '/sounds/line1.mp3',
  line2:    '/sounds/line2.mp3',
  line3:    '/sounds/line3.mp3',
  line4:    '/sounds/line4.mp3',
};

class SoundManager {
  private seBuffers = new Map<SEName, AudioBuffer>();
  private audioCtx: AudioContext | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmVolume = 0.35;
  private seVolume = 0.6;
  private muted = false;
  private loaded = false;

  /** AudioContext を初期化（ユーザー操作後に呼ぶ） */
  private ensureContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /** 全音声データをプリロード */
  async load(): Promise<void> {
    if (this.loaded) return;
    const ctx = this.ensureContext();

    const entries = Object.entries(SE_FILES) as [SEName, string][];
    await Promise.all(
      entries.map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          const buf = await res.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(buf);
          this.seBuffers.set(name, audioBuf);
        } catch (e) {
          console.warn(`Failed to load sound: ${name}`, e);
        }
      }),
    );

    // BGM は HTMLAudioElement でループ再生
    this.bgmAudio = new Audio('/sounds/bgm.mp3');
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = this.bgmVolume;

    this.loaded = true;
  }

  /** 効果音を再生（Web Audio API で低遅延） */
  playSE(name: SEName): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    const buffer = this.seBuffers.get(name);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.seVolume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  }

  /** ライン消去SE（1~4ライン）遅延再生でハードドロップ音との重複回避 */
  playLineClear(lines: number, delayMs = 120): void {
    const clamped = Math.min(4, Math.max(1, lines)) as 1 | 2 | 3 | 4;
    setTimeout(() => {
      this.playSE(`line${clamped}` as SEName);
    }, delayMs);
  }

  /** BGM 再生 */
  playBGM(): void {
    if (!this.bgmAudio || this.muted) return;
    this.bgmAudio.currentTime = 0;
    this.bgmAudio.volume = this.bgmVolume;
    this.bgmAudio.play().catch(() => {});
  }

  /** BGM 停止 */
  stopBGM(): void {
    if (!this.bgmAudio) return;
    this.bgmAudio.pause();
    this.bgmAudio.currentTime = 0;
  }

  /** BGM フェードアウト（ゲームオーバー時） */
  fadeOutBGM(durationMs = 1000): void {
    if (!this.bgmAudio) return;
    const audio = this.bgmAudio;
    const startVol = audio.volume;
    const step = startVol / (durationMs / 50);
    const interval = setInterval(() => {
      audio.volume = Math.max(0, audio.volume - step);
      if (audio.volume <= 0) {
        clearInterval(interval);
        audio.pause();
        audio.currentTime = 0;
        audio.volume = this.bgmVolume;
      }
    }, 50);
  }

  /** ミュート切替 */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopBGM();
    }
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}

// シングルトン
export const soundManager = new SoundManager();
