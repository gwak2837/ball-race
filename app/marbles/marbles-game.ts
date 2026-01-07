import ms from 'ms';

import type * as RAPIER from '@dimforge/rapier2d-compat';
import type * as PIXI from 'pixi.js';

import type { Participant } from './participants';
import type { MarblesSfx } from './sfx';

export type MarblesPhase = 'idle' | 'running' | 'finished';

export interface LeaderRow {
  rank: number;
  id: string;
  name: string;
  colorHex: string;
  progressY: number;
  isStreamerPick: boolean;
  isFocusTarget: boolean;
}

export interface MarblesUiSnapshot {
  phase: MarblesPhase;
  elapsedMs: number;
  aliveCount: number;
  eliminatedCount: number;
  eliminatedBy?: { fall: number; cut: number } | undefined;
  top10: LeaderRow[];
  cut?: { checkpointNumber: number; remainingMs: number; cutCount: number } | undefined;
  slowMo?: { remainingMs: number } | undefined;
  focus?: { name: string; remainingMs: number } | undefined;
  postFinish?: { remainingMs: number } | undefined;
  winner?: { id: string; name: string; colorHex: string } | undefined;
}

type UiCallback = (snap: MarblesUiSnapshot) => void;

interface MarblesGameDeps {
  PIXI: typeof import('pixi.js');
  R: typeof import('@dimforge/rapier2d-compat');
  app: PIXI.Application;
}

interface StartOptions {
  participants: Participant[];
  streamerPickName: string;
  onUi: UiCallback;
  sfx?: MarblesSfx | null | undefined;
  gravityY?: number | undefined;
}

interface MarbleRuntime {
  participant: Participant;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  display: PIXI.Container;
  ball: PIXI.Sprite;
  ring: PIXI.Sprite;
  label?: PIXI.Text | undefined;
  progressY: number;
  lastProgressY: number;
  lastY: number;
  jetMask: number;
  bumpedAtMs: number;
  lastMovedAtMs: number;
  stuckCooldownUntilMs: number;
  isEliminated: boolean;
  eliminatedAtMs?: number | undefined;
  warpUsed: boolean;
  boostCooldownUntilMs: number;
  kickerCooldownUntilMs: number;
}

interface CameraState {
  x: number;
  y: number;
  mode: 'auto' | 'focus' | 'manual';
  focusUntilMs: number;
  focusId: string | null;
  focusName: string | null;
  manualUntilMs: number;
  shakeUntilMs: number;
  shakeAmp: number;
}

type SensorKind = 'cup' | 'warp' | 'boost' | 'kicker';

interface KinematicObstacle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  display: PIXI.Container;
  kind: 'rotor' | 'slider';
  baseX: number;
  baseY: number;
  halfW: number;
  halfH: number;
  phase: number;
  speed: number;
  amplitude: number;
  startAfterMs?: number | undefined;
  baseAngle: number;
  angleAmplitude: number;
}

interface JetBand {
  y: number;
  activeUntilMs: number;
  upVel: number;
}

const SCREEN_W = 1280;
const SCREEN_H = 720;
const WORLD_W = 1280;
const WORLD_H = 9200;
const CUP_X = WORLD_W / 2;
const CUP_Y = WORLD_H - 120;

const DEFAULT_GRAVITY_Y = 1000;

const MARBLE_R = 7;
const WALL_THICK = 40;

const UI_EMIT_EVERY_MS = ms('100ms');
const FIXED_STEP_MS = ms('16.666ms');
const OUT_OF_BOUNDS_Y = WORLD_H + 400;
const OUT_OF_BOUNDS_X_PAD = 160;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToPixiTint(hex: string): number {
  const v = hex.replace('#', '');
  return Number.parseInt(v, 16);
}

function maybeCreateLabel(args: { PIXI: typeof import('pixi.js'); marble: MarbleRuntime }): PIXI.Text {
  if (args.marble.label) return args.marble.label;
  const t = new args.PIXI.Text({
    text: args.marble.participant.initials,
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 10,
      fontWeight: '700',
      fill: 0x0a0a0a,
      align: 'center',
    },
  });
  t.anchor.set(0.5);
  t.y = 0;
  args.marble.display.addChild(t);
  args.marble.label = t;
  return t;
}

function computeSpawnPositions(count: number): Array<{ x: number; y: number }> {
  const spawnW = 880;
  const spacing = MARBLE_R * 2.4;
  const cols = Math.max(1, Math.floor(spawnW / spacing));
  const startX = (WORLD_W - spawnW) / 2;
  const startY = 40;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + (col + 0.5) * spacing;
    const y = startY + (row + 0.5) * spacing * 0.9;
    out.push({ x, y });
  }
  return out;
}

export class MarblesGame {
  private readonly PIXI: typeof import('pixi.js');
  private readonly R: typeof import('@dimforge/rapier2d-compat');
  private readonly app: PIXI.Application;

  private phase: MarblesPhase = 'idle';
  private onUi: UiCallback | null = null;

  private worldContainer: PIXI.Container | null = null;
  private world: RAPIER.World | null = null;
  private eventQueue: RAPIER.EventQueue | null = null;
  private staticBody: RAPIER.RigidBody | null = null;
  private sensorKindByHandle = new Map<number, SensorKind>();
  private kickerByHandle = new Map<
    number,
    {
      x: number;
      y: number;
      power: number;
      mode: 'radialOut' | 'towardCenter';
      activeUntilMs?: number | undefined;
      playSfx: boolean;
      cooldownMs?: number | undefined;
      radius?: number | undefined;
      fxKind?: 'jet' | 'bumper' | 'mega' | undefined;
    }
  >();

  private readonly checkpointsY = [2800, 6400] as const;
  private checkpointIndex = 0;
  private cutState: { checkpointNumber: number; endsAtMs: number; cutCount: number } | null = null;

  private bottom30MaxProgress = Number.NEGATIVE_INFINITY;
  private top10MinProgress = Number.POSITIVE_INFINITY;

  private timeScale = 1;
  private slowMoUntilMs = 0;
  private slowMoCooldownUntilMs = 0;

  private finishState: { winnerId: string; endsAtMs: number } | null = null;
  private winner: { id: string; name: string; colorHex: string } | null = null;
  private eliminatedBy = { fall: 0, cut: 0 };

  private textures: {
    ball: PIXI.Texture;
    ring: PIXI.Texture;
  } | null = null;

  private obstacles: KinematicObstacle[] = [];
  private jetBands: JetBand[] = [];
  private bumperFxG: PIXI.Graphics | null = null;
  private bumperFx: Array<{ x: number; y: number; r: number; atMs: number; kind: 'normal' | 'mega' }> = [];
  private lastBumperFxAtMs = 0;
  private lastBumperShakeAtMs = 0;

  private marbles: MarbleRuntime[] = [];
  private marblesByCollider = new Map<number, MarbleRuntime>();

  private startedAtMs = 0;
  private elapsedMs = 0;
  private accumulatorMs = 0;
  private lastTickMs = 0;
  private lastUiEmitMs = 0;

  private streamerPickName = '';
  private sfx: MarblesSfx | null = null;
  private lastClickAtMs = 0;
  private lastEventSfxAtMs = 0;
  private camera: CameraState = {
    x: 0,
    y: 0,
    mode: 'auto',
    focusUntilMs: 0,
    focusId: null,
    focusName: null,
    manualUntilMs: 0,
    shakeUntilMs: 0,
    shakeAmp: 0,
  };

  constructor(deps: MarblesGameDeps) {
    this.PIXI = deps.PIXI;
    this.R = deps.R;
    this.app = deps.app;
  }

