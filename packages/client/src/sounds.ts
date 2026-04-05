/**
 * サウンドマネージャー
 * BGM（ロビー/プレイ/リザルト） + 効果音(SE)の再生管理
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

// プレイ中BGM（ランダム再生）
const PLAY_BGM_COUNT = 24; // bgm_play_00.mp3 ~ bgm_play_23.mp3
const PLAY_BGM_FILES = Array.from({ length: PLAY_BGM_COUNT }, (_, i) =>
  `/sounds/bgm_play_${String(i).padStart(2, '0')}.mp3`
);

type BGMType = 'lobby' | 'play' | 'result';

class SoundManager {
  private seBuffers = new Map<SEName, AudioBuffer>();
  private audioCtx: AudioContext | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private currentBGMType: BGMType | null = null;
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

  /** BGMのURLを取得 */
  private getBGMUrl(type: BGMType): string {
    switch (type) {
      case 'lobby':
        return '/sounds/bgm_lobby.mp3';
      case 'result':
        return '/sounds/bgm_result.mp3';
      case 'play': {
        // ランダムに1曲選択
        const idx = Math.floor(Math.random() * PLAY_BGM_FILES.length);
        return PLAY_BGM_FILES[idx];
      }
    }
  }

  /** BGM 再生（タイプ指定） */
  playBGM(type: BGMType = 'play'): void {
    if (this.muted) return;

    // 同じタイプが既に再生中ならスキップ（play以外）
    if (type !== 'play' && this.currentBGMType === type && this.bgmAudio && !this.bgmAudio.paused) {
      return;
    }

    // 既存のBGMを停止
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.removeEventListener('ended', this.onBGMEnded);
      this.bgmAudio = null;
    }

    const url = this.getBGMUrl(type);
    this.bgmAudio = new Audio(url);
    this.bgmAudio.volume = this.bgmVolume;
    this.currentBGMType = type;

    if (type === 'play') {
      // プレイBGMはループ: 曲が終わったら別のランダム曲を再生
      this.bgmAudio.addEventListener('ended', this.onBGMEnded);
    } else {
      // ロビー/リザルトはループ再生
      this.bgmAudio.loop = true;
    }

    this.bgmAudio.play().catch(() => {});
  }

  /** プレイBGM終了時に次のランダム曲を再生 */
  private onBGMEnded = (): void => {
    if (this.currentBGMType !== 'play') return;
    if (this.muted) return;

    const url = this.getBGMUrl('play');
    this.bgmAudio = new Audio(url);
    this.bgmAudio.volume = this.bgmVolume;
    this.bgmAudio.addEventListener('ended', this.onBGMEnded);
    this.bgmAudio.play().catch(() => {});
  };

  /** BGM 停止 */
  stopBGM(): void {
    if (!this.bgmAudio) return;
    this.bgmAudio.removeEventListener('ended', this.onBGMEnded);
    this.bgmAudio.pause();
    this.bgmAudio.currentTime = 0;
    this.bgmAudio = null;
    this.currentBGMType = null;
  }

  /** BGM フェードアウト（ゲームオーバー時） */
  fadeOutBGM(durationMs = 1000): void {
    if (!this.bgmAudio) return;
    const audio = this.bgmAudio;
    audio.removeEventListener('ended', this.onBGMEnded);
    const startVol = audio.volume;
    const step = startVol / (durationMs / 50);
    const interval = setInterval(() => {
      audio.volume = Math.max(0, audio.volume - step);
      if (audio.volume <= 0) {
        clearInterval(interval);
        audio.pause();
        audio.currentTime = 0;
        this.bgmAudio = null;
        this.currentBGMType = null;
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
