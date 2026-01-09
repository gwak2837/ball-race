import ms from 'ms'

import type * as RAPIER from '@dimforge/rapier2d-compat'
import type * as PIXI from 'pixi.js'

import type { Participant } from './participants'
import type { MarblesSfx } from './sfx'
import { CAMERA_Y_ANCHOR, VIEW_H, VIEW_W } from './view'

export type MarblesPhase = 'idle' | 'running' | 'finished'

export interface LeaderRow {
  rank: number
  id: string
  name: string
  colorHex: string
  progressY: number
  didFinish: boolean
  isHighlighted: boolean
  isFocusTarget: boolean
}

export interface MarblesUiSnapshot {
  phase: MarblesPhase
  elapsedMs: number
  totalCount: number
  aliveCount: number
  finishedCount: number
  eliminatedCount: number
  eliminatedBy?: { fall: number; cut: number } | undefined
  top10: LeaderRow[]
  camera?: { x: number; y: number } | undefined
  world?: { w: number; h: number; screenW: number; screenH: number } | undefined
  cut?: { checkpointNumber: number; remainingMs: number; cutCount: number } | undefined
  slowMo?: { remainingMs: number } | undefined
  fastForward?: { scale: number } | undefined
  focus?: { name: string; remainingMs: number } | undefined
  postFinish?: { remainingMs: number } | undefined
  winner?: { id: string; name: string; colorHex: string } | undefined
  winnerToast?: { remainingMs: number } | undefined
}

type UiCallback = (snap: MarblesUiSnapshot) => void

interface MarblesGameDeps {
  PIXI: typeof import('pixi.js')
  R: typeof import('@dimforge/rapier2d-compat')
  app: PIXI.Application
}

interface StartOptions {
  participants: Participant[]
  highlightName: string
  onUi: UiCallback
  sfx?: MarblesSfx | null | undefined
  gravityY?: number | undefined
  minRoundMs?: number | undefined
}

interface MarbleRuntime {
  participant: Participant
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  display: PIXI.Container
  ball: PIXI.Sprite
  ring: PIXI.Sprite
  label?: PIXI.Text | undefined
  nameTag?: { wrap: PIXI.Container; bg: PIXI.Graphics; text: PIXI.Text } | undefined
  progressY: number
  lastProgressY: number
  lastY: number
  jetMask: number
  jetCooldownUntilMs: number
  bumpedAtMs: number
  lastMovedAtMs: number
  stuckCooldownUntilMs: number
  rescueCount: number
  rescueCooldownUntilMs: number
  isEliminated: boolean
  eliminatedAtMs?: number | undefined
  warpUsed: boolean
  boostCooldownUntilMs: number
  kickerCooldownUntilMs: number
  magnetUntilMs: number
  magnetX: number
  magnetY: number
}

interface CameraState {
  x: number
  y: number
  mode: 'auto' | 'focus' | 'manual'
  focusUntilMs: number
  focusId: string | null
  focusName: string | null
  manualUntilMs: number
  peekUntilMs: number
  peekReturn: {
    mode: 'auto' | 'focus' | 'manual'
    x: number
    y: number
    focusUntilMs: number
    focusId: string | null
    focusName: string | null
    manualUntilMs: number
  } | null
  shakeUntilMs: number
  shakeAmp: number
}

type SensorKind = 'cup' | 'warp' | 'boost' | 'slow' | 'magnet' | 'bomb' | 'kicker'

interface KinematicObstacle {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  display: PIXI.Container
  kind: 'rotor' | 'slider'
  baseX: number
  baseY: number
  halfW: number
  halfH: number
  phase: number
  speed: number
  amplitude: number
  startAfterMs?: number | undefined
  baseAngle: number
  angleAmplitude: number
}

interface JetBand {
  y: number
  activeUntilMs: number
  upVel: number
}

interface CupEntry {
  id: string
  name: string
  colorHex: string
  atMs: number
}

const SCREEN_W = VIEW_W
const SCREEN_H = VIEW_H
const WORLD_W = 1280
const WORLD_H = 9200
const CUP_X = WORLD_W / 2
const CUP_Y = WORLD_H - 120

const DEFAULT_GRAVITY_Y = 1000
const DEFAULT_MIN_ROUND_MS = ms('60s')

const POST_FINISH_MS = ms('10s')
const POST_FINISH_RUN_MS = ms('10s')

const TOP10_FINISHERS_TARGET = 10
const FAST_FORWARD_SCALE = 2

const MARBLE_R = 7
const WALL_THICK = 40

const UI_EMIT_EVERY_MS = ms('100ms')
const FIXED_STEP_MS = ms('16.666ms')
const OUT_OF_BOUNDS_Y = WORLD_H + 400
const OUT_OF_BOUNDS_X_PAD = 160

const JET_JACKPOT_PASS_CHANCE = 0.05

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function hexToPixiTint(hex: string): number {
  const v = hex.replace('#', '')
  return Number.parseInt(v, 16)
}

function srgbToLinear01(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '')
  if (v.length !== 6) return 1
  const n = Number.parseInt(v, 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const rl = srgbToLinear01(r)
  const gl = srgbToLinear01(g)
  const bl = srgbToLinear01(b)
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

function labelColorsForBall(hex: string): { fill: number; stroke: number } {
  const lum = relativeLuminance(hex)
  // Palette is mid-light, but some hues still get dark enough that black text becomes hard to read.
  if (lum < 0.42) {
    return { fill: 0xffffff, stroke: 0x0a0a0a }
  }
  return { fill: 0x0a0a0a, stroke: 0xffffff }
}

function maybeCreateLabel({ PIXI, marble }: { PIXI: typeof import('pixi.js'); marble: MarbleRuntime }): PIXI.Text {
  if (marble.label) {
    return marble.label
  }
  const c = labelColorsForBall(marble.participant.colorHex)
  const t = new PIXI.Text({
    text: marble.participant.initials,
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 24,
      fontWeight: '700',
      fill: c.fill,
      stroke: { color: c.stroke, width: 3, join: 'round' },
      align: 'center',
    },
  })
  t.anchor.set(0.5)
  // NOTE: 기본 라벨(이니셜)은 공 "상단"에 보여줘요.
  // 전체 닉네임 태그(강조/포커스)와 겹치지 않도록 적당히 아래로 붙여요.
  t.y = -(MARBLE_R + 16)
  marble.display.addChild(t)
  marble.label = t
  return t
}

function maybeCreateNameTag({ PIXI, marble }: { PIXI: typeof import('pixi.js'); marble: MarbleRuntime }) {
  if (marble.nameTag) {
    return marble.nameTag
  }

  const wrap = new PIXI.Container()
  wrap.y = -(MARBLE_R + 18)

  const bg = new PIXI.Graphics()
  const text = new PIXI.Text({
    text: marble.participant.name,
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 24,
      fontWeight: '600',
      fill: 0xffffff,
      align: 'center',
    },
  })
  text.anchor.set(0.5)

  const padX = 8
  const padY = 4
  const radius = 10
  const w = Math.max(24, Math.ceil(text.width))
  const h = Math.max(16, Math.ceil(text.height))
  const gap = 6
  wrap.y = -(MARBLE_R + gap + (h / 2 + padY))
  bg.roundRect(-(w / 2) - padX, -(h / 2) - padY, w + padX * 2, h + padY * 2, radius)
    .fill({ color: 0x000000, alpha: 0.55 })
    .stroke({ color: 0xffffff, width: 1, alpha: 0.14 })

  wrap.addChild(bg, text)
  marble.display.addChild(wrap)
  marble.nameTag = { wrap, bg, text }
  return marble.nameTag
}