  start(opts: StartOptions) {
    this.destroy();

    this.phase = 'running';
    this.onUi = opts.onUi;
    this.streamerPickName = opts.streamerPickName.trim();
    this.sfx = opts.sfx ?? null;
    this.lastClickAtMs = 0;
    this.lastEventSfxAtMs = 0;
    this.finishState = null;
    this.winner = null;
    this.eliminatedBy = { fall: 0, cut: 0 };
    this.startedAtMs = performance.now();
    this.elapsedMs = 0;
    this.accumulatorMs = 0;
    this.lastTickMs = performance.now();
    this.lastUiEmitMs = 0;

    const gravityY =
      typeof opts.gravityY === 'number' && Number.isFinite(opts.gravityY) ? opts.gravityY : DEFAULT_GRAVITY_Y;
    const world = new this.R.World({ x: 0, y: Math.max(200, gravityY) });
    this.world = world;
    this.eventQueue = new this.R.EventQueue(true);

    // One static body as an anchor for all static colliders (walls/pins/sensors).
    this.staticBody = world.createRigidBody(this.R.RigidBodyDesc.fixed());

    // Pixi world container
    const worldContainer = new this.PIXI.Container();
    this.worldContainer = worldContainer;
    this.app.stage.removeChildren();
    this.app.stage.addChild(worldContainer);

    this.textures = this.createTextures();

    this.sensorKindByHandle.clear();
    this.kickerByHandle.clear();
    this.checkpointIndex = 0;
    this.cutState = null;
    this.timeScale = 1;
    this.slowMoUntilMs = 0;
    this.slowMoCooldownUntilMs = 0;
    this.bottom30MaxProgress = Number.NEGATIVE_INFINITY;
    this.top10MinProgress = Number.POSITIVE_INFINITY;

    this.buildMap();
    this.spawnMarbles(opts.participants);

    this.emitUi(true);

    this.app.ticker.add(this.onTick);
  }

  destroy() {
    this.app.ticker.remove(this.onTick);
    this.phase = 'idle';
    this.onUi = null;
    this.sfx = null;
    this.lastClickAtMs = 0;
    this.lastEventSfxAtMs = 0;
    this.finishState = null;
    this.winner = null;
    this.eliminatedBy = { fall: 0, cut: 0 };
    this.world?.free?.();
    this.world = null;
    this.eventQueue = null;
    this.staticBody = null;
    this.sensorKindByHandle.clear();
    this.kickerByHandle.clear();
    this.checkpointIndex = 0;
    this.cutState = null;
    this.timeScale = 1;
    this.slowMoUntilMs = 0;
    this.slowMoCooldownUntilMs = 0;
    this.bottom30MaxProgress = Number.NEGATIVE_INFINITY;
    this.top10MinProgress = Number.POSITIVE_INFINITY;

    this.marblesByCollider.clear();
    this.marbles = [];
    this.obstacles = [];
    this.jetBands = [];
    this.bumperFxG = null;
    this.bumperFx = [];
    this.lastBumperFxAtMs = 0;
    this.lastBumperShakeAtMs = 0;
    this.camera = {
      x: 0,
      y: 0,
      mode: 'auto',
      focusUntilMs: 0,
      focusId: null,
      focusName: null,
      manualUntilMs: 0,
      shakeUntilMs: 0,
      shakeAmp: 0,
    };

    this.worldContainer?.destroy({ children: true });
    this.worldContainer = null;
  }

  setStreamerPickName(name: string) {
    this.streamerPickName = name.trim();
  }

  panCameraBy(dx: number, dy: number) {
    if (!this.worldContainer) return;
    const now = performance.now();
    this.camera.mode = 'manual';
    this.camera.focusId = null;
    this.camera.focusName = null;
    this.camera.focusUntilMs = 0;
    this.camera.manualUntilMs = now + ms('3s');
    this.camera.x = clamp(this.camera.x + dx, 0, WORLD_W - SCREEN_W);
    this.camera.y = clamp(this.camera.y + dy, 0, WORLD_H - SCREEN_H);
    this.worldContainer.x = -this.camera.x;
    this.worldContainer.y = -this.camera.y;
  }

