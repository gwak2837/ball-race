import ms from 'ms';

export class MarblesSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private combo = 0;

  enable() {
    if (this.ctx) return;
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const AudioContextCtor =
      window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const master = ctx.createGain();
    master.gain.value = 0.65;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    void ctx.resume();
  }

  dispose() {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close();
  }

  private now() {
    const ctx = this.ctx;
    if (!ctx) return null;
    return ctx.currentTime;
  }

  private out() {
    return this.master;
  }

  private playTone(args: {
    type: OscillatorType;
    freqHz: number;
    gain: number;
    attackMs: number;
    decayMs: number;
    sustain: number;
    releaseMs: number;
    durationMs: number;
    detuneCents?: number;
    filter?: { type: BiquadFilterType; freqHz: number; q: number } | undefined;
  }) {
    const ctx = this.ctx;
    const master = this.master;
    const t0 = this.now();
    if (!ctx || !master || t0 === null) return;

    const osc = ctx.createOscillator();
    osc.type = args.type;
    osc.frequency.value = args.freqHz;
    if (args.detuneCents) osc.detune.value = args.detuneCents;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, args.gain), t0 + args.attackMs / 1000);
    g.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, args.gain * args.sustain),
      t0 + (args.attackMs + args.decayMs) / 1000,
    );

    const tEnd = t0 + args.durationMs / 1000;
    g.gain.exponentialRampToValueAtTime(0.0001, tEnd + args.releaseMs / 1000);

    let node: AudioNode = osc;
    if (args.filter) {
      const f = ctx.createBiquadFilter();
      f.type = args.filter.type;
      f.frequency.value = args.filter.freqHz;
      f.Q.value = args.filter.q;
      node.connect(f);
      node = f;
    }

    node.connect(g);
    g.connect(master);

    osc.start(t0);
    osc.stop(tEnd + args.releaseMs / 1000);
  }

  playClick(intensity01: number) {
    const i = Math.max(0, Math.min(1, intensity01));
    // Combo rises with intensity, then decays.
    this.combo = Math.max(0, Math.min(18, this.combo * 0.92 + i * 2.6));
    const base = 520 + this.combo * 42;
    const jitter = (Math.random() * 2 - 1) * 24;
    this.playTone({
      type: 'triangle',
      freqHz: base + jitter,
      gain: 0.07 + i * 0.12,
      attackMs: ms('2ms'),
      decayMs: ms('18ms'),
      sustain: 0.2,
      releaseMs: ms('30ms'),
      durationMs: ms('28ms'),
      filter: { type: 'highpass', freqHz: 700, q: 0.7 },
    });
  }

  playBumper(intensity01: number, kind: 'normal' | 'mega' = 'normal') {
    const i = Math.max(0, Math.min(1, intensity01));
    const w = kind === 'mega' ? 1.25 : 1;

    // Bumper combo rises faster than regular clicks (more "pinball pop" feel).
    this.combo = Math.max(0, Math.min(22, this.combo * 0.9 + i * 4.1 * w));

    // Low "thump"
    this.playTone({
      type: 'sine',
      freqHz: 92 + this.combo * 3.2,
      gain: (0.09 + i * 0.18) * w,
      attackMs: ms('2ms'),
      decayMs: ms('70ms'),
      sustain: 0.18,
      releaseMs: ms('120ms'),
      durationMs: ms('90ms'),
      filter: { type: 'lowpass', freqHz: 220, q: 0.85 },
    });

    // Bright "pop"
    const base = 720 + this.combo * 46;
    const jitter = (Math.random() * 2 - 1) * 34;
    this.playTone({
      type: 'triangle',
      freqHz: base + jitter,
      gain: (0.06 + i * 0.16) * w,
      attackMs: ms('2ms'),
      decayMs: ms('22ms'),
      sustain: 0.18,
      releaseMs: ms('40ms'),
      durationMs: ms('36ms'),
      filter: { type: 'highpass', freqHz: 650, q: 0.8 },
    });
  }

  playWarp() {
    this.playTone({
      type: 'sawtooth',
      freqHz: 220,
      gain: 0.12,
      attackMs: ms('4ms'),
      decayMs: ms('120ms'),
      sustain: 0.15,
      releaseMs: ms('120ms'),
      durationMs: ms('160ms'),
      filter: { type: 'bandpass', freqHz: 900, q: 1.1 },
    });
  }

  playBoost(kind: 'catchup' | 'debuff' | 'mid') {
    if (kind === 'debuff') {
      this.playTone({
        type: 'square',
        freqHz: 110,
        gain: 0.12,
        attackMs: ms('2ms'),
        decayMs: ms('70ms'),
        sustain: 0.2,
        releaseMs: ms('90ms'),
        durationMs: ms('90ms'),
        filter: { type: 'lowpass', freqHz: 260, q: 0.9 },
      });
      return;
    }
    this.playTone({
      type: 'sine',
      freqHz: kind === 'catchup' ? 420 : 320,
      gain: kind === 'catchup' ? 0.11 : 0.07,
      attackMs: ms('2ms'),
      decayMs: ms('90ms'),
      sustain: 0.2,
      releaseMs: ms('100ms'),
      durationMs: ms('120ms'),
      filter: { type: 'highpass', freqHz: 180, q: 0.7 },
    });
  }

  playCut() {
    this.playTone({
      type: 'square',
      freqHz: 70,
      gain: 0.22,
      attackMs: ms('2ms'),
      decayMs: ms('140ms'),
      sustain: 0.08,
      releaseMs: ms('180ms'),
      durationMs: ms('160ms'),
      filter: { type: 'lowpass', freqHz: 220, q: 0.8 },
    });
  }

  playSlowMo() {
    this.playTone({
      type: 'sine',
      freqHz: 180,
      gain: 0.09,
      attackMs: ms('12ms'),
      decayMs: ms('180ms'),
      sustain: 0.25,
      releaseMs: ms('220ms'),
      durationMs: ms('220ms'),
      filter: { type: 'lowpass', freqHz: 520, q: 0.7 },
    });
  }

  playWin() {
    this.playTone({
      type: 'triangle',
      freqHz: 440,
      gain: 0.12,
      attackMs: ms('4ms'),
      decayMs: ms('120ms'),
      sustain: 0.3,
      releaseMs: ms('200ms'),
      durationMs: ms('200ms'),
      filter: { type: 'highpass', freqHz: 220, q: 0.6 },
    });
    // Second tone (a bright fifth)
    this.playTone({
      type: 'triangle',
      freqHz: 660,
      gain: 0.1,
      attackMs: ms('6ms'),
      decayMs: ms('160ms'),
      sustain: 0.25,
      releaseMs: ms('240ms'),
      durationMs: ms('240ms'),
      filter: { type: 'highpass', freqHz: 260, q: 0.6 },
    });
  }
}