function computeSpawnPositions(count: number): Array<{ x: number; y: number }> {
  const spawnW = 880
  const spacing = MARBLE_R * 2.4
  const cols = Math.max(1, Math.floor(spawnW / spacing))
  const startX = (WORLD_W - spawnW) / 2
  const startY = 40
  const out: Array<{ x: number; y: number }> = []
  const rows = Math.max(1, Math.ceil(count / cols))
  for (let row = 0; row < rows; row += 1) {
    // Per-row offset to avoid "perfect columns" and reduce straight-drop starts.
    const rowShift = (Math.random() * 2 - 1) * 32
    for (let col = 0; col < cols; col += 1) {
      if (out.length >= count) break
      const x0 = startX + (col + 0.5) * spacing + rowShift
      const x = clamp(x0, startX + MARBLE_R, startX + spawnW - MARBLE_R)
      const y = startY + (row + 0.5) * spacing * 0.9
      out.push({ x, y })
    }
  }
  // Shuffle so participants don't always map to the same region.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

export class MarblesGame {
  private readonly PIXI: typeof import('pixi.js')
  private readonly R: typeof import('@dimforge/rapier2d-compat')
  private readonly app: PIXI.Application

  private phase: MarblesPhase = 'idle'
  private onUi: UiCallback | null = null

  private worldContainer: PIXI.Container | null = null
  private world: RAPIER.World | null = null
  private eventQueue: RAPIER.EventQueue | null = null
  private staticBody: RAPIER.RigidBody | null = null
  private sensorKindByHandle = new Map<number, SensorKind>()
  private kickerByHandle = new Map<
    number,
    {
      x: number
      y: number
      power: number
      mode: 'radialOut' | 'towardCenter'
      activeUntilMs?: number | undefined
      playSfx: boolean
      cooldownMs?: number | undefined
      radius?: number | undefined
      fxKind?: 'jet' | 'bumper' | 'mega' | undefined
    }
  >()

  private readonly checkpointsY = [2800, 6400] as const
  private checkpointIndex = 0
  private cutState: { checkpointNumber: number; endsAtMs: number; cutCount: number } | null = null

  private bottom30MaxProgress = Number.NEGATIVE_INFINITY
  private top10MinProgress = Number.POSITIVE_INFINITY
  private top30MinProgress = Number.POSITIVE_INFINITY

  private timeScale = 1
  private slowMoUntilMs = 0
  private slowMoCooldownUntilMs = 0
  private fastForwardOn = false

  private finishState: { winnerId: string; postEndsAtMs: number; stopAtMs: number } | null = null
  private winner: { id: string; name: string; colorHex: string } | null = null
  private winnerToastUntilMs = 0
  private eliminatedBy = { fall: 0, cut: 0 }
  private minRoundEndsAtMs = 0

  private textures: {
    ball: PIXI.Texture
    ring: PIXI.Texture
  } | null = null

  private obstacles: KinematicObstacle[] = []
  private jetBands: JetBand[] = []
  private cupEntries: CupEntry[] = []
  private cupEntryById = new Map<string, CupEntry>()
  private magnetByHandle = new Map<
    number,
    { x: number; y: number; pullY: number; radius: number; durationMs: number; cooldownMs: number; lastAtMs: number }
  >()
  private bombByHandle = new Map<
    number,
    { x: number; y: number; radius: number; power: number; cooldownMs: number; lastAtMs: number }
  >()
  private slowByHandle = new Map<
    number,
    { x: number; y: number; halfW: number; halfH: number; factor: number; cooldownMs: number; lastAtMs: number }
  >()
  private bumperFxG: PIXI.Graphics | null = null
  private bumperFx: Array<{ x: number; y: number; r: number; atMs: number; kind: 'normal' | 'mega' }> = []
  private lastBumperFxAtMs = 0
  private lastBumperShakeAtMs = 0

  private marbles: MarbleRuntime[] = []
  private marblesByCollider = new Map<number, MarbleRuntime>()

  private startedAtMs = 0
  private elapsedMs = 0
  private accumulatorMs = 0
  private lastTickMs = 0
  private lastUiEmitMs = 0

  private highlightName = ''
  private sfx: MarblesSfx | null = null
  private lastClickAtMs = 0
  private lastEventSfxAtMs = 0
  private sfxTargetId: string | null = null
  private sfxCollisionTargetHandle: number | null = null
  private camera: CameraState = {
    x: 0,
    y: 0,
    mode: 'auto',
    focusUntilMs: 0,
    focusId: null,
    focusName: null,
    manualUntilMs: 0,
    peekUntilMs: 0,
    peekReturn: null,
    shakeUntilMs: 0,
    shakeAmp: 0,
  }

  constructor(deps: MarblesGameDeps) {
    this.PIXI = deps.PIXI
    this.R = deps.R
    this.app = deps.app
  }

  start(opts: StartOptions) {
    this.destroy()

    this.phase = 'running'
    this.onUi = opts.onUi
    this.highlightName = opts.highlightName.trim()
    this.sfx = opts.sfx ?? null
    this.lastClickAtMs = 0
    this.lastEventSfxAtMs = 0
    this.sfxTargetId = null
    this.sfxCollisionTargetHandle = null
    this.finishState = null
    this.winner = null
    this.winnerToastUntilMs = 0
    this.cupEntries = []
    this.cupEntryById.clear()
    this.eliminatedBy = { fall: 0, cut: 0 }
    this.startedAtMs = performance.now()
    const minRoundMs =
      typeof opts.minRoundMs === 'number' && Number.isFinite(opts.minRoundMs) ? opts.minRoundMs : DEFAULT_MIN_ROUND_MS
    this.minRoundEndsAtMs = this.startedAtMs + clamp(minRoundMs, ms('5s'), ms('10m'))
    this.elapsedMs = 0
    this.accumulatorMs = 0
    this.lastTickMs = performance.now()
    this.lastUiEmitMs = 0

    const gravityY =
      typeof opts.gravityY === 'number' && Number.isFinite(opts.gravityY) ? opts.gravityY : DEFAULT_GRAVITY_Y
    const world = new this.R.World({ x: 0, y: Math.max(200, gravityY) })
    this.world = world
    this.eventQueue = new this.R.EventQueue(true)

    // One static body as an anchor for all static colliders (walls/pins/sensors).
    this.staticBody = world.createRigidBody(this.R.RigidBodyDesc.fixed())

    // Pixi world container
    const worldContainer = new this.PIXI.Container()
    this.worldContainer = worldContainer
    this.app.stage.removeChildren()
    this.app.stage.addChild(worldContainer)

    this.textures = this.createTextures()

    this.sensorKindByHandle.clear()
    this.kickerByHandle.clear()
    this.magnetByHandle.clear()
    this.bombByHandle.clear()
    this.slowByHandle.clear()
    this.checkpointIndex = 0
    this.cutState = null
    this.timeScale = 1
    this.slowMoUntilMs = 0
    this.slowMoCooldownUntilMs = 0
    this.fastForwardOn = false
    this.bottom30MaxProgress = Number.NEGATIVE_INFINITY
    this.top10MinProgress = Number.POSITIVE_INFINITY
    this.top30MinProgress = Number.POSITIVE_INFINITY

    this.buildMap()
    this.spawnMarbles(opts.participants)

    this.emitUi(true)

    this.app.ticker.add(this.onTick)
  }

  destroy() {
    this.app.ticker.remove(this.onTick)
    this.phase = 'idle'
    this.onUi = null
    this.sfx = null
    this.lastClickAtMs = 0
    this.lastEventSfxAtMs = 0
    this.sfxTargetId = null
    this.sfxCollisionTargetHandle = null
    this.finishState = null
    this.winner = null
    this.winnerToastUntilMs = 0
    this.cupEntries = []
    this.cupEntryById.clear()
    this.eliminatedBy = { fall: 0, cut: 0 }
    this.minRoundEndsAtMs = 0
    this.world?.free?.()
    this.world = null
    this.eventQueue = null
    this.staticBody = null
    this.sensorKindByHandle.clear()
    this.kickerByHandle.clear()
    this.magnetByHandle.clear()
    this.bombByHandle.clear()
    this.slowByHandle.clear()
    this.checkpointIndex = 0
    this.cutState = null
    this.timeScale = 1
    this.slowMoUntilMs = 0
    this.slowMoCooldownUntilMs = 0
    this.fastForwardOn = false
    this.bottom30MaxProgress = Number.NEGATIVE_INFINITY
    this.top10MinProgress = Number.POSITIVE_INFINITY
    this.top30MinProgress = Number.POSITIVE_INFINITY

    this.marblesByCollider.clear()
    this.marbles = []
    this.obstacles = []
    this.jetBands = []
    this.bumperFxG = null
    this.bumperFx = []
    this.lastBumperFxAtMs = 0
    this.lastBumperShakeAtMs = 0
    this.camera = {
      x: 0,
      y: 0,
      mode: 'auto',
      focusUntilMs: 0,
      focusId: null,
      focusName: null,
      manualUntilMs: 0,
      peekUntilMs: 0,
      peekReturn: null,
      shakeUntilMs: 0,
      shakeAmp: 0,
    }

    this.worldContainer?.destroy({ children: true })
    this.worldContainer = null
  }

  setHighlightName(name: string) {
    this.highlightName = name.trim()
  }

  setSfx(sfx: MarblesSfx | null) {
    this.sfx = sfx
    this.lastClickAtMs = 0
    this.lastEventSfxAtMs = 0
    if (!sfx) {
      this.clearSfxCollisionTarget()
    }
  }

  panCameraBy(dx: number, dy: number) {
    if (!this.worldContainer) return
    const now = performance.now()
    this.camera.mode = 'manual'
    this.camera.focusId = null
    this.camera.focusName = null
    this.camera.focusUntilMs = 0
    this.camera.peekUntilMs = 0
    this.camera.peekReturn = null
    this.camera.manualUntilMs = now + ms('3s')
    this.camera.x = clamp(this.camera.x + dx, 0, WORLD_W - SCREEN_W)
    this.camera.y = clamp(this.camera.y + dy, 0, WORLD_H - SCREEN_H)
    this.worldContainer.x = -this.camera.x
    this.worldContainer.y = -this.camera.y
  }

  focusByName(name: string, durationMs = ms('4s')): boolean {
    const trimmed = name.trim()
    if (!trimmed) return false
    const exact = this.marbles.find((m) => !m.isEliminated && m.participant.name === trimmed)
    const partial = exact ?? this.marbles.find((m) => !m.isEliminated && m.participant.name.includes(trimmed))
    const target = partial
    if (!target) return false
    this.camera.peekUntilMs = 0
    this.camera.peekReturn = null
    this.camera.mode = 'focus'
    this.camera.focusId = target.participant.id
    this.camera.focusName = target.participant.name
    this.camera.focusUntilMs = performance.now() + durationMs
    this.camera.shakeUntilMs = performance.now() + ms('200ms')
    this.camera.shakeAmp = 5
    return true
  }

  jumpCameraTo(x: number, y: number, durationMs = ms('4s')) {
    if (!this.worldContainer) return
    const now = performance.now()
    // Save the current camera state so we can return after the minimap peek.
    this.camera.peekUntilMs = now + durationMs
    this.camera.peekReturn = {
      mode: this.camera.mode,
      x: this.camera.x,
      y: this.camera.y,
      focusUntilMs: this.camera.focusUntilMs,
      focusId: this.camera.focusId,
      focusName: this.camera.focusName,
      manualUntilMs: this.camera.manualUntilMs,
    }
    this.camera.mode = 'manual'
    this.camera.focusId = null
    this.camera.focusName = null
    this.camera.focusUntilMs = 0
    this.camera.manualUntilMs = now + durationMs
    this.camera.x = clamp(x, 0, WORLD_W - SCREEN_W)
    this.camera.y = clamp(y, 0, WORLD_H - SCREEN_H)
    this.worldContainer.x = -this.camera.x
    this.worldContainer.y = -this.camera.y
  }

  private isInCameraView(x: number, y: number, pad = 0): boolean {
    const x0 = this.camera.x - pad
    const y0 = this.camera.y - pad
    const x1 = this.camera.x + SCREEN_W + pad
    const y1 = this.camera.y + SCREEN_H + pad
    return x >= x0 && x <= x1 && y >= y0 && y <= y1
  }

  private readonly onTick = () => {
    if (!this.world || !this.eventQueue || !this.worldContainer) return

    const now = performance.now()
    if (this.phase !== 'running') return

    const frameMs = clamp(now - this.lastTickMs, 0, ms('50ms'))
    this.lastTickMs = now
    this.accumulatorMs += frameMs

    while (this.accumulatorMs >= FIXED_STEP_MS && this.phase === 'running') {
      this.stepOnce(now)
      this.accumulatorMs -= FIXED_STEP_MS
      this.elapsedMs += FIXED_STEP_MS
    }

    if (this.phase !== 'running') {
      // Round may end inside the physics step (e.g. cup entry after min time).
      return
    }

    this.updateCamera(now)
    this.render(now)
    this.emitUi(false)

    if (this.finishState) {
      if (now >= this.finishState.stopAtMs) {
        this.endRound(now)
      }
      return
    }

    // Finish trigger: run at least minRoundMs, then start a 10s "post-finish run"
    // as soon as we have at least one finisher.
    // (If nobody finished by minRoundMs, keep running until the first cup entry.)
    if (now >= this.minRoundEndsAtMs && this.cupEntries.length > 0) {
      this.beginFinishSequence(now)
    }
  }

  private clearSfxCollisionTarget() {
    const h = this.sfxCollisionTargetHandle
    if (h) {
      const prev = this.marblesByCollider.get(h)
      // NOTE: If the collider is already removed, it's not in the map anymore (safe).
      if (prev) prev.collider.setActiveEvents(0)
    }
    this.sfxCollisionTargetHandle = null
    this.sfxTargetId = null
  }

  private pickSfxTargetMarble(): MarbleRuntime | null {
    const alive = this.marbles.filter((m) => !m.isEliminated)
    if (alive.length === 0) return null

    // Explicit focus beats everything.
    if (this.camera.mode === 'focus' && this.camera.focusId) {
      return alive.find((m) => m.participant.id === this.camera.focusId) ?? null
    }

    // Manual camera: pick the marble closest to the view center (only if actually in view).
    if (this.camera.mode === 'manual') {
      const cx = this.camera.x + SCREEN_W / 2
      const cy = this.camera.y + SCREEN_H * CAMERA_Y_ANCHOR
      let best: MarbleRuntime | null = null
      let bestD2 = Number.POSITIVE_INFINITY
      for (const m of alive) {
        const p = m.body.translation()
        if (!this.isInCameraView(p.x, p.y, 0)) continue
        const dx = p.x - cx
        const dy = p.y - cy
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) {
          bestD2 = d2
          best = m
        }
      }
      return best
    }

    // Auto camera follows the leader — match SFX to the same target.
    let best: MarbleRuntime | null = null
    for (const m of alive) {
      if (!best || m.progressY > best.progressY) best = m
    }
    return best
  }

  private updateSfxCollisionTarget() {
    // Sound disabled: don't subscribe to collision events (keeps the event queue light).
    if (!this.sfx || this.phase !== 'running') {
      if (this.sfxCollisionTargetHandle || this.sfxTargetId) {
        this.clearSfxCollisionTarget()
      }
      return
    }

    const target = this.pickSfxTargetMarble()
    const nextId = target?.participant.id ?? null
    const nextHandle = target?.collider.handle ?? null

    this.sfxTargetId = nextId

    if (!nextHandle) {
      this.clearSfxCollisionTarget()
      return
    }

    if (this.sfxCollisionTargetHandle === nextHandle) {
      return
    }

    if (this.sfxCollisionTargetHandle) {
      const prev = this.marblesByCollider.get(this.sfxCollisionTargetHandle)
      if (prev) prev.collider.setActiveEvents(0)
    }

    this.sfxCollisionTargetHandle = nextHandle
    target?.collider.setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
  }

  private maybePlayImpactClick(m: MarbleRuntime, nowMs: number) {
    const sfx = this.sfx
    if (!sfx) return

    const v = m.body.linvel()
    const speed = Math.hypot(v.x, v.y)
    const intensity = clamp((speed - 520) / 3400, 0, 1)
    if (intensity < 0.12) return

    const elapsedMs = nowMs - this.startedAtMs
    const minInterval = elapsedMs < ms('10s') ? ms('140ms') : ms('80ms')
    if (nowMs - this.lastClickAtMs < minInterval) return

    this.lastClickAtMs = nowMs
    sfx.playClick(intensity)
  }

  private stepOnce(nowMs: number) {
    if (!this.world || !this.eventQueue) return

    if (this.timeScale < 1 && nowMs >= this.slowMoUntilMs) {
      this.timeScale = 1
    }

    this.updateObstacles(nowMs)
    this.updateSfxCollisionTarget()

    // Rapier uses an internal dt; most builds expose `timestep`.
    this.world.timestep = (FIXED_STEP_MS / 1000) * this.timeScale

    this.world.step(this.eventQueue)

    // Sensors: cup / warp / boost
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return
      const k1 = this.sensorKindByHandle.get(h1)
      const k2 = this.sensorKindByHandle.get(h2)
      if (k1 && !k2) {
        const m = this.marblesByCollider.get(h2)
        if (m) this.onSensor(k1, h1, m, nowMs)
      } else if (k2 && !k1) {
        const m = this.marblesByCollider.get(h1)
        if (m) this.onSensor(k2, h2, m, nowMs)
      }

      // Collision SFX: only for the current camera target marble.
      const targetHandle = this.sfxCollisionTargetHandle
      if (!targetHandle) return
      const isTarget1 = h1 === targetHandle
      const isTarget2 = h2 === targetHandle
      if (!isTarget1 && !isTarget2) return
      const other = isTarget1 ? h2 : h1
      // Ignore sensor events (those have dedicated sounds).
      if (this.sensorKindByHandle.has(other)) return
      // Ignore marble-to-marble collisions (too noisy; not requested).
      if (this.marblesByCollider.has(other)) return
      const target = this.marblesByCollider.get(targetHandle)
      if (!target || target.isEliminated) return
      this.maybePlayImpactClick(target, nowMs)
    })

    let aliveCount = 0
    let leaderProgress = Number.NEGATIVE_INFINITY
    let top1: MarbleRuntime | null = null
    let top2: MarbleRuntime | null = null
    let top3: MarbleRuntime | null = null

    const elapsedMs = nowMs - this.startedAtMs

    // Update progress + eliminate out-of-bounds
    for (const m of this.marbles) {
      if (m.isEliminated) continue
      const prevY = m.lastY
      const p = m.body.translation()
      const x = p.x
      let y = p.y

      // Jet bands (anti-speedrun) — per-marble gating.
      // Band #1: always bounces once, then you pass.
      // Band #2/#3: 5% "jackpot pass" (no bounce). Otherwise you get denied (bounce) and must retry.
      if (this.phase === 'running' && this.jetBands.length > 0 && y > prevY && nowMs >= m.jetCooldownUntilMs) {
        for (let i = 0; i < this.jetBands.length; i += 1) {
          const band = this.jetBands[i]
          if (elapsedMs >= band.activeUntilMs) continue
          const mask = 1 << i
          if ((m.jetMask & mask) !== 0) continue
          if (prevY < band.y && y >= band.y) {
            const isFirstBand = i === 0
            const jackpotPass = !isFirstBand && Math.random() < JET_JACKPOT_PASS_CHANCE
            if (jackpotPass) {
              m.jetMask |= mask
              // Pass through with a little sideways randomness (prevents a single "clean lane").
              const v0 = m.body.linvel()
              const nudge = (Math.random() * 2 - 1) * 900
              m.body.setLinvel({ x: clamp(v0.x + nudge, -4200, 4200), y: v0.y }, true)
              m.jetCooldownUntilMs = nowMs + ms('180ms')
              break
            }
            const clampedY = band.y - 44
            const vx = clamp((CUP_X - x) * 2.2 + (Math.random() * 2 - 1) * 900, -3200, 3200)
            const vy = -Math.min(band.upVel, 1900)
            m.body.setTranslation({ x, y: clampedY }, true)
            m.body.setLinvel({ x: vx, y: vy }, true)
            m.body.setAngvel(0, true)
            // Band #1 marks as "passed" after the bounce; #2/#3 do NOT (retry loop).
            if (isFirstBand) m.jetMask |= mask
            m.jetCooldownUntilMs = nowMs + ms('260ms')
            y = clampedY
            break
          }
        }
      }

      if (y > OUT_OF_BOUNDS_Y || x < -OUT_OF_BOUNDS_X_PAD || x > WORLD_W + OUT_OF_BOUNDS_X_PAD) {
        this.eliminate(m, nowMs, 'fall')
        continue
      }

      // Hard finish check (sensor miss fallback): if a marble reaches the cup region, end immediately.
      if (this.phase === 'running') {
        const dxCup = x - CUP_X
        const dyCup = y - CUP_Y
        if (dxCup * dxCup + dyCup * dyCup < 120 * 120) {
          this.onCupEntry(m, nowMs)
          return
        }
      }

      aliveCount += 1
      // Ranking is y-based, but we never want "beyond the cup" progress unless you actually finish.
      // This prevents last-section geometry (and safety floors) from creating "high rank without finishing".
      const yForProgress = this.phase === 'running' ? Math.min(y, CUP_Y - 1) : y
      m.progressY = Math.max(m.progressY, yForProgress)
      leaderProgress = Math.max(leaderProgress, m.progressY)
      m.lastY = y

      if (!top1 || m.progressY > top1.progressY) {
        top3 = top2
        top2 = top1
        top1 = m
      } else if (!top2 || m.progressY > top2.progressY) {
        top3 = top2
        top2 = m
      } else if (!top3 || m.progressY > top3.progressY) {
        top3 = m
      }

      // Anti-stuck: if a marble hasn't progressed for a while and is almost stationary, nudge it.
      const v = m.body.linvel()
      const speed = Math.hypot(v.x, v.y)
      // Prevent tunneling through thin-ish colliders at extreme speeds.
      const maxSpeed = 7000
      if (speed > maxSpeed) {
        const s = maxSpeed / speed
        m.body.setLinvel({ x: v.x * s, y: v.y * s }, true)
      }
      const progressed = m.progressY - m.lastProgressY
      if (progressed > 6) {
        m.lastProgressY = m.progressY
        m.lastMovedAtMs = nowMs
        m.rescueCount = 0
        m.rescueCooldownUntilMs = 0
      } else if (
        this.phase === 'running' &&
        nowMs >= m.rescueCooldownUntilMs &&
        nowMs - m.lastMovedAtMs > ms('1.4s') &&
        speed < 28
      ) {
        // Stuck rescue: if a marble wedges somewhere, rescue it quickly.
        m.rescueCooldownUntilMs = nowMs + ms('1.8s')
        m.lastMovedAtMs = nowMs
        const pNow = m.body.translation()
        const nearFinish = pNow.y > CUP_Y - 1600
        if (m.rescueCount === 0) {
          m.rescueCount = 1
          if (nearFinish) {
            const dx = CUP_X - pNow.x
            const dy = CUP_Y - pNow.y
            const len = Math.hypot(dx, dy) || 1
            const ix = (dx / len) * 2000
            const iy = (dy / len) * 2400
            m.body.applyImpulse({ x: ix, y: iy }, true)
          } else {
            const kickX = (Math.random() * 2 - 1) * 1100
            m.body.setLinvel({ x: kickX, y: -3400 }, true)
          }
          m.body.setAngvel((Math.random() * 2 - 1) * 14, true)
        } else {
          // Second strike: respawn near the top so it rejoins the race.
          m.rescueCount = 0
          const rx = 140 + Math.random() * (WORLD_W - 280)
          const ry = 48 + Math.random() * 96
          m.body.setTranslation({ x: rx, y: ry }, true)
          m.body.setLinvel({ x: (Math.random() * 2 - 1) * 260, y: 1300 + Math.random() * 520 }, true)
          m.body.setAngvel((Math.random() * 2 - 1) * 10, true)
        }
      } else if (nowMs >= m.stuckCooldownUntilMs && nowMs - m.lastMovedAtMs > ms('2.8s') && speed < 60) {
        m.stuckCooldownUntilMs = nowMs + ms('2s')
        m.lastMovedAtMs = nowMs
        const pNow = m.body.translation()
        const nearFinish = pNow.y > CUP_Y - 1200
        if (nearFinish) {
          const dx = CUP_X - pNow.x
          const dy = CUP_Y - pNow.y
          const len = Math.hypot(dx, dy) || 1
          const ix = (dx / len) * 900
          const iy = (dy / len) * 900
          m.body.applyImpulse({ x: ix, y: iy }, true)
        } else {
          const jx = (Math.random() * 2 - 1) * 520
          // Bias downward to keep progress going.
          const jy = 520 + Math.random() * 260
          m.body.applyImpulse({ x: jx, y: jy }, true)
        }
      }

      // Magnet effect: temporary "hold" on leaders.
      if (this.phase === 'running' && nowMs < m.magnetUntilMs) {
        const px = m.body.translation()
        const dx = m.magnetX - px.x
        const dy = m.magnetY - px.y
        const dist = Math.hypot(dx, dy) || 1
        const strength = 10000
        m.body.applyImpulse({ x: (dx / dist) * strength, y: (dy / dist) * (strength * 1.35) }, true)
      }

      // Finish drain: 낙사하지 않은 공은 결국 컵으로 들어오게 만들어요.
      // (수평면 금지 + 핀볼 구조 특성상, "미세 정체"를 완전히 없애려면 종반에 드레인이 필요해요.)
      if (elapsedMs > ms('40s') && p.y > CUP_Y - 2200) {
        const dx = CUP_X - p.x
        const dy = CUP_Y - p.y
        const dist = Math.hypot(dx, dy) || 1
        const region = clamp((p.y - (CUP_Y - 2200)) / 2200, 0, 1)
        const time = clamp((elapsedMs - ms('40s')) / ms('12s'), 0, 1)
        const strength = region * time
        const pull = 40 + strength * 260
        m.body.applyImpulse({ x: (dx / dist) * pull, y: (dy / dist) * (pull * 1.25) }, true)
      }
    }

    // Checkpoint cut (2회)
    if (this.cutState) {
      if (nowMs >= this.cutState.endsAtMs) {
        this.applyCut(this.cutState.cutCount, nowMs)
        this.cutState = null
        this.checkpointIndex += 1
      }
    } else if (this.checkpointIndex < this.checkpointsY.length) {
      const y = this.checkpointsY[this.checkpointIndex]
      if (leaderProgress >= y) {
        const cutCount = Math.floor(aliveCount * 0.1)
        if (cutCount >= 5) {
          this.cutState = {
            checkpointNumber: this.checkpointIndex + 1,
            endsAtMs: nowMs + ms('3s'),
            cutCount,
          }
          this.camera.shakeUntilMs = nowMs + ms('180ms')
          this.camera.shakeAmp = 4
        } else {
          // 5명 미만이면 컷 연출이 없어요.
          this.checkpointIndex += 1
        }
      }
    }

    // NOTE: 골든 모먼트(슬로모)는 결승 근처에서 “초근접 경합”일 때만 발동해요.
    if (this.phase === 'running' && this.timeScale === 1) {
      this.maybeStartSlowMo(nowMs, [top1, top2, top3])
    }
  }

  private onSensor(kind: SensorKind, sensorHandle: number, marble: MarbleRuntime, nowMs: number) {
    if (marble.isEliminated) return
    if (kind === 'cup') {
      this.onCupEntry(marble, nowMs)
      return
    }
    if (kind === 'warp') {
      this.tryWarp(marble, nowMs)
      return
    }
    if (kind === 'boost') {
      this.tryBoost(marble, nowMs)
      return
    }
    if (kind === 'slow') {
      this.trySlow(sensorHandle, marble, nowMs)
      return
    }
    if (kind === 'magnet') {
      this.tryMagnet(sensorHandle, marble, nowMs)
      return
    }
    if (kind === 'bomb') {
      this.tryBomb(sensorHandle, marble, nowMs)
      return
    }
    if (kind === 'kicker') {
      this.tryKicker(sensorHandle, marble, nowMs)
    }
  }

  private updateObstacles(nowMs: number) {
    if (!this.world) return
    if (this.obstacles.length === 0) return

    const t = nowMs / 1000
    const elapsedMs = nowMs - this.startedAtMs
    for (const o of this.obstacles) {
      const canMove = !o.startAfterMs || elapsedMs >= o.startAfterMs
      if (!canMove) {
        o.body.setNextKinematicTranslation({ x: o.baseX, y: o.baseY })
        o.body.setNextKinematicRotation(o.baseAngle)
        continue
      }
      if (o.kind === 'rotor') {
        // Full 360° spin is OK (walls are the only "no-horizontal" constraint).
        const angle = o.baseAngle + (t * o.speed + o.phase)
        o.body.setNextKinematicRotation(angle)
        o.body.setNextKinematicTranslation({ x: o.baseX, y: o.baseY })
        continue
      }
      // slider: oscillate horizontally
      const x = o.baseX + Math.sin(t * o.speed + o.phase) * o.amplitude
      o.body.setNextKinematicTranslation({ x, y: o.baseY })
      o.body.setNextKinematicRotation(o.baseAngle)
    }
  }

  private ensureRankThresholds() {
    if (
      this.bottom30MaxProgress !== Number.NEGATIVE_INFINITY &&
      this.top10MinProgress !== Number.POSITIVE_INFINITY &&
      this.top30MinProgress !== Number.POSITIVE_INFINITY
    ) {
      return
    }
    const alive = this.marbles.filter((m) => !m.isEliminated)
    if (alive.length === 0) return
    const sorted = alive.slice().sort((a, b) => b.progressY - a.progressY)
    this.updateRankThresholds(sorted)
  }

  private updateRankThresholds(sortedDesc: MarbleRuntime[]) {
    const aliveCount = sortedDesc.length
    if (aliveCount === 0) return

    const top10Count = Math.max(1, Math.ceil(aliveCount * 0.1))
    const top30Count = Math.max(1, Math.ceil(aliveCount * 0.3))
    const bottom30Count = Math.max(1, Math.ceil(aliveCount * 0.3))

    const top10Idx = clamp(top10Count - 1, 0, aliveCount - 1)
    const top30Idx = clamp(top30Count - 1, 0, aliveCount - 1)
    const bottom30Idx = clamp(aliveCount - bottom30Count, 0, aliveCount - 1)

    this.top10MinProgress = sortedDesc[top10Idx]?.progressY ?? 0
    this.top30MinProgress = sortedDesc[top30Idx]?.progressY ?? 0
    this.bottom30MaxProgress = sortedDesc[bottom30Idx]?.progressY ?? 0
  }

  private isBottom30(m: MarbleRuntime): boolean {
    this.ensureRankThresholds()
    return m.progressY <= this.bottom30MaxProgress
  }

  private isTop10(m: MarbleRuntime): boolean {
    this.ensureRankThresholds()
    return m.progressY >= this.top10MinProgress
  }

  private isTop30(m: MarbleRuntime): boolean {
    this.ensureRankThresholds()
    return m.progressY >= this.top30MinProgress
  }

  private tryWarp(m: MarbleRuntime, nowMs: number) {
    if (m.warpUsed) return
    if (!this.isTop30(m)) return

    const p0 = m.body.translation()
    m.warpUsed = true
    const x = 585 + Math.random() * 110
    const y = 4700

    m.body.setTranslation({ x, y }, true)
    m.body.setLinvel({ x: 0, y: 2000 }, true)
    m.body.setAngvel(0, true)
    // NOTE: 워프 존은 "역전 장치"라서, 순위(진행도)도 뒤로 밀려야 체감이 좋아요.
    m.progressY = y
    m.lastProgressY = y
    m.lastY = y
    m.lastMovedAtMs = nowMs

    const targetId = this.sfxTargetId
    const allowSfx = Boolean(targetId && m.participant.id === targetId)
    if (allowSfx && this.isInCameraView(p0.x, p0.y, 120)) {
      this.sfx?.playWarp()
      this.camera.shakeUntilMs = nowMs + ms('220ms')
      this.camera.shakeAmp = 6
    }
  }

  private tryBoost(m: MarbleRuntime, nowMs: number) {
    if (nowMs < m.boostCooldownUntilMs) return
    m.boostCooldownUntilMs = nowMs + ms('900ms')

    const p0 = m.body.translation()
    const inView = this.isInCameraView(p0.x, p0.y, 120)
    const targetId = this.sfxTargetId
    const allowSfx = Boolean(targetId && m.participant.id === targetId)
    const v = m.body.linvel()
    if (this.isBottom30(m)) {
      // Catch-up boost
      const vy = Math.max(v.y, 3000)
      m.body.setLinvel({ x: v.x * 0.6, y: vy }, true)
      if (inView && allowSfx) {
        this.sfx?.playBoost('catchup')
        this.camera.shakeUntilMs = nowMs + ms('120ms')
        this.camera.shakeAmp = 3
      }
      return
    }
    if (this.isTop10(m)) {
      // Leader debuff (slower + slight sideways wobble)
      const vy = v.y * 0.35
      const wobble = (Math.random() * 2 - 1) * 420
      m.body.setLinvel({ x: v.x * 0.4 + wobble, y: vy }, true)
      if (inView && allowSfx) this.sfx?.playBoost('debuff')
      return
    }
    // Middle pack: mild boost
    m.body.setLinvel({ x: v.x * 0.7, y: Math.max(v.y, 2500) }, true)
    if (inView && allowSfx) this.sfx?.playBoost('mid')
  }

  private trySlow(sensorHandle: number, m: MarbleRuntime, nowMs: number) {
    const pad = this.slowByHandle.get(sensorHandle)
    if (!pad) return
    if (nowMs - pad.lastAtMs < pad.cooldownMs) return
    pad.lastAtMs = nowMs

    const p0 = m.body.translation()
    const inView = this.isInCameraView(p0.x, p0.y, 120)
    const targetId = this.sfxTargetId
    const allowSfx = Boolean(targetId && m.participant.id === targetId)
    // A dedicated deceleration pad: slows everyone a bit, top10 even more.
    const factor = this.isTop10(m) ? Math.min(0.25, pad.factor * 0.6) : pad.factor
    const v = m.body.linvel()
    m.body.setLinvel({ x: v.x * 0.55, y: v.y * factor }, true)
    m.body.setAngvel((Math.random() * 2 - 1) * 6, true)
    if (inView && allowSfx) this.sfx?.playBoost('debuff')
  }

  private tryMagnet(sensorHandle: number, m: MarbleRuntime, nowMs: number) {
    const pit = this.magnetByHandle.get(sensorHandle)
    if (!pit) return
    if (nowMs - pit.lastAtMs < pit.cooldownMs) return
    pit.lastAtMs = nowMs

    // Debuff leaders: only top10 gets "held" by the magnet.
    if (!this.isTop10(m)) return

    const p0 = m.body.translation()
    const inView = this.isInCameraView(p0.x, p0.y, 140)
    const targetId = this.sfxTargetId
    const allowSfx = Boolean(targetId && m.participant.id === targetId)
    m.magnetUntilMs = nowMs + pit.durationMs
    m.magnetX = pit.x
    m.magnetY = pit.pullY
    // Immediate slowdown so it feels like a trap.
    const v = m.body.linvel()
    m.body.setLinvel({ x: v.x * 0.12, y: v.y * 0.06 }, true)
    if (inView && allowSfx) {
      this.sfx?.playBoost('debuff')
      this.camera.shakeUntilMs = Math.max(this.camera.shakeUntilMs, nowMs + ms('120ms'))
      this.camera.shakeAmp = Math.max(this.camera.shakeAmp, 3)
    }
  }

  private tryBomb(sensorHandle: number, trigger: MarbleRuntime, nowMs: number) {
    const bomb = this.bombByHandle.get(sensorHandle)
    if (!bomb) return
    if (nowMs - bomb.lastAtMs < bomb.cooldownMs) return
    bomb.lastAtMs = nowMs

    // Explosion: apply a quick radial impulse to nearby marbles (pinball chaos).
    const radius = bomb.radius
    const r2 = radius * radius
    for (const m of this.marbles) {
      if (m.isEliminated) continue
      const p = m.body.translation()
      const dx = p.x - bomb.x
      const dy = p.y - bomb.y
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const dist = Math.sqrt(Math.max(1, d2))
      const nx = dx / dist
      const ny = dy / dist
      // Push outward + a little upward so it looks dramatic.
      const falloff = 1 - clamp(dist / radius, 0, 1)
      const base = bomb.power * falloff
      m.body.applyImpulse({ x: nx * base, y: ny * base - base * 0.35 }, true)
    }

    const targetId = this.sfxTargetId
    const allowSfx = Boolean(targetId && trigger.participant.id === targetId)
    if (allowSfx && this.isInCameraView(bomb.x, bomb.y, 160)) {
      this.sfx?.playCut()
      this.camera.shakeUntilMs = Math.max(this.camera.shakeUntilMs, nowMs + ms('260ms'))
      this.camera.shakeAmp = Math.max(this.camera.shakeAmp, 10)
    }
  }

  private tryKicker(sensorHandle: number, m: MarbleRuntime, nowMs: number) {
    const kicker = this.kickerByHandle.get(sensorHandle)
    if (!kicker) return
    const elapsedMs = nowMs - this.startedAtMs
    if (kicker.activeUntilMs && elapsedMs >= kicker.activeUntilMs) return
    if (nowMs < m.kickerCooldownUntilMs) return
    m.kickerCooldownUntilMs = nowMs + (kicker.cooldownMs ?? ms('420ms'))

    const p = m.body.translation()
    let dx = p.x - kicker.x
    let dy = p.y - kicker.y
    const len = Math.hypot(dx, dy)
    if (len > 0.0001) {
      dx /= len
      dy /= len
    } else {
      dx = Math.random() * 2 - 1
      dy = Math.random() * 2 - 1
    }

    const power = kicker.power
    const dirX = kicker.mode === 'towardCenter' ? -dx : dx
    if (!kicker.playSfx) {
      // Jet band: set velocity directly so it actually prevents speedruns (impulses are too small vs 1000 balls mass).
      const vx = clamp((kicker.x - p.x) * 3.2, -2600, 2600)
      const vy = -power
      m.body.setLinvel({ x: vx, y: vy }, true)
      m.body.setAngvel(0, true)
      return
    }

    // Pop bumper: set a strong outgoing velocity (more consistent + punchy than impulse).
    const v0 = m.body.linvel()
    const speed0 = Math.hypot(v0.x, v0.y)
    const kick = Math.max(speed0, power)
    const jitter = (Math.random() * 2 - 1) * (kick * 0.14)
    const vx = dirX * kick + jitter
    // Upward bias to create hang-time + drama, but keep it bounded.
    const vy = clamp(dy * kick - kick * 0.78, -6200, 5200)
    m.body.setLinvel({ x: vx, y: vy }, true)
    m.body.setAngvel((Math.random() * 2 - 1) * 7.5, true)
    m.bumpedAtMs = nowMs

    // Local hit flash (cheap): record an event and draw a ring in `render()`.
    const fxKind = kicker.fxKind === 'mega' ? 'mega' : 'normal'
    const fxR = kicker.radius ?? 28
    if (nowMs - this.lastBumperFxAtMs >= ms('26ms')) {
      this.lastBumperFxAtMs = nowMs
      this.bumperFx.push({ x: kicker.x, y: kicker.y, r: fxR, atMs: nowMs, kind: fxKind })
      if (this.bumperFx.length > 40) this.bumperFx.splice(0, this.bumperFx.length - 40)
    }
    const inView = this.isInCameraView(kicker.x, kicker.y, 60)
    const targetId = this.sfxTargetId
    const allowSfx = Boolean(targetId && m.participant.id === targetId)
    // Global event SFX limiter (prevents early-game overlap noise)
    if (inView && allowSfx && this.sfx && kicker.playSfx) {
      const minGap = elapsedMs < ms('10s') ? ms('140ms') : ms('80ms')
      if (nowMs - this.lastEventSfxAtMs >= minGap) {
        this.lastEventSfxAtMs = nowMs
        const intensity = elapsedMs < ms('10s') ? 0.55 : 0.85
        this.sfx.playBumper(intensity, fxKind)
      }
    }

    // Small camera shake if the bumper is on-screen (prevents off-screen noise).
    if (inView && allowSfx && nowMs - this.lastBumperShakeAtMs >= ms('120ms')) {
      this.lastBumperShakeAtMs = nowMs
      const amp = fxKind === 'mega' ? 6 : 3
      this.camera.shakeUntilMs = Math.max(this.camera.shakeUntilMs, nowMs + ms('140ms'))
      this.camera.shakeAmp = Math.max(this.camera.shakeAmp, amp)
    }
  }

  private applyCut(cutCount: number, nowMs: number) {
    if (cutCount < 5) return
    const alive = this.marbles.filter((m) => !m.isEliminated)
    if (alive.length < 50) return // 10%가 5 미만이면 컷이 없어요.

    const sorted = alive.slice().sort((a, b) => a.progressY - b.progressY)
    const victims = sorted.slice(0, cutCount)
    const targetId = this.sfxTargetId
    let includesTarget = false
    for (const v of victims) {
      if (targetId && v.participant.id === targetId) includesTarget = true
      this.eliminate(v, nowMs, 'cut')
    }

    if (includesTarget) {
      this.sfx?.playCut()
      this.camera.shakeUntilMs = nowMs + ms('320ms')
      this.camera.shakeAmp = 12
    }
  }

  private maybeStartSlowMo(nowMs: number, top3: Array<MarbleRuntime | null>) {
    // NOTE: 발동 조건(현재 튜닝 값)
    // - TOP10 완주 전까지만 (cupEntries < TOP10_FINISHERS_TARGET)
    // - Top3 중 2명 이상이 결승 구간(finalStartY) 진입
    // - 두 선수의 y 간격이 70px 이하
    // - 그중 최소 1명이 컵 중심에서 240px 안
    //
    // 발동 시: 0.25배속으로 2.2초, 이후 7초 쿨다운이에요.
    if (nowMs < this.slowMoCooldownUntilMs) {
      return
    }
    if (this.timeScale !== 1) {
      return
    }
    if (this.cupEntries.length >= TOP10_FINISHERS_TARGET) {
      return
    }

    const cupX = CUP_X
    const cupY = CUP_Y
    const finalStartY = CUP_Y - 520
    const contenders = top3.filter((m): m is MarbleRuntime => Boolean(m && !m.isEliminated))
    const near = contenders.filter((m) => m.progressY >= finalStartY)

    if (near.length < 2) {
      return
    }

    const ys = near.map((m) => m.body.translation().y)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    if (maxY - minY > 70) {
      return
    }

    const closeToCup = near.some((m) => {
      const p = m.body.translation()
      return Math.hypot(p.x - cupX, p.y - cupY) < 240
    })

    if (!closeToCup) {
      return
    }

    this.timeScale = 0.2
    this.slowMoUntilMs = nowMs + ms('3s')
    this.slowMoCooldownUntilMs = nowMs + ms('7s')
    const targetId = this.sfxTargetId
    const targetInNear = targetId ? near.some((m) => m.participant.id === targetId) : false
    if (targetInNear) {
      this.sfx?.playSlowMo()
      this.camera.shakeUntilMs = nowMs + ms('180ms')
      this.camera.shakeAmp = 4
    }
  }

  private onCupEntry(m: MarbleRuntime, nowMs: number) {
    if (m.isEliminated) {
      return
    }

    this.recordCupEntry(m, nowMs)

    // Fast-forward: TOP10이 나오면 이후에는 빠르게 마무리해요
    if (!this.fastForwardOn && this.cupEntries.length >= TOP10_FINISHERS_TARGET) {
      this.fastForwardOn = true
      this.timeScale = FAST_FORWARD_SCALE
      this.camera.shakeUntilMs = Math.max(this.camera.shakeUntilMs, nowMs + ms('140ms'))
      this.camera.shakeAmp = Math.max(this.camera.shakeAmp, 4)
      this.emitUi(true)
    }

    // First finisher becomes the winner (but we keep the round running until >= 60s).
    if (!this.winner && this.cupEntries.length > 0) {
      const first = this.cupEntries[0]
      this.winner = { id: first.id, name: first.name, colorHex: first.colorHex }
      this.winnerToastUntilMs = nowMs + ms('6s')
      const targetId = this.sfxTargetId
      if (targetId && first.id === targetId) {
        this.sfx?.playWin()
        this.camera.shakeUntilMs = Math.max(this.camera.shakeUntilMs, nowMs + ms('250ms'))
        this.camera.shakeAmp = Math.max(this.camera.shakeAmp, 8)
      }
      this.emitUi(true)
    }

    // Cup "sink": remove any marble that enters the cup.
    this.removeFromWorld(m, nowMs, { hideImmediately: true })

    // If minimum time already passed, end immediately on the first cup entry.
    if (this.phase === 'running' && nowMs >= this.minRoundEndsAtMs && this.cupEntries.length > 0) {
      this.beginFinishSequence(nowMs)
    }
  }

  private beginFinishSequence(nowMs: number) {
    if (this.phase !== 'running') return
    if (this.finishState) return
    if (this.cupEntries.length === 0) return

    const first = this.cupEntries[0]
    this.winner = { id: first.id, name: first.name, colorHex: first.colorHex }
    this.finishState = {
      winnerId: first.id,
      postEndsAtMs: nowMs + POST_FINISH_MS,
      stopAtMs: nowMs + POST_FINISH_RUN_MS,
    }

    // Don't override user-driven camera peeks (minimap) when starting the finish sequence.
    if (this.camera.mode === 'auto' && this.worldContainer) {
      this.camera.mode = 'manual'
      this.camera.manualUntilMs = nowMs + POST_FINISH_RUN_MS
      this.camera.x = 0
      this.camera.y = clamp(CUP_Y - SCREEN_H * 0.72, 0, WORLD_H - SCREEN_H)
      this.worldContainer.x = -this.camera.x
      this.worldContainer.y = -this.camera.y
    }

    this.emitUi(true)
  }

  private endRound(nowMs: number) {
    if (this.phase !== 'running') return
    if (this.cupEntries.length === 0) return

    const first = this.cupEntries[0]
    this.winner = { id: first.id, name: first.name, colorHex: first.colorHex }
    this.phase = 'finished'
    this.finishState = null
    // NOTE: If the round ends while focus is active, the UI would otherwise "freeze" with the focus overlay.
    // Clear focus fields explicitly because there are no more ticks to naturally expire focus timers.
    if (this.camera.mode === 'focus') this.camera.mode = 'auto'
    this.camera.focusUntilMs = 0
    this.camera.focusId = null
    this.camera.focusName = null
    // Ensure visuals (e.g. cup-sink hideImmediately) apply immediately even if the round ended mid-step.
    this.render(nowMs)
    this.emitUi(true)
    this.app.ticker.remove(this.onTick)
  }

  private recordCupEntry(m: MarbleRuntime, nowMs: number) {
    const id = m.participant.id
    if (this.cupEntryById.has(id)) return
    const e: CupEntry = { id, name: m.participant.name, colorHex: m.participant.colorHex, atMs: nowMs }
    this.cupEntryById.set(id, e)
    this.cupEntries.push(e)
  }

  private removeFromWorld(m: MarbleRuntime, nowMs: number, opts?: { hideImmediately?: boolean } | undefined) {
    if (!this.world) return
    if (m.isEliminated) return
    m.isEliminated = true
    m.eliminatedAtMs = opts?.hideImmediately ? nowMs - ms('999ms') : nowMs
    this.marblesByCollider.delete(m.collider.handle)
    this.world.removeCollider(m.collider, true)
    this.world.removeRigidBody(m.body)
  }

  private eliminate(m: MarbleRuntime, nowMs: number, reason: 'fall' | 'cut') {
    if (m.isEliminated) return
    this.eliminatedBy[reason] += 1
    this.removeFromWorld(m, nowMs)
  }

  private updateCamera(nowMs: number) {
    if (!this.worldContainer) return

    const alive = this.marbles.filter((m) => !m.isEliminated)
    if (alive.length === 0) return

    if (this.camera.mode === 'manual' && nowMs >= this.camera.manualUntilMs) {
      if (this.camera.peekReturn && nowMs >= this.camera.peekUntilMs) {
        const r = this.camera.peekReturn
        this.camera.peekReturn = null
        this.camera.peekUntilMs = 0
        this.camera.mode = r.mode
        this.camera.x = r.x
        this.camera.y = r.y
        this.camera.focusUntilMs = r.focusUntilMs
        this.camera.focusId = r.focusId
        this.camera.focusName = r.focusName
        this.camera.manualUntilMs = r.manualUntilMs
      } else {
        this.camera.mode = 'auto'
      }
    }
    if (this.camera.mode === 'focus' && nowMs >= this.camera.focusUntilMs) {
      this.camera.mode = 'auto'
      this.camera.focusUntilMs = 0
      this.camera.focusId = null
      this.camera.focusName = null
    }

    let targetY = 0
    let targetX = WORLD_W / 2

    if (this.camera.mode === 'manual') {
      targetX = this.camera.x + SCREEN_W / 2
      // Manual camera stores the top-left view position already.
      // Match the desiredY calculation (targetY - SCREEN_H * CAMERA_Y_ANCHOR) so manual doesn't drift.
      targetY = this.camera.y + SCREEN_H * CAMERA_Y_ANCHOR
    } else {
      if (this.camera.mode === 'focus' && this.camera.focusId) {
        const t = alive.find((m) => m.participant.id === this.camera.focusId)
        if (t) {
          const p = t.body.translation()
          targetY = p.y
          targetX = p.x
        } else {
          // Focus target is gone (finished/eliminated). Cancel focus and fall back to auto.
          this.camera.mode = 'auto'
          this.camera.focusUntilMs = 0
          this.camera.focusId = null
          this.camera.focusName = null
        }
      }

      if (this.camera.mode !== 'focus') {
        // Auto: follow TOP1 (alive).
        const sorted = alive.slice().sort((a, b) => b.progressY - a.progressY)
        // If a marble was respawned (teleported), its current y can be far above its progressY.
        // Avoid snapping the camera back to the top in that case.
        const leader =
          sorted.find((m) => {
            const p = m.body.translation()
            return m.progressY - p.y < 1200
          }) ?? sorted[0]
        const p = leader?.body.translation()
        if (p) {
          targetY = p.y
          targetX = p.x
        }
      }
    }

    const desiredY = clamp(targetY - SCREEN_H * CAMERA_Y_ANCHOR, 0, WORLD_H - SCREEN_H)
    const desiredX = clamp(targetX - SCREEN_W / 2, 0, WORLD_W - SCREEN_W)

    // Smooth follow
    const lerp = this.camera.mode === 'manual' ? 1 : 0.12
    this.camera.y = this.camera.y + (desiredY - this.camera.y) * lerp
    this.camera.x = this.camera.x + (desiredX - this.camera.x) * lerp

    let shakeX = 0
    let shakeY = 0
    if (nowMs < this.camera.shakeUntilMs) {
      const amp = this.camera.shakeAmp
      shakeX = (Math.random() * 2 - 1) * amp
      shakeY = (Math.random() * 2 - 1) * amp
    }

    this.worldContainer.x = -this.camera.x + shakeX
    this.worldContainer.y = -this.camera.y + shakeY
  }

  private render(nowMs: number) {
    if (!this.worldContainer) return

    // Bumper hit flashes
    if (this.bumperFxG) {
      const g = this.bumperFxG
      g.clear()
      const next: Array<{ x: number; y: number; r: number; atMs: number; kind: 'normal' | 'mega' }> = []
      for (const fx of this.bumperFx) {
        const t = clamp((nowMs - fx.atMs) / ms('220ms'), 0, 1)
        if (t >= 1) continue
        next.push(fx)
        const scale = 1 + t * 1.8
        const alpha = (1 - t) * (fx.kind === 'mega' ? 0.34 : 0.22)
        const color = fx.kind === 'mega' ? 0xfacc15 : 0xf97316
        g.circle(fx.x, fx.y, (fx.r + 12) * scale).stroke({ color, width: 2, alpha })
        g.circle(fx.x, fx.y, fx.r * 0.9).fill({ color, alpha: alpha * 0.12 })
      }
      this.bumperFx = next
    }

    for (const o of this.obstacles) {
      const p = o.body.translation()
      o.display.position.set(p.x, p.y)
      o.display.rotation = o.body.rotation()
    }

    for (const m of this.marbles) {
      const alive = !m.isEliminated
      if (alive) {
        const p = m.body.translation()
        m.display.visible = true
        m.display.alpha = 1
        m.display.position.set(p.x, p.y)
        const dt = nowMs - m.bumpedAtMs
        if (dt >= 0 && dt < ms('160ms')) {
          const t = clamp(dt / ms('160ms'), 0, 1)
          const s = 1 + (1 - t) * 0.22
          m.display.scale.set(s)
        } else if (m.display.scale.x !== 1) {
          m.display.scale.set(1)
        }
        continue
      }

      // Simple elimination animation (fade out)
      const diedAt = m.eliminatedAtMs ?? nowMs
      const t = clamp((nowMs - diedAt) / ms('400ms'), 0, 1)
      m.display.visible = true
      m.display.alpha = 1 - t
      m.display.scale.set(1 - t * 0.25)
      if (t >= 1) {
        m.display.visible = false
      }
    }

    // Highlight: pinned name + focus
    const highlight = this.highlightName
    const focusId = this.camera.focusId
    for (const m of this.marbles) {
      if (m.isEliminated) {
        m.ring.visible = false
        if (m.label) m.label.visible = false
        if (m.nameTag) m.nameTag.wrap.visible = false
        continue
      }
      const isHighlighted = highlight && m.participant.name === highlight
      const isFocus = focusId && m.participant.id === focusId
      m.ring.visible = Boolean(isHighlighted || isFocus)
      if (m.ring.visible) {
        m.ring.alpha = isFocus ? 0.95 : 0.65
        m.ring.scale.set(isFocus ? 1.25 : 1.1)
      }
      const label = maybeCreateLabel({ PIXI: this.PIXI, marble: m })
      // NOTE: 강조/포커스면 "이름 전체"를 보여주기 위해 이니셜은 숨겨요.
      label.visible = !(isFocus || isHighlighted)
      if (label.visible) {
        label.alpha = 0.88
        label.scale.set(1)
      }

      // Full name tag: only for focus/highlight (keeps the screen readable with 1,000 marbles).
      if (isFocus || isHighlighted) {
        const tag = maybeCreateNameTag({ PIXI: this.PIXI, marble: m })
        tag.wrap.visible = true
        tag.wrap.alpha = isFocus ? 1 : 0.9
      } else if (m.nameTag) {
        m.nameTag.wrap.visible = false
      }
    }
  }

  private emitUi(force: boolean, winner?: MarbleRuntime) {
    if (!this.onUi) return
    const now = performance.now()
    if (!force && now - this.lastUiEmitMs < UI_EMIT_EVERY_MS) return
    this.lastUiEmitMs = now

    const alive = this.marbles.filter((m) => !m.isEliminated)
    const totalCount = this.marbles.length
    const finishedCount = this.cupEntries.length
    const eliminatedCount = this.eliminatedBy.fall + this.eliminatedBy.cut
    const sortedAll = alive.slice().sort((a, b) => b.progressY - a.progressY)
    this.updateRankThresholds(sortedAll)

    const focusId = this.camera.focusId
    const highlight = this.highlightName

    // Ranking: cup entrants first (in entry order), then y-based progress for everyone else.
    const top10: LeaderRow[] = []
    for (let i = 0; i < this.cupEntries.length && top10.length < 10; i += 1) {
      const e = this.cupEntries[i]
      top10.push({
        rank: top10.length + 1,
        id: e.id,
        name: e.name,
        colorHex: e.colorHex,
        progressY: CUP_Y,
        didFinish: true,
        isHighlighted: Boolean(highlight && e.name === highlight),
        isFocusTarget: Boolean(focusId && e.id === focusId),
      })
    }
    const remaining = 10 - top10.length
    if (remaining > 0) {
      // NOTE: `onCupEntry()` can emit UI before the marble is removed from `alive` (same tick).
      // Exclude cup entrants explicitly so Top10 never contains duplicate IDs.
      const sorted = sortedAll.filter((m) => !this.cupEntryById.has(m.participant.id)).slice(0, remaining)
      for (const m of sorted) {
        top10.push({
          rank: top10.length + 1,
          id: m.participant.id,
          name: m.participant.name,
          colorHex: m.participant.colorHex,
          progressY: m.progressY,
          didFinish: false,
          isHighlighted: Boolean(highlight && m.participant.name === highlight),
          isFocusTarget: Boolean(focusId && m.participant.id === focusId),
        })
      }
    }

    const win = winner
      ? {
          id: winner.participant.id,
          name: winner.participant.name,
          colorHex: winner.participant.colorHex,
        }
      : (this.winner ?? undefined)

    const cut = this.cutState
      ? {
          checkpointNumber: this.cutState.checkpointNumber,
          remainingMs: Math.max(0, this.cutState.endsAtMs - now),
          cutCount: this.cutState.cutCount,
        }
      : undefined

    const slowMo = this.timeScale < 1 ? { remainingMs: Math.max(0, this.slowMoUntilMs - now) } : undefined
    const fastForward = this.timeScale > 1 ? { scale: this.timeScale } : undefined

    const focus =
      this.camera.mode === 'focus' && this.camera.focusName && now < this.camera.focusUntilMs
        ? { name: this.camera.focusName, remainingMs: Math.max(0, this.camera.focusUntilMs - now) }
        : undefined

    const postFinish =
      this.finishState && now < this.finishState.postEndsAtMs
        ? { remainingMs: Math.max(0, this.finishState.postEndsAtMs - now) }
        : undefined

    const winnerToast =
      win && now < this.winnerToastUntilMs ? { remainingMs: Math.max(0, this.winnerToastUntilMs - now) } : undefined

    this.onUi({
      phase: this.phase,
      elapsedMs: Math.round(this.elapsedMs),
      totalCount,
      aliveCount: alive.length,
      finishedCount,
      eliminatedCount,
      eliminatedBy: { ...this.eliminatedBy },
      top10,
      camera: { x: this.camera.x, y: this.camera.y },
      world: { w: WORLD_W, h: WORLD_H, screenW: SCREEN_W, screenH: SCREEN_H },
      cut,
      slowMo,
      fastForward,
      focus,
      postFinish,
      winner: win,
      winnerToast,
    })
  }

  private createTextures(): { ball: PIXI.Texture; ring: PIXI.Texture } {
    const gBall = new this.PIXI.Graphics().circle(0, 0, MARBLE_R).fill({ color: 0xffffff })
    const gRing = new this.PIXI.Graphics().circle(0, 0, MARBLE_R + 4).stroke({ color: 0xffffff, width: 3 })

    const ball = this.app.renderer.generateTexture(gBall)
    const ring = this.app.renderer.generateTexture(gRing)
    return { ball, ring }
  }

  private buildMap() {
    const world = this.world
    const staticBody = this.staticBody
    const worldContainer = this.worldContainer
    if (!world || !staticBody || !worldContainer) return

    this.jetBands = []

    // Visuals
    const g = new this.PIXI.Graphics().rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0x0a0a0a })
    worldContainer.addChild(g)

    const mapLines = new this.PIXI.Graphics()
    mapLines.alpha = 0.9
    worldContainer.addChild(mapLines)

    const addWall = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      opts?: { friction?: number; restitution?: number } | undefined,
    ) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy)
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      const angle = Math.atan2(dy, dx)

      const friction = opts?.friction ?? 0.6
      const restitution = opts?.restitution ?? 0.12

      const c = this.R.ColliderDesc.cuboid(len / 2, WALL_THICK / 2)
        .setTranslation(cx, cy)
        .setRotation(angle)
        .setFriction(friction)
        .setRestitution(restitution)
      world.createCollider(c, staticBody)

      mapLines.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0x2a2a2a, width: 4, cap: 'round' })
    }

    // Outer walls (full height) -> 낙사 비율을 크게 줄여요
    // Extend slightly below the world so the bottom catcher floor can't leak at the corners.
    addWall(80, 0, 80, WORLD_H + 120)
    addWall(1200, 0, 1200, WORLD_H + 120)

    // Top ceiling: prevents marbles from flying above y=0, where side walls don't exist.
    // (Without this, a bumper hit can send a marble to y<0 and it can escape sideways outside the map.)
    const ceilingX1 = 96
    const ceilingX2 = 1184
    const ceilingHalfH = 12
    const ceilingCx = (ceilingX1 + ceilingX2) / 2
    const ceilingCy = -ceilingHalfH // bottom face ~= y=0
    const ceilingLen = ceilingX2 - ceilingX1
    world.createCollider(
      this.R.ColliderDesc.cuboid(ceilingLen / 2, ceilingHalfH)
        .setTranslation(ceilingCx, ceilingCy)
        .setFriction(0.6)
        .setRestitution(0.12),
      staticBody,
    )
    // Visual hint line (y=0)
    mapLines.moveTo(ceilingX1, 0).lineTo(ceilingX2, 0).stroke({ color: 0x2a2a2a, width: 4, cap: 'round' })

    // Pinball board (no funnel, no repetitive steps)
    // Irregular pins: removes "clean lanes" (especially near the side walls).
    const rng = mulberry32(0xc0ffee)
    const pinsG = new this.PIXI.Graphics()
    worldContainer.addChild(pinsG)
    const pinBaseR = 5
    const pinRows = 34
    const pinCols = 13
    const baseX = 132
    const spacingX = 76
    const baseY = 220
    const spacingY = 64
    const skipChance = 0.12
    for (let row = 0; row < pinRows; row += 1) {
      const y = baseY + row * spacingY + (rng() - 0.5) * 22
      if (y > 2580) continue
      const rowShift = (row % 2) * (spacingX * 0.48) + (rng() - 0.5) * 22
      for (let col = 0; col < pinCols; col += 1) {
        if (rng() < skipChance) continue
        const x = baseX + col * spacingX + rowShift + (rng() - 0.5) * 26
        if (x < 118 || x > 1162) continue
        const r = pinBaseR + (rng() < 0.15 ? 1 : 0)
        const restitution = 0.52 + rng() * 0.22
        const friction = 0.05 + rng() * 0.1
        const cd = this.R.ColliderDesc.ball(r).setTranslation(x, y).setRestitution(restitution).setFriction(friction)
        world.createCollider(cd, staticBody)
        pinsG.circle(x, y, r).fill({ color: 0x1f2937, alpha: 0.82 })
      }
    }

    // Edge pin curtains (kills the straight drop lane along outer walls)
    for (let i = 0; i < 22; i += 1) {
      const y = 360 + i * 96 + rng() * 50
      if (y > 2600) break
      const r = pinBaseR + 1
      const leftX = 118 + rng() * 22
      const rightX = 1162 - rng() * 22
      const rest = 0.62 + rng() * 0.18
      const fr = 0.04 + rng() * 0.08
      world.createCollider(
        this.R.ColliderDesc.ball(r).setTranslation(leftX, y).setRestitution(rest).setFriction(fr),
        staticBody,
      )
      world.createCollider(
        this.R.ColliderDesc.ball(r).setTranslation(rightX, y).setRestitution(rest).setFriction(fr),
        staticBody,
      )
      pinsG.circle(leftX, y, r).fill({ color: 0x1f2937, alpha: 0.78 })
      pinsG.circle(rightX, y, r).fill({ color: 0x1f2937, alpha: 0.78 })
    }

    // Edge deflectors (angled walls) to push marbles back into the playfield
    addWall(80, 820, 240, 1060, { friction: 0.04, restitution: 0.18 })
    addWall(1200, 920, 1040, 1160, { friction: 0.04, restitution: 0.18 })
    addWall(80, 1400, 260, 1640, { friction: 0.04, restitution: 0.18 })
    addWall(1200, 1520, 1020, 1760, { friction: 0.04, restitution: 0.18 })

    // 30° staircase baffles (longer run, avoids V-shaped dead pockets)
    // Alternate left/right ramps but leave a center gap so nothing forms a concave valley.
    const stairStroke = { color: 0x111827, width: 4, alpha: 0.8 } as const
    const stairsG = new this.PIXI.Graphics()
    worldContainer.addChild(stairsG)
    const addStair = (x1: number, y1: number, x2: number, y2: number) => {
      addWall(x1, y1, x2, y2, { friction: 0.04, restitution: 0.18 })
      stairsG.moveTo(x1, y1).lineTo(x2, y2).stroke(stairStroke)
    }

    const stairDx = 420
    const stairDy = 242 // ~= tan(30deg) * 420
    const stepY = 280
    // Skip the first step: it overlaps the first bounce/gate region.
    for (let i = 1; i < 7; i += 1) {
      const yL = 2620 + i * stepY
      const yR = 2760 + i * stepY
      addStair(120, yL, 120 + stairDx, yL + stairDy) // down-right
      addStair(1160, yR, 1160 - stairDx, yR + stairDy) // down-left
    }

    // Static V-rails / wide walls easily create "valleys" (dead pockets) with 1,000 marbles.
    // -> Keep walls minimal and rely on moving obstacles + bumpers instead.

    // Timed gate positions (actual gates are moving sliders; no static bars)
    const gate1Y = 3160
    const gate2Y = 6260

    // Anti-speedrun jets: prevent free-fall finishes in ~10s while keeping speed/impact.
    // 센서라서 포켓을 만들지 않고, 시간만 늘려줘요.
    const jetsG = new this.PIXI.Graphics()
    worldContainer.addChild(jetsG)
    type JetInput = { y: number; activeUntilMs: number; power: number }
    const addJet = ({ y, activeUntilMs, power }: JetInput) => {
      const halfH = 26
      // NOTE: 여기서는 Rapier 센서를 만들지 않아요.
      // Sensors can retrigger multiple times when lots of balls pile up, which feels like "time-based global gating".
      // Jet behavior is implemented deterministically in `stepOnce()` (per-marble, with jackpot passes).
      this.jetBands.push({ y, activeUntilMs, upVel: power })
      jetsG
        .roundRect(120, y - halfH, 1040, halfH * 2, 18)
        .fill({ color: 0x22d3ee, alpha: 0.04 })
        .stroke({ color: 0x22d3ee, width: 1, alpha: 0.12 })
    }

    // `power` here is the upward velocity target (px/s).
    // Time gates: guarantee the round isn't a ~10s speedrun.
    addJet({ y: 2860, activeUntilMs: ms('28s'), power: 2800 })
    addJet({ y: 5200, activeUntilMs: ms('52s'), power: 3200 })
    addJet({ y: CUP_Y - 980, activeUntilMs: ms('70s'), power: 3600 })

    // Big bounce bumpers (static) - 큰 튕김 연출
    const bumpersG = new this.PIXI.Graphics()
    worldContainer.addChild(bumpersG)
    const bumperFxG = new this.PIXI.Graphics()
    bumperFxG.blendMode = 'add'
    worldContainer.addChild(bumperFxG)
    this.bumperFxG = bumperFxG
    this.bumperFx = []
    this.lastBumperFxAtMs = 0
    const addBumper = (x: number, y: number, r: number) => {
      const isMega = r >= 34
      const cd = this.R.ColliderDesc.ball(r).setTranslation(x, y).setRestitution(0.78).setFriction(0.04)
      world.createCollider(cd, staticBody)
      const sensor = this.R.ColliderDesc.ball(r + 26)
        .setTranslation(x, y)
        .setSensor(true)
        .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
      const sensorCol = world.createCollider(sensor, staticBody)
      this.sensorKindByHandle.set(sensorCol.handle, 'kicker')
      this.kickerByHandle.set(sensorCol.handle, {
        x,
        y,
        power: isMega ? 5200 + r * 18 : 4600 + r * 16,
        mode: 'radialOut',
        playSfx: true,
        cooldownMs: isMega ? ms('140ms') : ms('170ms'),
        radius: r,
        fxKind: isMega ? 'mega' : 'bumper',
      })
      const c = isMega ? 0xfacc15 : 0xf97316
      bumpersG
        .circle(x, y, r + 10)
        .fill({ color: c, alpha: isMega ? 0.1 : 0.08 })
        .circle(x, y, r)
        .fill({ color: c, alpha: isMega ? 0.26 : 0.18 })
        .circle(x, y, r)
        .stroke({ color: c, width: 2, alpha: isMega ? 0.62 : 0.45 })
    }
    addBumper(300, 520, 28)
    addBumper(980, 660, 28)
    addBumper(640, 980, 34)
    addBumper(360, 1520, 28)
    addBumper(920, 1680, 28)
    addBumper(640, 6100, 30)

    // Extra mid bumpers to keep the ball "in play" (avoids getting stuck in pockets)
    // Keep them away from the 30° staircase walls (avoid overlapping colliders).
    addBumper(640, 3000, 28)
    addBumper(560, 3300, 26)
    addBumper(640, 3920, 34)
    addBumper(360, 4700, 28)
    addBumper(920, 4880, 28)

    // Moving obstacles (도파민용) - 회전/슬라이더
    const obstacleStroke = { color: 0x0b0b0c, width: 2, alpha: 0.55 } as const
    type RotorInput = {
      x: number
      y: number
      halfW: number
      halfH: number
      speed: number
      phase: number
      startAfterMs?: number | undefined
      baseAngle?: number | undefined
      angleAmplitude?: number | undefined
    }
    const addRotor = ({ x, y, halfW, halfH, speed, phase, startAfterMs, baseAngle, angleAmplitude }: RotorInput) => {
      const rb = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y)
      const body = world.createRigidBody(rb)
      // Big bounce obstacle: high restitution for pinball-like dopamine.
      const cd = this.R.ColliderDesc.cuboid(halfW, halfH).setFriction(0.08).setRestitution(0.86)
      const collider = world.createCollider(cd, body)

      const display = new this.PIXI.Container()
      display.position.set(x, y)
      const g = new this.PIXI.Graphics()
        .roundRect(-halfW, -halfH, halfW * 2, halfH * 2, halfH)
        .fill({ color: 0xf97316, alpha: 0.22 })
        .stroke(obstacleStroke)
      display.addChild(g)
      worldContainer.addChild(display)

      this.obstacles.push({
        body,
        collider,
        display,
        kind: 'rotor',
        baseX: x,
        baseY: y,
        halfW,
        halfH,
        phase,
        speed,
        amplitude: 0,
        startAfterMs,
        baseAngle: baseAngle ?? Math.PI / 4,
        angleAmplitude: angleAmplitude ?? 0.6,
      })
    }

    type SliderInput = {
      x: number
      y: number
      halfW: number
      halfH: number
      amplitude: number
      speed: number
      phase: number
      startAfterMs?: number | undefined
      baseAngle?: number | undefined
    }
    const addSlider = ({ x, y, halfW, halfH, amplitude, speed, phase, startAfterMs }: SliderInput) => {
      const rb = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y)
      const body = world.createRigidBody(rb)
      // Big bounce obstacle: high restitution for pinball-like dopamine.
      const cd = this.R.ColliderDesc.cuboid(halfW, halfH).setFriction(0.1).setRestitution(0.72)
      const collider = world.createCollider(cd, body)

      const display = new this.PIXI.Container()
      display.position.set(x, y)
      const g = new this.PIXI.Graphics()
        .roundRect(-halfW, -halfH, halfW * 2, halfH * 2, Math.min(halfW, halfH))
        .fill({ color: 0x22d3ee, alpha: 0.18 })
        .stroke(obstacleStroke)
      display.addChild(g)
      worldContainer.addChild(display)

      this.obstacles.push({
        body,
        collider,
        display,
        kind: 'slider',
        baseX: x,
        baseY: y,
        halfW,
        halfH,
        phase,
        speed,
        amplitude,
        startAfterMs,
        baseAngle: 0,
        angleAmplitude: 0,
      })
    }

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
    })
    addSlider({
      x: 640,
      y: gate2Y,
      halfW: 80,
      halfH: 14,
      amplitude: 480,
      speed: 1.2,
      phase: 1.1,
      startAfterMs: ms('28s'),
    })

    addRotor({ x: 640, y: 3600, halfW: 190, halfH: 10, speed: 2.6, phase: 0.2, baseAngle: 0.82, angleAmplitude: 0.55 })
    addSlider({ x: 640, y: 4400, halfW: 190, halfH: 14, amplitude: 240, speed: 1.8, phase: 1.2 })

    // Mid-to-final: minimize static walls, use moving obstacles to avoid dead valleys.
    addRotor({ x: 420, y: 5600, halfW: 180, halfH: 10, speed: 3.0, phase: 0.5, baseAngle: 0.9, angleAmplitude: 0.55 })
    addRotor({ x: 860, y: 5850, halfW: 180, halfH: 10, speed: 2.8, phase: 1.1, baseAngle: 0.9, angleAmplitude: 0.55 })
    addSlider({ x: 640, y: 6500, halfW: 220, halfH: 14, amplitude: 340, speed: 1.4, phase: 0.7 })
    addRotor({ x: 640, y: 7200, halfW: 240, halfH: 10, speed: 3.4, phase: 0.2, baseAngle: 0.88, angleAmplitude: 0.55 })
    addSlider({ x: 640, y: 7800, halfW: 240, halfH: 14, amplitude: 420, speed: 1.1, phase: 1.6 })

    addBumper(340, 7000, 28)
    addBumper(940, 7120, 28)
    addBumper(640, 7600, 34)
    addBumper(420, 8200, 28)
    addBumper(860, 8320, 28)

    // Final section (NO V valley + NO out-of-bounds falls)
    // Instead of a V-shaped mouth, keep it open and use a horizontal sweeper + safety floor.
    addRotor({
      x: CUP_X,
      y: CUP_Y - 240,
      halfW: 220,
      halfH: 10,
      speed: 4.0,
      phase: 0.9,
      baseAngle: 0.0,
      angleAmplitude: 0.0,
    })

    // Sweeper: pushes marbles toward the cup without creating pockets (horizontal movement is OK).
    addSlider({ x: CUP_X, y: CUP_Y - 320, halfW: 260, halfH: 12, amplitude: 520, speed: 1.35, phase: 0.4 })

    // Safety catcher floor: prevents any marble from falling out of the world (no 낙사).
    // Slight tilt only (still "not perfectly horizontal").
    const floorYLeft = WORLD_H - 36
    const floorYRight = WORLD_H - 60
    addWall(96, floorYLeft, 1184, floorYRight, { friction: 0.05, restitution: 0.1 })
    // Corner guides into the floor so edges can't leak
    addWall(80, CUP_Y - 520, 96, floorYLeft, { friction: 0.05, restitution: 0.1 })
    addWall(1200, CUP_Y - 560, 1184, floorYRight, { friction: 0.05, restitution: 0.1 })

    // Checkpoint lines (visual only)
    for (const y of this.checkpointsY) {
      // 절대 수평선 금지 -> 살짝 기울여요
      mapLines
        .moveTo(140, y - 6)
        .lineTo(1140, y + 6)
        .stroke({ color: 0x1f2937, width: 2, cap: 'round' })
    }

    // Warp zones (상위 30%만 발동) - 중후반 역전
    const warpZones = [
      { x: 360, y: 6100, halfW: 90, halfH: 18 },
      { x: 920, y: 6400, halfW: 90, halfH: 18 },
    ] as const
    const warpG = new this.PIXI.Graphics()
    worldContainer.addChild(warpG)
    for (const z of warpZones) {
      const cd = this.R.ColliderDesc.cuboid(z.halfW, z.halfH)
        .setTranslation(z.x, z.y)
        .setSensor(true)
        .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
      const col = world.createCollider(cd, staticBody)
      this.sensorKindByHandle.set(col.handle, 'warp')
      warpG
        .roundRect(z.x - z.halfW, z.y - z.halfH, z.halfW * 2, z.halfH * 2, 10)
        .fill({ color: 0x7c3aed, alpha: 0.14 })
        .stroke({ color: 0x7c3aed, width: 2, alpha: 0.55 })
    }

    // Speed pad (하위 30% 가속 / 상위 10% 감속)
    const boost = { x: 640, y: 8420, halfW: 100, halfH: 16 } as const
    const boostCd = this.R.ColliderDesc.cuboid(boost.halfW, boost.halfH)
      .setTranslation(boost.x, boost.y)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
    const boostCol = world.createCollider(boostCd, staticBody)
    this.sensorKindByHandle.set(boostCol.handle, 'boost')
    const boostG = new this.PIXI.Graphics()
      .roundRect(boost.x - boost.halfW, boost.y - boost.halfH, boost.halfW * 2, boost.halfH * 2, 10)
      .fill({ color: 0x22d3ee, alpha: 0.12 })
      .stroke({ color: 0x22d3ee, width: 2, alpha: 0.55 })
    worldContainer.addChild(boostG)

    // Deceleration pad (everyone slows, leaders slow more)
    const slowPad = { x: 640, y: 7060, halfW: 140, halfH: 18 } as const
    const slowCd = this.R.ColliderDesc.cuboid(slowPad.halfW, slowPad.halfH)
      .setTranslation(slowPad.x, slowPad.y)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
    const slowCol = world.createCollider(slowCd, staticBody)
    this.sensorKindByHandle.set(slowCol.handle, 'slow')
    this.slowByHandle.set(slowCol.handle, {
      x: slowPad.x,
      y: slowPad.y,
      halfW: slowPad.halfW,
      halfH: slowPad.halfH,
      factor: 0.35,
      cooldownMs: ms('240ms'),
      lastAtMs: 0,
    })
    const slowG = new this.PIXI.Graphics()
      .roundRect(slowPad.x - slowPad.halfW, slowPad.y - slowPad.halfH, slowPad.halfW * 2, slowPad.halfH * 2, 10)
      .fill({ color: 0x60a5fa, alpha: 0.12 })
      .stroke({ color: 0x60a5fa, width: 2, alpha: 0.55 })
    worldContainer.addChild(slowG)

    // Magnet pit (leaders only): pulls top10 into a stall zone for a moment.
    // Place it away from jet bands so the effect reads clearly.
    const magnet = { x: 820, y: 5600, r: 160 } as const
    const magnetCd = this.R.ColliderDesc.ball(magnet.r)
      .setTranslation(magnet.x, magnet.y)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
    const magnetCol = world.createCollider(magnetCd, staticBody)
    this.sensorKindByHandle.set(magnetCol.handle, 'magnet')
    this.magnetByHandle.set(magnetCol.handle, {
      x: magnet.x,
      y: magnet.y,
      pullY: magnet.y - 240,
      radius: magnet.r,
      durationMs: ms('3s'),
      cooldownMs: ms('180ms'),
      lastAtMs: 0,
    })
    const magnetG = new this.PIXI.Graphics()
      .circle(magnet.x, magnet.y, magnet.r + 8)
      .fill({ color: 0x7c3aed, alpha: 0.06 })
      .circle(magnet.x, magnet.y, magnet.r)
      .stroke({ color: 0x7c3aed, width: 2, alpha: 0.5 })
    worldContainer.addChild(magnetG)

    // Bomb zone: occasional chaos burst (pinball-style).
    // Place it away from jet bands so it doesn't visually stack with the long horizontal gate.
    const bomb = { x: 1040, y: 7720, r: 140 } as const
    const bombCd = this.R.ColliderDesc.ball(bomb.r)
      .setTranslation(bomb.x, bomb.y)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
    const bombCol = world.createCollider(bombCd, staticBody)
    this.sensorKindByHandle.set(bombCol.handle, 'bomb')
    this.bombByHandle.set(bombCol.handle, {
      x: bomb.x,
      y: bomb.y,
      radius: bomb.r,
      power: 1200,
      cooldownMs: ms('700ms'),
      lastAtMs: 0,
    })
    const bombG = new this.PIXI.Graphics()
      .circle(bomb.x, bomb.y, bomb.r + 10)
      .fill({ color: 0xef4444, alpha: 0.06 })
      .circle(bomb.x, bomb.y, bomb.r)
      .stroke({ color: 0xef4444, width: 2, alpha: 0.55 })
    worldContainer.addChild(bombG)

    // Cup "hole" sensor near bottom
    const cupX = CUP_X
    const cupY = CUP_Y
    const cupR = 96
    const cupSensor = this.R.ColliderDesc.ball(cupR)
      .setTranslation(cupX, cupY)
      .setSensor(true)
      .setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS)
    const cupCol = world.createCollider(cupSensor, staticBody)
    this.sensorKindByHandle.set(cupCol.handle, 'cup')

    const cupG = new this.PIXI.Graphics()
      .circle(cupX, cupY, cupR + 10)
      .fill({ color: 0x09090b })
      .circle(cupX, cupY, cupR + 10)
      .stroke({ color: 0x3f3f46, width: 3 })
      .circle(cupX, cupY, cupR)
      .fill({ color: 0x000000 })
      .circle(cupX, cupY, cupR)
      .stroke({ color: 0x111827, width: 2 })
    worldContainer.addChild(cupG)
  }

  private spawnMarbles(participants: Participant[]) {
    if (!this.world || !this.staticBody || !this.worldContainer || !this.textures) return

    const spawn = computeSpawnPositions(participants.length)

    for (let i = 0; i < participants.length; i += 1) {
      const p = participants[i]
      const pos = spawn[i] ?? { x: WORLD_W / 2, y: 60 }
      const rb = this.R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setLinearDamping(0.32)
        .setAngularDamping(0.22)
      const body = this.world.createRigidBody(rb)

      const col = this.R.ColliderDesc.ball(MARBLE_R).setFriction(0.12).setRestitution(0.26).setDensity(0.9)
      const collider = this.world.createCollider(col, body)

      const display = new this.PIXI.Container()
      display.x = pos.x
      display.y = pos.y

      const ball = new this.PIXI.Sprite(this.textures.ball)
      ball.anchor.set(0.5)
      ball.tint = hexToPixiTint(p.colorHex)

      const ring = new this.PIXI.Sprite(this.textures.ring)
      ring.anchor.set(0.5)
      ring.tint = 0xffffff
      ring.alpha = 0.6
      ring.visible = false
      ring.blendMode = 'add'

      display.addChild(ring, ball)
      this.worldContainer.addChild(display)

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
        jetCooldownUntilMs: 0,
        bumpedAtMs: 0,
        lastMovedAtMs: performance.now(),
        stuckCooldownUntilMs: 0,
        rescueCount: 0,
        rescueCooldownUntilMs: 0,
        isEliminated: false,
        warpUsed: false,
        boostCooldownUntilMs: 0,
        kickerCooldownUntilMs: 0,
        magnetUntilMs: 0,
        magnetX: 0,
        magnetY: 0,
      }
      // Names on marbles: show 2-grapheme initials derived from the participant name.
      const label = maybeCreateLabel({ PIXI: this.PIXI, marble: m })
      label.visible = true
      this.marbles.push(m)
      this.marblesByCollider.set(collider.handle, m)
    }
  }
}