  focusByName(name: string, durationMs = ms('4s')): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const exact = this.marbles.find((m) => !m.isEliminated && m.participant.name === trimmed);
    const partial = exact ?? this.marbles.find((m) => !m.isEliminated && m.participant.name.includes(trimmed));
    const target = partial;
    if (!target) return false;
    this.camera.mode = 'focus';
    this.camera.focusId = target.participant.id;
    this.camera.focusName = target.participant.name;
    this.camera.focusUntilMs = performance.now() + durationMs;
    this.camera.shakeUntilMs = performance.now() + ms('200ms');
    this.camera.shakeAmp = 5;
    return true;
  }

  private readonly onTick = () => {
    if (!this.world || !this.eventQueue || !this.worldContainer) return;

    const now = performance.now();
    const inPostFinish = Boolean(this.phase === 'finished' && this.finishState && now < this.finishState.endsAtMs);
    if (this.phase === 'finished' && this.finishState && now >= this.finishState.endsAtMs) {
      // Post-finish ended: emit one last UI snapshot so overlays can transition cleanly, then freeze.
      this.finishState = null;
      this.emitUi(true);
      this.app.ticker.remove(this.onTick);
      return;
    }
    if (this.phase !== 'running' && !inPostFinish) return;

    const frameMs = clamp(now - this.lastTickMs, 0, ms('50ms'));
    this.lastTickMs = now;
    this.accumulatorMs += frameMs;

    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.stepOnce(now);
      this.accumulatorMs -= FIXED_STEP_MS;
      this.elapsedMs += FIXED_STEP_MS;
    }

    this.updateCamera(now);
    this.render(now);
    this.maybePlayCollisionClicks(now);
    this.emitUi(false);
  };

  private maybePlayCollisionClicks(nowMs: number) {
    const sfx = this.sfx;
    if (!sfx) return;

    const elapsedMs = nowMs - this.startedAtMs;

    // Intensity ~= "how chaotic is the current camera view"
    const x0 = this.camera.x;
    const y0 = this.camera.y;
    const x1 = x0 + SCREEN_W;
    const y1 = y0 + SCREEN_H;

    let count = 0;
    let speedSum = 0;
    for (const m of this.marbles) {
      if (m.isEliminated) continue;
      const p = m.body.translation();
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      count += 1;
      const v = m.body.linvel();
      speedSum += Math.hypot(v.x, v.y);
      if (count >= 360) break;
    }
    if (count <= 6) return;
    const avgSpeed = speedSum / count;
    const density = clamp(count / 320, 0, 1);
    const speed = clamp(avgSpeed / 2800, 0, 1);
    let intensity = clamp(density * 0.7 + speed * 0.3, 0, 1);
    if (intensity < 0.18) return;

    // Early game limiter: lots of simultaneous collisions can sound like noise.
    const earlyFactor = elapsedMs < ms('8s') ? 1.8 : elapsedMs < ms('16s') ? 1.25 : 1;
    if (elapsedMs < ms('10s')) intensity *= 0.65;

    const maxInterval = ms('150ms');
    const minInterval = ms('60ms');
    const interval = (maxInterval - (maxInterval - minInterval) * intensity) * earlyFactor;
    if (nowMs - this.lastClickAtMs < interval) return;

    this.lastClickAtMs = nowMs;
    sfx.playClick(intensity);
  }

  private stepOnce(nowMs: number) {
    if (!this.world || !this.eventQueue) return;

    if (this.timeScale < 1 && nowMs >= this.slowMoUntilMs) {
      this.timeScale = 1;
    }

    this.updateObstacles(nowMs);

    // Rapier uses an internal dt; most builds expose `timestep`.
    this.world.timestep = (FIXED_STEP_MS / 1000) * this.timeScale;

    this.world.step(this.eventQueue);

    // Sensors: cup / warp / boost
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const k1 = this.sensorKindByHandle.get(h1);
      const k2 = this.sensorKindByHandle.get(h2);
      if (k1 && !k2) {
        const m = this.marblesByCollider.get(h2);
        if (m) this.onSensor(k1, h1, m, nowMs);
      } else if (k2 && !k1) {
        const m = this.marblesByCollider.get(h1);
        if (m) this.onSensor(k2, h2, m, nowMs);
      }
    });

    let aliveCount = 0;
    let leaderProgress = Number.NEGATIVE_INFINITY;
    let top1: MarbleRuntime | null = null;
    let top2: MarbleRuntime | null = null;
    let top3: MarbleRuntime | null = null;

    const elapsedMs = nowMs - this.startedAtMs;

    // Update progress + eliminate out-of-bounds
    for (const m of this.marbles) {
      if (m.isEliminated) continue;
      const prevY = m.lastY;
      const p = m.body.translation();
      const x = p.x;
      let y = p.y;

      // Jet bands (anti-speedrun) — apply once per marble per band.
      // Prevents the boring "everyone waits on one horizontal band" effect while still adding drama/time.
      if (this.phase === 'running' && this.jetBands.length > 0 && y > prevY) {
        for (let i = 0; i < this.jetBands.length; i += 1) {
          const band = this.jetBands[i];
          if (elapsedMs >= band.activeUntilMs) continue;
          const mask = 1 << i;
          if ((m.jetMask & mask) !== 0) continue;
          if (prevY < band.y && y >= band.y) {
            const clampedY = band.y - 44;
            const vx = clamp((CUP_X - x) * 2.2 + (Math.random() * 2 - 1) * 900, -3200, 3200);
            const vy = -Math.min(band.upVel, 1900);
            m.body.setTranslation({ x, y: clampedY }, true);
            m.body.setLinvel({ x: vx, y: vy }, true);
            m.body.setAngvel(0, true);
            m.jetMask |= mask;
            y = clampedY;
            break;
          }
        }
      }

      if (y > OUT_OF_BOUNDS_Y || x < -OUT_OF_BOUNDS_X_PAD || x > WORLD_W + OUT_OF_BOUNDS_X_PAD) {
        this.eliminate(m, nowMs, 'fall');
        continue;
      }

      // Hard finish check (sensor miss fallback): if a marble reaches the cup region, end immediately.
      if (this.phase === 'running') {
        const dxCup = x - CUP_X;
        const dyCup = y - CUP_Y;
        if (dxCup * dxCup + dyCup * dyCup < 120 * 120) {
          this.finish(m, nowMs);
          return;
        }
      }

      aliveCount += 1;
      // Ranking is y-based, but we never want "beyond the cup" progress unless you actually finish.
      // This prevents last-section geometry (and safety floors) from creating "high rank without finishing".
      const yForProgress = this.phase === 'running' ? Math.min(y, CUP_Y - 1) : y;
      m.progressY = Math.max(m.progressY, yForProgress);
      leaderProgress = Math.max(leaderProgress, m.progressY);
      m.lastY = y;

      if (!top1 || m.progressY > top1.progressY) {
        top3 = top2;
        top2 = top1;
        top1 = m;
      } else if (!top2 || m.progressY > top2.progressY) {
        top3 = top2;
        top2 = m;
      } else if (!top3 || m.progressY > top3.progressY) {
        top3 = m;
      }

      // Anti-stuck: if a marble hasn't progressed for a while and is almost stationary, nudge it.
      const v = m.body.linvel();
      const speed = Math.hypot(v.x, v.y);
      // Prevent tunneling through thin-ish colliders at extreme speeds.
      const maxSpeed = 7000;
      if (speed > maxSpeed) {
        const s = maxSpeed / speed;
        m.body.setLinvel({ x: v.x * s, y: v.y * s }, true);
      }
      const progressed = m.progressY - m.lastProgressY;
      if (progressed > 6) {
        m.lastProgressY = m.progressY;
        m.lastMovedAtMs = nowMs;
      } else if (nowMs >= m.stuckCooldownUntilMs && nowMs - m.lastMovedAtMs > ms('2.8s') && speed < 60) {
        m.stuckCooldownUntilMs = nowMs + ms('2s');
        m.lastMovedAtMs = nowMs;
        const pNow = m.body.translation();
        const nearFinish = pNow.y > CUP_Y - 1200;
        if (nearFinish) {
          const dx = CUP_X - pNow.x;
          const dy = CUP_Y - pNow.y;
          const len = Math.hypot(dx, dy) || 1;
          const ix = (dx / len) * 900;
          const iy = (dy / len) * 900;
          m.body.applyImpulse({ x: ix, y: iy }, true);
        } else {
          const jx = (Math.random() * 2 - 1) * 520;
          // Bias downward to keep progress going.
          const jy = 520 + Math.random() * 260;
          m.body.applyImpulse({ x: jx, y: jy }, true);
        }
      }

      // Finish drain: 낙사하지 않은 공은 결국 컵으로 들어오게 만들어요.
      // (수평면 금지 + 핀볼 구조 특성상, "미세 정체"를 완전히 없애려면 종반에 드레인이 필요해요.)
      if (elapsedMs > ms('40s') && p.y > CUP_Y - 2200) {
        const dx = CUP_X - p.x;
        const dy = CUP_Y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        const region = clamp((p.y - (CUP_Y - 2200)) / 2200, 0, 1);
        const time = clamp((elapsedMs - ms('40s')) / ms('12s'), 0, 1);
        const strength = region * time;
        const pull = 40 + strength * 260;
        m.body.applyImpulse({ x: (dx / dist) * pull, y: (dy / dist) * (pull * 1.25) }, true);
      }
    }

    // Checkpoint cut (2회)
    if (this.cutState) {
      if (nowMs >= this.cutState.endsAtMs) {
        this.applyCut(this.cutState.cutCount, nowMs);
        this.cutState = null;
        this.checkpointIndex += 1;
      }
    } else if (this.checkpointIndex < this.checkpointsY.length) {
      const y = this.checkpointsY[this.checkpointIndex];
      if (leaderProgress >= y) {
        const cutCount = Math.floor(aliveCount * 0.1);
        if (cutCount >= 5) {
          this.cutState = {
            checkpointNumber: this.checkpointIndex + 1,
            endsAtMs: nowMs + ms('3s'),
            cutCount,
          };
          this.camera.shakeUntilMs = nowMs + ms('180ms');
          this.camera.shakeAmp = 4;
        } else {
          // 5명 미만이면 컷 연출이 없어요.
          this.checkpointIndex += 1;
        }
      }
    }

    // Near-miss slow motion (결승 근처 Top3 초근접)
    if (this.phase === 'running' && this.timeScale === 1) {
      this.maybeStartSlowMo(nowMs, [top1, top2, top3]);
    }
  }

  private onSensor(kind: SensorKind, sensorHandle: number, marble: MarbleRuntime, nowMs: number) {
    if (marble.isEliminated) return;
    if (kind === 'cup') {
      if (this.phase === 'running') {
        this.finish(marble, nowMs);
      } else {
        // Post-finish: any marble that falls into the cup should disappear too.
        this.removeFromWorld(marble, nowMs, { hideImmediately: true });
      }
      return;
    }
    if (kind === 'warp') {
      this.tryWarp(marble, nowMs);
      return;
    }
    if (kind === 'boost') {
      this.tryBoost(marble, nowMs);
      return;
    }
    if (kind === 'kicker') {
      this.tryKicker(sensorHandle, marble, nowMs);
    }
  }

  private updateObstacles(nowMs: number) {
    if (!this.world) return;
    if (this.obstacles.length === 0) return;

    const t = nowMs / 1000;
    const elapsedMs = nowMs - this.startedAtMs;
    for (const o of this.obstacles) {
      const canMove = !o.startAfterMs || elapsedMs >= o.startAfterMs;
      if (!canMove) {
        o.body.setNextKinematicTranslation({ x: o.baseX, y: o.baseY });
        o.body.setNextKinematicRotation(o.baseAngle);
        continue;
      }
      if (o.kind === 'rotor') {
        // Full 360° spin is OK (walls are the only "no-horizontal" constraint).
        const angle = o.baseAngle + (t * o.speed + o.phase);
        o.body.setNextKinematicRotation(angle);
        o.body.setNextKinematicTranslation({ x: o.baseX, y: o.baseY });
        continue;
      }
      // slider: oscillate horizontally
      const x = o.baseX + Math.sin(t * o.speed + o.phase) * o.amplitude;
      o.body.setNextKinematicTranslation({ x, y: o.baseY });
      o.body.setNextKinematicRotation(o.baseAngle);
    }
  }

  private ensureRankThresholds() {
    if (this.bottom30MaxProgress !== Number.NEGATIVE_INFINITY && this.top10MinProgress !== Number.POSITIVE_INFINITY) {
      return;
    }
    const alive = this.marbles.filter((m) => !m.isEliminated);
    if (alive.length === 0) return;
    const sorted = alive.slice().sort((a, b) => b.progressY - a.progressY);
    this.updateRankThresholds(sorted);
  }

  private updateRankThresholds(sortedDesc: MarbleRuntime[]) {
    const aliveCount = sortedDesc.length;
    if (aliveCount === 0) return;

    const topCount = Math.max(1, Math.ceil(aliveCount * 0.1));
    const bottomCount = Math.max(1, Math.ceil(aliveCount * 0.3));

    const topIdx = clamp(topCount - 1, 0, aliveCount - 1);
    const bottomIdx = clamp(aliveCount - bottomCount, 0, aliveCount - 1);

    this.top10MinProgress = sortedDesc[topIdx]?.progressY ?? 0;
    this.bottom30MaxProgress = sortedDesc[bottomIdx]?.progressY ?? 0;
  }

  private isBottom30(m: MarbleRuntime): boolean {
    this.ensureRankThresholds();
    return m.progressY <= this.bottom30MaxProgress;
  }

  private isTop10(m: MarbleRuntime): boolean {
    this.ensureRankThresholds();
    return m.progressY >= this.top10MinProgress;
  }

  private tryWarp(m: MarbleRuntime, nowMs: number) {
    if (m.warpUsed) return;
    if (!this.isBottom30(m)) return;

    m.warpUsed = true;
    const x = 585 + Math.random() * 110;
    const y = 7700;

    m.body.setTranslation({ x, y }, true);
    m.body.setLinvel({ x: 0, y: 2200 }, true);
    m.body.setAngvel(0, true);
    m.progressY = Math.max(m.progressY, y);

    this.sfx?.playWarp();
    this.camera.shakeUntilMs = nowMs + ms('220ms');
    this.camera.shakeAmp = 6;
  }

  private tryBoost(m: MarbleRuntime, nowMs: number) {
    if (nowMs < m.boostCooldownUntilMs) return;
    m.boostCooldownUntilMs = nowMs + ms('900ms');

    const v = m.body.linvel();
    if (this.isBottom30(m)) {
      // Catch-up boost
      const vy = Math.max(v.y, 3000);
      m.body.setLinvel({ x: v.x * 0.6, y: vy }, true);
      this.sfx?.playBoost('catchup');
      this.camera.shakeUntilMs = nowMs + ms('120ms');
      this.camera.shakeAmp = 3;
      return;
    }
    if (this.isTop10(m)) {
      // Leader debuff (slower + slight sideways wobble)
      const vy = v.y * 0.35;
      const wobble = (Math.random() * 2 - 1) * 420;
      m.body.setLinvel({ x: v.x * 0.4 + wobble, y: vy }, true);
      this.sfx?.playBoost('debuff');
      return;
    }
    // Middle pack: mild boost
    m.body.setLinvel({ x: v.x * 0.7, y: Math.max(v.y, 2500) }, true);
    this.sfx?.playBoost('mid');
  }

  private tryKicker(sensorHandle: number, m: MarbleRuntime, nowMs: number) {
    const kicker = this.kickerByHandle.get(sensorHandle);
    if (!kicker) return;
    const elapsedMs = nowMs - this.startedAtMs;
    if (kicker.activeUntilMs && elapsedMs >= kicker.activeUntilMs) return;
    if (nowMs < m.kickerCooldownUntilMs) return;
    m.kickerCooldownUntilMs = nowMs + (kicker.cooldownMs ?? ms('420ms'));

    const p = m.body.translation();
    let dx = p.x - kicker.x;
    let dy = p.y - kicker.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.0001) {
      dx /= len;
      dy /= len;
    } else {
      dx = Math.random() * 2 - 1;
      dy = Math.random() * 2 - 1;
    }

    const power = kicker.power;
    const dirX = kicker.mode === 'towardCenter' ? -dx : dx;
    if (!kicker.playSfx) {
      // Jet band: set velocity directly so it actually prevents speedruns (impulses are too small vs 1000 balls mass).
      const vx = clamp((kicker.x - p.x) * 3.2, -2600, 2600);
      const vy = -power;
      m.body.setLinvel({ x: vx, y: vy }, true);
      m.body.setAngvel(0, true);
      return;
    }

    // Pop bumper: set a strong outgoing velocity (more consistent + punchy than impulse).
    const v0 = m.body.linvel();
    const speed0 = Math.hypot(v0.x, v0.y);
    const kick = Math.max(speed0, power);
    const jitter = (Math.random() * 2 - 1) * (kick * 0.14);
    const vx = dirX * kick + jitter;
    // Upward bias to create hang-time + drama, but keep it bounded.
    const vy = clamp(dy * kick - kick * 0.78, -6200, 5200);
    m.body.setLinvel({ x: vx, y: vy }, true);
    m.body.setAngvel((Math.random() * 2 - 1) * 7.5, true);
    m.bumpedAtMs = nowMs;

    // Local hit flash (cheap): record an event and draw a ring in `render()`.
    const fxKind = kicker.fxKind === 'mega' ? 'mega' : 'normal';
    const fxR = kicker.radius ?? 28;
    if (nowMs - this.lastBumperFxAtMs >= ms('26ms')) {
      this.lastBumperFxAtMs = nowMs;
      this.bumperFx.push({ x: kicker.x, y: kicker.y, r: fxR, atMs: nowMs, kind: fxKind });
      if (this.bumperFx.length > 40) this.bumperFx.splice(0, this.bumperFx.length - 40);
    }
    // Global event SFX limiter (prevents early-game overlap noise)
    if (this.sfx && kicker.playSfx) {
      const minGap = elapsedMs < ms('10s') ? ms('140ms') : ms('80ms');
      if (nowMs - this.lastEventSfxAtMs >= minGap) {
        this.lastEventSfxAtMs = nowMs;
        const intensity = elapsedMs < ms('10s') ? 0.55 : 0.85;
        this.sfx.playBumper(intensity, fxKind);
      }
    }

    // Small camera shake if the bumper is on-screen (prevents off-screen noise).
    const inView =
      kicker.x >= this.camera.x - 60 &&
      kicker.x <= this.camera.x + SCREEN_W + 60 &&
      kicker.y >= this.camera.y - 60 &&
      kicker.y <= this.camera.y + SCREEN_H + 60;
    if (inView && nowMs - this.lastBumperShakeAtMs >= ms('120ms')) {
      this.lastBumperShakeAtMs = nowMs;
      const amp = fxKind === 'mega' ? 6 : 3;
      this.camera.shakeUntilMs = Math.max(this.camera.shakeUntilMs, nowMs + ms('140ms'));
      this.camera.shakeAmp = Math.max(this.camera.shakeAmp, amp);
    }
  }

  private applyCut(cutCount: number, nowMs: number) {
    if (cutCount < 5) return;
    const alive = this.marbles.filter((m) => !m.isEliminated);
    if (alive.length < 50) return; // 10%가 5 미만이면 컷이 없어요.

    const sorted = alive.slice().sort((a, b) => a.progressY - b.progressY);
    const victims = sorted.slice(0, cutCount);
    for (const v of victims) this.eliminate(v, nowMs, 'cut');

    this.sfx?.playCut();
    this.camera.shakeUntilMs = nowMs + ms('320ms');
    this.camera.shakeAmp = 12;
  }

  private maybeStartSlowMo(nowMs: number, top3: Array<MarbleRuntime | null>) {
    if (nowMs < this.slowMoCooldownUntilMs) return;
    if (this.timeScale !== 1) return;

    const cupX = CUP_X;
    const cupY = CUP_Y;
    const finalStartY = CUP_Y - 520;

    const contenders = top3.filter((m): m is MarbleRuntime => Boolean(m && !m.isEliminated));
    const near = contenders.filter((m) => m.progressY >= finalStartY);
    if (near.length < 2) return;

    const ys = near.map((m) => m.body.translation().y);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    if (maxY - minY > 70) return;

    const closeToCup = near.some((m) => {
      const p = m.body.translation();
      return Math.hypot(p.x - cupX, p.y - cupY) < 240;
    });
    if (!closeToCup) return;

    this.timeScale = 0.25;
    this.slowMoUntilMs = nowMs + ms('2.2s');
    this.slowMoCooldownUntilMs = nowMs + ms('7s');
    this.sfx?.playSlowMo();
    this.camera.shakeUntilMs = nowMs + ms('180ms');
    this.camera.shakeAmp = 4;
  }

  private finish(winner: MarbleRuntime, nowMs: number) {
    if (this.phase !== 'running') return;
    if (winner.isEliminated) return;
    // Remove the winner marble from the physics world immediately so it can't bounce out and affect ranks.
    // (Winner UI is preserved via `this.winner` snapshot.)
    this.removeFromWorld(winner, nowMs, { hideImmediately: true });
    this.phase = 'finished';
    this.finishState = { winnerId: winner.participant.id, endsAtMs: nowMs + ms('4.5s') };
    this.winner = {
      id: winner.participant.id,
      name: winner.participant.name,
      colorHex: winner.participant.colorHex,
    };
    this.sfx?.playWin();
    // Hold the camera on the cup area for a moment so the ending doesn't feel abrupt.
    this.camera.mode = 'manual';
    this.camera.manualUntilMs = this.finishState.endsAtMs;
    this.camera.x = 0;
    this.camera.y = clamp(CUP_Y - SCREEN_H * 0.72, 0, WORLD_H - SCREEN_H);
    this.camera.shakeUntilMs = nowMs + ms('350ms');
    this.camera.shakeAmp = 10;
    this.emitUi(true, winner);
  }

  private removeFromWorld(m: MarbleRuntime, nowMs: number, opts?: { hideImmediately?: boolean } | undefined) {
    if (!this.world) return;
    if (m.isEliminated) return;
    m.isEliminated = true;
    m.eliminatedAtMs = opts?.hideImmediately ? nowMs - ms('999ms') : nowMs;
    this.marblesByCollider.delete(m.collider.handle);
    this.world.removeCollider(m.collider, true);
    this.world.removeRigidBody(m.body);
  }

  private eliminate(m: MarbleRuntime, nowMs: number, reason: 'fall' | 'cut') {
    if (m.isEliminated) return;
    this.eliminatedBy[reason] += 1;
    this.removeFromWorld(m, nowMs);
  }

  private updateCamera(nowMs: number) {
    if (!this.worldContainer) return;

    const alive = this.marbles.filter((m) => !m.isEliminated);
    if (alive.length === 0) return;

    if (this.camera.mode === 'manual' && nowMs >= this.camera.manualUntilMs) {
      this.camera.mode = 'auto';
    }
    if (this.camera.mode === 'focus' && nowMs >= this.camera.focusUntilMs) {
      this.camera.mode = 'auto';
      this.camera.focusId = null;
      this.camera.focusName = null;
    }

    let targetY = 0;
    let targetX = WORLD_W / 2;

    if (this.camera.mode === 'manual') {
      targetX = this.camera.x + SCREEN_W / 2;
      targetY = this.camera.y + SCREEN_H / 2;
    } else if (this.camera.mode === 'focus' && this.camera.focusId) {
      const t = alive.find((m) => m.participant.id === this.camera.focusId);
      if (t) {
        const p = t.body.translation();
        targetY = p.y;
        targetX = p.x;
      }
    } else {
      // Auto: follow TOP1 (alive).
      const top1 = alive.slice().sort((a, b) => b.progressY - a.progressY)[0];
      const p = top1?.body.translation();
      if (p) {
        targetY = p.y;
        targetX = p.x;
      }
    }

    const desiredY = clamp(targetY - SCREEN_H * 0.35, 0, WORLD_H - SCREEN_H);
    const desiredX = clamp(targetX - SCREEN_W / 2, 0, WORLD_W - SCREEN_W);

    // Smooth follow
    const lerp = this.camera.mode === 'manual' ? 1 : 0.12;
    this.camera.y = this.camera.y + (desiredY - this.camera.y) * lerp;
    this.camera.x = this.camera.x + (desiredX - this.camera.x) * lerp;

    let shakeX = 0;
    let shakeY = 0;
    if (nowMs < this.camera.shakeUntilMs) {
      const amp = this.camera.shakeAmp;
      shakeX = (Math.random() * 2 - 1) * amp;
      shakeY = (Math.random() * 2 - 1) * amp;
    }

    this.worldContainer.x = -this.camera.x + shakeX;
    this.worldContainer.y = -this.camera.y + shakeY;
  }

  private render(nowMs: number) {
    if (!this.worldContainer) return;

    // Bumper hit flashes
    if (this.bumperFxG) {
      const g = this.bumperFxG;
      g.clear();
      const next: Array<{ x: number; y: number; r: number; atMs: number; kind: 'normal' | 'mega' }> = [];
      for (const fx of this.bumperFx) {
        const t = clamp((nowMs - fx.atMs) / ms('220ms'), 0, 1);
        if (t >= 1) continue;
        next.push(fx);
        const scale = 1 + t * 1.8;
        const alpha = (1 - t) * (fx.kind === 'mega' ? 0.34 : 0.22);
        const color = fx.kind === 'mega' ? 0xfacc15 : 0xf97316;
        g.circle(fx.x, fx.y, (fx.r + 12) * scale).stroke({ color, width: 2, alpha });
        g.circle(fx.x, fx.y, fx.r * 0.9).fill({ color, alpha: alpha * 0.12 });
      }
      this.bumperFx = next;
    }

    for (const o of this.obstacles) {
      const p = o.body.translation();
      o.display.position.set(p.x, p.y);
      o.display.rotation = o.body.rotation();
    }

    for (const m of this.marbles) {
      const alive = !m.isEliminated;
      if (alive) {
        const p = m.body.translation();
        m.display.visible = true;
        m.display.alpha = 1;
        m.display.position.set(p.x, p.y);
        const dt = nowMs - m.bumpedAtMs;
        if (dt >= 0 && dt < ms('160ms')) {
          const t = clamp(dt / ms('160ms'), 0, 1);
          const s = 1 + (1 - t) * 0.22;
          m.display.scale.set(s);
        } else if (m.display.scale.x !== 1) {
          m.display.scale.set(1);
        }
        continue;
      }

      // Simple elimination animation (fade out)
      const diedAt = m.eliminatedAtMs ?? nowMs;
      const t = clamp((nowMs - diedAt) / ms('400ms'), 0, 1);
      m.display.visible = true;
      m.display.alpha = 1 - t;
      m.display.scale.set(1 - t * 0.25);
      if (t >= 1) {
        m.display.visible = false;
      }
    }

    // Highlight: streamer pick + focus
    const streamer = this.streamerPickName;
    const focusId = this.camera.focusId;
    for (const m of this.marbles) {
      if (m.isEliminated) {
        m.ring.visible = false;
        if (m.label) m.label.visible = false;
        continue;
      }
      const isStreamer = streamer && m.participant.name === streamer;
      const isFocus = focusId && m.participant.id === focusId;
      m.ring.visible = Boolean(isStreamer || isFocus);
      if (m.ring.visible) {
        m.ring.alpha = isFocus ? 0.95 : 0.65;
        m.ring.scale.set(isFocus ? 1.25 : 1.1);
      }
      if (isStreamer || isFocus) {
        const label = maybeCreateLabel({ PIXI: this.PIXI, marble: m });
        label.visible = true;
      } else if (m.label) {
        m.label.visible = false;
      }
    }
  }

  private emitUi(force: boolean, winner?: MarbleRuntime) {
    if (!this.onUi) return;
    const now = performance.now();
    if (!force && now - this.lastUiEmitMs < UI_EMIT_EVERY_MS) return;
    this.lastUiEmitMs = now;

    const alive = this.marbles.filter((m) => !m.isEliminated);
    const eliminatedCount = this.eliminatedBy.fall + this.eliminatedBy.cut;
    const sortedAll = alive.slice().sort((a, b) => b.progressY - a.progressY);
    this.updateRankThresholds(sortedAll);
    const sorted = sortedAll.slice(0, 10);

    const focusId = this.camera.focusId;
    const streamer = this.streamerPickName;

    const top10: LeaderRow[] = sorted.map((m, idx) => ({
      rank: idx + 1,
      id: m.participant.id,
      name: m.participant.name,
      colorHex: m.participant.colorHex,
      progressY: m.progressY,
      isStreamerPick: Boolean(streamer && m.participant.name === streamer),
      isFocusTarget: Boolean(focusId && m.participant.id === focusId),
    }));

    const win = winner
      ? {
          id: winner.participant.id,
          name: winner.participant.name,
          colorHex: winner.participant.colorHex,
        }
      : this.winner ?? undefined;

    const cut = this.cutState
      ? {
          checkpointNumber: this.cutState.checkpointNumber,
          remainingMs: Math.max(0, this.cutState.endsAtMs - now),
          cutCount: this.cutState.cutCount,
        }
      : undefined;

    const slowMo = this.timeScale < 1 ? { remainingMs: Math.max(0, this.slowMoUntilMs - now) } : undefined;

    const focus =
      this.camera.mode === 'focus' && this.camera.focusName && now < this.camera.focusUntilMs
        ? { name: this.camera.focusName, remainingMs: Math.max(0, this.camera.focusUntilMs - now) }
        : undefined;

    const postFinish =
      this.finishState && now < this.finishState.endsAtMs
        ? { remainingMs: Math.max(0, this.finishState.endsAtMs - now) }
        : undefined;

    this.onUi({
      phase: this.phase,
      elapsedMs: Math.round(this.elapsedMs),
      aliveCount: alive.length,
      eliminatedCount,
      eliminatedBy: { ...this.eliminatedBy },
      top10,
      cut,
      slowMo,
      focus,
      postFinish,
      winner: win,
    });
  }

  private createTextures(): { ball: PIXI.Texture; ring: PIXI.Texture } {
    const gBall = new this.PIXI.Graphics().circle(0, 0, MARBLE_R).fill({ color: 0xffffff });
    const gRing = new this.PIXI.Graphics().circle(0, 0, MARBLE_R + 4).stroke({ color: 0xffffff, width: 3 });

    const ball = this.app.renderer.generateTexture(gBall);
    const ring = this.app.renderer.generateTexture(gRing);
    return { ball, ring };
  }

  private buildMap() {
    const world = this.world;
    const staticBody = this.staticBody;
    const worldContainer = this.worldContainer;
    if (!world || !staticBody || !worldContainer) return;

    this.jetBands = [];

    // Visuals
    const g = new this.PIXI.Graphics().rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0x0a0a0a });
    worldContainer.addChild(g);

    const mapLines = new this.PIXI.Graphics();
    mapLines.alpha = 0.9;
    worldContainer.addChild(mapLines);

    const addWall = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts?: { friction?: number; restitution?: number } | undefined
    ) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const angle = Math.atan2(dy, dx);

      const friction = opts?.friction ?? 0.6;
      const restitution = opts?.restitution ?? 0.12;

      const c = this.R.ColliderDesc.cuboid(len / 2, WALL_THICK / 2)
        .setTranslation(cx, cy)
        .setRotation(angle)
        .setFriction(friction)
        .setRestitution(restitution);
      world.createCollider(c, staticBody);

      mapLines.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0x2a2a2a, width: 4, cap: 'round' });
    };

    // Outer walls (full height) -> 낙사 비율을 크게 줄여요
    // Extend slightly below the world so the bottom catcher floor can't leak at the corners.
    addWall(80, 0, 80, WORLD_H + 120);
    addWall(1200, 0, 1200, WORLD_H + 120);

    // Pinball board (no funnel, no repetitive steps)
    // Irregular pins: removes "clean lanes" (especially near the side walls).
    const rng = mulberry32(0xC0FFEE);
    const pinsG = new this.PIXI.Graphics();
    worldContainer.addChild(pinsG);
    const pinBaseR = 5;
    const pinRows = 34;
    const pinCols = 13;
    const baseX = 132;
    const spacingX = 76;
    const baseY = 220;
    const spacingY = 64;
    const skipChance = 0.12;
    for (let row = 0; row < pinRows; row += 1) {
      const y = baseY + row * spacingY + (rng() - 0.5) * 22;
      if (y > 2580) continue;
      const rowShift = (row % 2) * (spacingX * 0.48) + (rng() - 0.5) * 22;
      for (let col = 0; col < pinCols; col += 1) {
        if (rng() < skipChance) continue;
        const x = baseX + col * spacingX + rowShift + (rng() - 0.5) * 26;
        if (x < 118 || x > 1162) continue;
        const r = pinBaseR + (rng() < 0.15 ? 1 : 0);
        const restitution = 0.52 + rng() * 0.22;
        const friction = 0.05 + rng() * 0.1;
        const cd = this.R.ColliderDesc.ball(r)
          .setTranslation(x, y)
          .setRestitution(restitution)
          .setFriction(friction);
        world.createCollider(cd, staticBody);
        pinsG.circle(x, y, r).fill({ color: 0x1f2937, alpha: 0.82 });
      }
    }

    // Edge pin curtains (kills the straight drop lane along outer walls)
    for (let i = 0; i < 22; i += 1) {
      const y = 360 + i * 96 + rng() * 50;
      if (y > 2600) break;
      const r = pinBaseR + 1;
      const leftX = 118 + rng() * 22;
      const rightX = 1162 - rng() * 22;
      const rest = 0.62 + rng() * 0.18;
      const fr = 0.04 + rng() * 0.08;
      world.createCollider(this.R.ColliderDesc.ball(r).setTranslation(leftX, y).setRestitution(rest).setFriction(fr), staticBody);
      world.createCollider(this.R.ColliderDesc.ball(r).setTranslation(rightX, y).setRestitution(rest).setFriction(fr), staticBody);
      pinsG.circle(leftX, y, r).fill({ color: 0x1f2937, alpha: 0.78 });
      pinsG.circle(rightX, y, r).fill({ color: 0x1f2937, alpha: 0.78 });
    }

    // Edge deflectors (angled walls) to push marbles back into the playfield
    addWall(80, 820, 240, 1060, { friction: 0.04, restitution: 0.18 });
    addWall(1200, 920, 1040, 1160, { friction: 0.04, restitution: 0.18 });
    addWall(80, 1400, 260, 1640, { friction: 0.04, restitution: 0.18 });
    addWall(1200, 1520, 1020, 1760, { friction: 0.04, restitution: 0.18 });

    // 30° staircase baffles (longer run, avoids V-shaped dead pockets)
    // Alternate left/right ramps but leave a center gap so nothing forms a concave valley.
    const stairStroke = { color: 0x111827, width: 4, alpha: 0.8 } as const;
    const stairsG = new this.PIXI.Graphics();
    worldContainer.addChild(stairsG);
    const addStair = (x1: number, y1: number, x2: number, y2: number) => {
      addWall(x1, y1, x2, y2, { friction: 0.04, restitution: 0.18 });
      stairsG.moveTo(x1, y1).lineTo(x2, y2).stroke(stairStroke);
    };

    const stairDx = 420;
    const stairDy = 242; // ~= tan(30deg) * 420
    const stepY = 280;
    // Skip the first step: it overlaps the first bounce/gate region.
    for (let i = 1; i < 7; i += 1) {
      const yL = 2620 + i * stepY;
      const yR = 2760 + i * stepY;
      addStair(120, yL, 120 + stairDx, yL + stairDy); // down-right
      addStair(1160, yR, 1160 - stairDx, yR + stairDy); // down-left
    }

    // Static V-rails / wide walls easily create "valleys" (dead pockets) with 1,000 marbles.
    // -> Keep walls minimal and rely on moving obstacles + bumpers instead.

    // Timed gate positions (actual gates are moving sliders; no static bars)
    const gate1Y = 3160;
    const gate2Y = 6260;

    // Anti-speedrun jets: prevent free-fall finishes in ~10s while keeping speed/impact.
    // 센서라서 포켓을 만들지 않고, 시간만 늘려줘요.
    const jetsG = new this.PIXI.Graphics();
    worldContainer.addChild(jetsG);
    const addJet = (args: { y: number; activeUntilMs: number; power: number }) => {
      const halfW = WORLD_W; // cover full width
      const halfH = 26;
      const cd = this.R.ColliderDesc.cuboid(halfW, halfH)
        .setTranslation(CUP_X, args.y)
        .setSensor(true)
        .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
      const col = world.createCollider(cd, staticBody);
      this.sensorKindByHandle.set(col.handle, 'kicker');
      this.kickerByHandle.set(col.handle, {
        x: CUP_X,
        y: args.y,
        power: args.power,
        mode: 'towardCenter',
        activeUntilMs: args.activeUntilMs,
        playSfx: false,
        cooldownMs: ms('420ms'),
        fxKind: 'jet',
      });
      this.jetBands.push({ y: args.y, activeUntilMs: args.activeUntilMs, upVel: args.power });
      jetsG
        .roundRect(120, args.y - halfH, 1040, halfH * 2, 18)
        .fill({ color: 0x22d3ee, alpha: 0.04 })
        .stroke({ color: 0x22d3ee, width: 1, alpha: 0.12 });
    };

    // `power` here is the upward velocity target (px/s).
    // Time gates: guarantee the round isn't a ~10s speedrun.
    addJet({ y: 2860, activeUntilMs: ms('28s'), power: 2800 });
    addJet({ y: 5200, activeUntilMs: ms('52s'), power: 3200 });
    addJet({ y: CUP_Y - 980, activeUntilMs: ms('70s'), power: 3600 });

    // Big bounce bumpers (static) - 큰 튕김 연출
    const bumpersG = new this.PIXI.Graphics();
    worldContainer.addChild(bumpersG);
    const bumperFxG = new this.PIXI.Graphics();
    bumperFxG.blendMode = 'add';
    worldContainer.addChild(bumperFxG);
    this.bumperFxG = bumperFxG;
    this.bumperFx = [];
    this.lastBumperFxAtMs = 0;
    const addBumper = (x: number, y: number, r: number) => {
      const isMega = r >= 34;
      const cd = this.R.ColliderDesc.ball(r).setTranslation(x, y).setRestitution(0.78).setFriction(0.04);
      world.createCollider(cd, staticBody);
      const sensor = this.R.ColliderDesc.ball(r + 26)
        .setTranslation(x, y)
        .setSensor(true)
        .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
      const sensorCol = world.createCollider(sensor, staticBody);
      this.sensorKindByHandle.set(sensorCol.handle, 'kicker');
      this.kickerByHandle.set(sensorCol.handle, {
        x,
        y,
        power: isMega ? 5200 + r * 18 : 4600 + r * 16,
        mode: 'radialOut',
        playSfx: true,
        cooldownMs: isMega ? ms('140ms') : ms('170ms'),
        radius: r,
        fxKind: isMega ? 'mega' : 'bumper',
      });
      const c = isMega ? 0xfacc15 : 0xf97316;
      bumpersG
        .circle(x, y, r + 10)
        .fill({ color: c, alpha: isMega ? 0.1 : 0.08 })
        .circle(x, y, r)
        .fill({ color: c, alpha: isMega ? 0.26 : 0.18 })
        .circle(x, y, r)
        .stroke({ color: c, width: 2, alpha: isMega ? 0.62 : 0.45 });
    };
    addBumper(300, 520, 28);
    addBumper(980, 660, 28);
    addBumper(640, 980, 34);
    addBumper(360, 1520, 28);
    addBumper(920, 1680, 28);
    addBumper(640, 6100, 30);

    // Extra mid bumpers to keep the ball "in play" (avoids getting stuck in pockets)
    // Keep them away from the 30° staircase walls (avoid overlapping colliders).
    addBumper(640, 3000, 28);
    addBumper(560, 3300, 26);
    addBumper(640, 3920, 34);
    addBumper(360, 4700, 28);
    addBumper(920, 4880, 28);

    // Moving obstacles (도파민용) - 회전/슬라이더
    const obstacleStroke = { color: 0x0b0b0c, width: 2, alpha: 0.55 } as const;
    const addRotor = (args: {
      x: number;
      y: number;
      halfW: number;
      halfH: number;
      speed: number;
      phase: number;
      startAfterMs?: number | undefined;
      baseAngle?: number | undefined;
      angleAmplitude?: number | undefined;
    }) => {
      const rb = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(args.x, args.y);
      const body = world.createRigidBody(rb);
      // Big bounce obstacle: high restitution for pinball-like dopamine.
      const cd = this.R.ColliderDesc.cuboid(args.halfW, args.halfH).setFriction(0.08).setRestitution(0.86);
      const collider = world.createCollider(cd, body);

      const display = new this.PIXI.Container();
      display.position.set(args.x, args.y);
      const g = new this.PIXI.Graphics()
        .roundRect(-args.halfW, -args.halfH, args.halfW * 2, args.halfH * 2, args.halfH)
        .fill({ color: 0xf97316, alpha: 0.22 })
        .stroke(obstacleStroke);
      display.addChild(g);
      worldContainer.addChild(display);

      this.obstacles.push({
        body,
        collider,
        display,
        kind: 'rotor',
        baseX: args.x,
        baseY: args.y,
        halfW: args.halfW,
        halfH: args.halfH,
        phase: args.phase,
        speed: args.speed,
        amplitude: 0,
        startAfterMs: args.startAfterMs,
        baseAngle: args.baseAngle ?? Math.PI / 4,
        angleAmplitude: args.angleAmplitude ?? 0.6,
      });
    };

    const addSlider = (args: {
      x: number;
      y: number;
      halfW: number;
      halfH: number;
      amplitude: number;
      speed: number;
      phase: number;
      startAfterMs?: number | undefined;
      baseAngle?: number | undefined;
    }) => {
      const rb = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(args.x, args.y);
      const body = world.createRigidBody(rb);
      // Big bounce obstacle: high restitution for pinball-like dopamine.
      const cd = this.R.ColliderDesc.cuboid(args.halfW, args.halfH).setFriction(0.1).setRestitution(0.72);
      const collider = world.createCollider(cd, body);

      const display = new this.PIXI.Container();
      display.position.set(args.x, args.y);
      const g = new this.PIXI.Graphics()
        .roundRect(-args.halfW, -args.halfH, args.halfW * 2, args.halfH * 2, Math.min(args.halfW, args.halfH))
        .fill({ color: 0x22d3ee, alpha: 0.18 })
        .stroke(obstacleStroke);
      display.addChild(g);
      worldContainer.addChild(display);

      this.obstacles.push({
        body,
        collider,
        display,
        kind: 'slider',
        baseX: args.x,
        baseY: args.y,
        halfW: args.halfW,
        halfH: args.halfH,
        phase: args.phase,
        speed: args.speed,
        amplitude: args.amplitude,
        startAfterMs: args.startAfterMs,
        baseAngle: 0,
        angleAmplitude: 0,
      });
    };

    // Timed gates (keeps early finishes from happening)
    addSlider({
      x: 640,
      y: gate1Y,
      halfW: 120,
      halfH: 14,
      amplitude: 420,
      speed: 1.6,
      phase: 0.0,
      startAfterMs: ms('10s'),
    });
    addSlider({
      x: 640,
      y: gate2Y,
      halfW: 80,
      halfH: 14,
      amplitude: 480,
      speed: 1.2,
      phase: 1.1,
      startAfterMs: ms('28s'),
    });

    addRotor({ x: 640, y: 3600, halfW: 190, halfH: 10, speed: 2.6, phase: 0.2, baseAngle: 0.82, angleAmplitude: 0.55 });
    addSlider({ x: 640, y: 4400, halfW: 190, halfH: 14, amplitude: 240, speed: 1.8, phase: 1.2 });

    // Mid-to-final: minimize static walls, use moving obstacles to avoid dead valleys.
    addRotor({ x: 420, y: 5600, halfW: 180, halfH: 10, speed: 3.0, phase: 0.5, baseAngle: 0.9, angleAmplitude: 0.55 });
    addRotor({ x: 860, y: 5850, halfW: 180, halfH: 10, speed: 2.8, phase: 1.1, baseAngle: 0.9, angleAmplitude: 0.55 });
    addSlider({ x: 640, y: 6500, halfW: 220, halfH: 14, amplitude: 340, speed: 1.4, phase: 0.7 });
    addRotor({ x: 640, y: 7200, halfW: 240, halfH: 10, speed: 3.4, phase: 0.2, baseAngle: 0.88, angleAmplitude: 0.55 });
    addSlider({ x: 640, y: 7800, halfW: 240, halfH: 14, amplitude: 420, speed: 1.1, phase: 1.6 });

    addBumper(340, 7000, 28);
    addBumper(940, 7120, 28);
    addBumper(640, 7600, 34);
    addBumper(420, 8200, 28);
    addBumper(860, 8320, 28);

    // Final section (NO V valley + NO out-of-bounds falls)
    // Instead of a V-shaped mouth, keep it open and use a horizontal sweeper + safety floor.
    addRotor({ x: CUP_X, y: CUP_Y - 240, halfW: 220, halfH: 10, speed: 4.0, phase: 0.9, baseAngle: 0.0, angleAmplitude: 0.0 });

    // Sweeper: pushes marbles toward the cup without creating pockets (horizontal movement is OK).
    addSlider({ x: CUP_X, y: CUP_Y - 320, halfW: 260, halfH: 12, amplitude: 520, speed: 1.35, phase: 0.4 });

    // Safety catcher floor: prevents any marble from falling out of the world (no 낙사).
    // Slight tilt only (still "not perfectly horizontal").
    const floorYLeft = WORLD_H - 36;
    const floorYRight = WORLD_H - 60;
    addWall(96, floorYLeft, 1184, floorYRight, { friction: 0.05, restitution: 0.1 });
    // Corner guides into the floor so edges can't leak
    addWall(80, CUP_Y - 520, 96, floorYLeft, { friction: 0.05, restitution: 0.1 });
    addWall(1200, CUP_Y - 560, 1184, floorYRight, { friction: 0.05, restitution: 0.1 });

    // Checkpoint lines (visual only)
    for (const y of this.checkpointsY) {
      // 절대 수평선 금지 -> 살짝 기울여요
      mapLines.moveTo(140, y - 6).lineTo(1140, y + 6).stroke({ color: 0x1f2937, width: 2, cap: 'round' });
    }

    // Warp zones (하위 30%만 발동) - 중후반 역전
    const warpZones = [
      { x: 360, y: 6100, halfW: 90, halfH: 18 },
      { x: 920, y: 6400, halfW: 90, halfH: 18 },
    ] as const;
    const warpG = new this.PIXI.Graphics();
    worldContainer.addChild(warpG);
    for (const z of warpZones) {
      const cd = this.R.ColliderDesc.cuboid(z.halfW, z.halfH)
        .setTranslation(z.x, z.y)
        .setSensor(true)
        .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
      const col = world.createCollider(cd, staticBody);
      this.sensorKindByHandle.set(col.handle, 'warp');
      warpG
        .roundRect(z.x - z.halfW, z.y - z.halfH, z.halfW * 2, z.halfH * 2, 10)
        .fill({ color: 0x7c3aed, alpha: 0.14 })
        .stroke({ color: 0x7c3aed, width: 2, alpha: 0.55 });
    }

    // Speed pad (하위 30% 가속 / 상위 10% 감속)
    const boost = { x: 640, y: 8420, halfW: 100, halfH: 16 } as const;
    const boostCd = this.R.ColliderDesc.cuboid(boost.halfW, boost.halfH)
      .setTranslation(boost.x, boost.y)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
    const boostCol = world.createCollider(boostCd, staticBody);
    this.sensorKindByHandle.set(boostCol.handle, 'boost');
    const boostG = new this.PIXI.Graphics()
      .roundRect(boost.x - boost.halfW, boost.y - boost.halfH, boost.halfW * 2, boost.halfH * 2, 10)
      .fill({ color: 0x22d3ee, alpha: 0.12 })
      .stroke({ color: 0x22d3ee, width: 2, alpha: 0.55 });
    worldContainer.addChild(boostG);

    // Cup "hole" sensor near bottom
    const cupX = CUP_X;
    const cupY = CUP_Y;
    const cupR = 96;
    const cupSensor = this.R.ColliderDesc.ball(cupR)
      .setTranslation(cupX, cupY)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
    const cupCol = world.createCollider(cupSensor, staticBody);
    this.sensorKindByHandle.set(cupCol.handle, 'cup');

    const cupG = new this.PIXI.Graphics()
      .circle(cupX, cupY, cupR + 10)
      .fill({ color: 0x09090b })
      .circle(cupX, cupY, cupR + 10)
      .stroke({ color: 0x3f3f46, width: 3 })
      .circle(cupX, cupY, cupR)
      .fill({ color: 0x000000 })
      .circle(cupX, cupY, cupR)
      .stroke({ color: 0x111827, width: 2 });
    worldContainer.addChild(cupG);
  }

  private spawnMarbles(participants: Participant[]) {
    if (!this.world || !this.staticBody || !this.worldContainer || !this.textures) return;

    const spawn = computeSpawnPositions(participants.length);

    for (let i = 0; i < participants.length; i += 1) {
      const p = participants[i];
      const pos = spawn[i] ?? { x: WORLD_W / 2, y: 60 };
      const rb = this.R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setLinearDamping(0.32)
        .setAngularDamping(0.22);
      const body = this.world.createRigidBody(rb);

      const col = this.R.ColliderDesc.ball(MARBLE_R).setFriction(0.12).setRestitution(0.26).setDensity(0.9);
      const collider = this.world.createCollider(col, body);

      const display = new this.PIXI.Container();
      display.x = pos.x;
      display.y = pos.y;

      const ball = new this.PIXI.Sprite(this.textures.ball);
      ball.anchor.set(0.5);
      ball.tint = hexToPixiTint(p.colorHex);

      const ring = new this.PIXI.Sprite(this.textures.ring);
      ring.anchor.set(0.5);
      ring.tint = 0xffffff;
      ring.alpha = 0.6;
      ring.visible = false;
      ring.blendMode = 'add';

      display.addChild(ring, ball);
      this.worldContainer.addChild(display);

      const m: MarbleRuntime = {
        participant: p,
        body,
        collider,
        display,
        ball,
        ring,
        progressY: pos.y,
        lastProgressY: pos.y,
        lastY: pos.y,
        jetMask: 0,
        bumpedAtMs: 0,
        lastMovedAtMs: performance.now(),
        stuckCooldownUntilMs: 0,
        isEliminated: false,
        warpUsed: false,
        boostCooldownUntilMs: 0,
        kickerCooldownUntilMs: 0,
      };
      this.marbles.push(m);
      this.marblesByCollider.set(collider.handle, m);
    }
  }
}
