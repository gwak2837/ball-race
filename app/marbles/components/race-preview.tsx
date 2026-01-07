import type { MouseEvent, PointerEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import ms from 'ms';

import type { MarblesClientPhase } from '../hooks/use-marbles-engine';
import type { MarblesUiSnapshot } from '../marbles-game';
import { VIEW_H, VIEW_W } from '../view';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export interface RacePreviewModel {
  phase: MarblesClientPhase;
  uiSnap: MarblesUiSnapshot | null;
  canvasWrapRef: RefObject<HTMLDivElement | null>;
  panCameraBy: (dx: number, dy: number) => void;
  jumpCameraTo: (x: number, y: number, durationMs: number) => void;
}

interface DragState {
  active: boolean;
  pointerId: number;
  lastX: number;
  lastY: number;
}

export interface RacePreviewProps {
  race: RacePreviewModel;
}

export function RacePreview({ race }: RacePreviewProps) {
  const { phase, uiSnap, canvasWrapRef, panCameraBy, jumpCameraTo } = race;
  const videoShellRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef<DragState | undefined>(undefined);
  const world = uiSnap?.world;
  const cam = uiSnap?.camera;

  function stopPropagation(e: { stopPropagation: () => void }) {
    e.stopPropagation();
  }

  function onDragPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (phase !== 'running') {
      return;
    }
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDragPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d?.active || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    // Dragging the view: move camera opposite the pointer delta.
    panCameraBy(-dx, -dy);
  }

  function onDragPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) {
      return;
    }
    dragRef.current = undefined;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onDragPointerCancel() {
    dragRef.current = undefined;
  }

  async function onToggleFullscreen() {
    const el = videoShellRef.current;
    if (!el) {
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await el.requestFullscreen();
  }

  function onMinimapClick(e: MouseEvent<HTMLButtonElement>) {
    if (!world) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const worldX = nx * world.w;
    const worldY = ny * world.h;
    const targetX = worldX - world.screenW / 2;
    const targetY = worldY - world.screenH / 2;
    jumpCameraTo(targetX, targetY, ms('4s'));
  }

  // NOTE: 브라우저 fullscreen 상태(외부 시스템)를 React UI 상태와 동기화해요
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    onFsChange();

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">레이스 화면</h2>
        <div className="text-xs text-zinc-400">
          {VIEW_W}×{VIEW_H} 내부 해상도
        </div>
      </div>

      <div
        className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black"
        ref={videoShellRef}
        style={{ touchAction: 'none' }}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerCancel}
      >
        <div className="absolute inset-0" ref={canvasWrapRef} />

        <div className="absolute right-3 top-3 flex gap-2">
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-1 text-xs text-zinc-200 backdrop-blur"
            onPointerDown={stopPropagation}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? '전체화면 종료' : '전체화면'}
          </button>
        </div>

        {world && cam ? (
          <details className="group absolute bottom-3 right-3" onPointerDown={stopPropagation}>
            <summary className="list-none [&::-webkit-details-marker]:hidden">
              <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-black/55 px-3 text-xs font-medium text-zinc-200 backdrop-blur">
                미니맵
                <span className="text-[10px] text-zinc-400 group-open:hidden">열기</span>
                <span className="text-[10px] text-zinc-400 hidden group-open:inline">닫기</span>
              </span>
            </summary>
            <div className="mt-2 w-[172px] rounded-xl border border-white/10 bg-black/55 p-2 backdrop-blur">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-zinc-200">클릭 포커스예요</div>
                <div className="text-[10px] text-zinc-400">{Math.round(ms('4s') / 1000)}초</div>
              </div>
              <button
                type="button"
                className="relative mt-2 block w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-950"
                style={{ aspectRatio: '3 / 5' }}
                onPointerDown={stopPropagation}
                onClick={onMinimapClick}
              >
                <div className="absolute inset-0 bg-linear-to-b from-white/0 via-white/0 to-white/5" />
                {/* Viewport */}
                <div
                  className="absolute rounded border border-emerald-300/60 bg-emerald-300/5"
                  style={{
                    left: `${(cam.x / world.w) * 100}%`,
                    top: `${(cam.y / world.h) * 100}%`,
                    width: `${(world.screenW / world.w) * 100}%`,
                    height: `${(world.screenH / world.h) * 100}%`,
                  }}
                />
                {/* Finish cup marker (approx) */}
                <div
                  className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white/30"
                  style={{ bottom: `${(120 / world.h) * 100}%` }}
                />
              </button>
            </div>
          </details>
        ) : null}

        {uiSnap?.cut ? (
          <div className="pointer-events-none absolute left-1/2 top-4 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col">
                <div className="text-sm font-medium text-zinc-200">
                  체크포인트 {uiSnap.cut.checkpointNumber} 컷이에요
                </div>
                <div className="text-xs text-zinc-400">
                  하위 {uiSnap.cut.cutCount.toLocaleString()}명이 컷될 거예요.
                </div>
              </div>
              <div className="text-3xl font-semibold tabular-nums tracking-tight text-white">
                {Math.max(0, Math.ceil(uiSnap.cut.remainingMs / ms('1s')))}
              </div>
            </div>
          </div>
        ) : null}

        {uiSnap?.slowMo && uiSnap.slowMo.remainingMs > 0 ? (
          <div className="pointer-events-none absolute left-1/2 top-4 w-[min(520px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border border-amber-200/10 bg-amber-400/10 px-4 py-3 backdrop-blur">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col">
                <div className="text-sm font-semibold text-amber-200">골든 모먼트예요</div>
                <div className="text-xs text-amber-100/70">결승 직전 초근접 경합이에요.</div>
              </div>
              <div className="text-2xl font-semibold tabular-nums tracking-tight text-amber-100">
                {Math.max(0, Math.ceil(uiSnap.slowMo.remainingMs / ms('1s')))}
              </div>
            </div>
          </div>
        ) : null}

        {phase === 'running' && uiSnap?.fastForward && uiSnap.fastForward.scale > 1 ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-2xl border border-sky-200/10 bg-sky-400/10 px-3 py-2 text-xs text-sky-100/90 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sky-200">빨리감기예요</span>
              <span className="tabular-nums text-sky-100/80">×{uiSnap.fastForward.scale}</span>
            </div>
          </div>
        ) : null}

        {uiSnap?.focus ? (
          <div className="pointer-events-none absolute bottom-4 left-4 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 text-sm backdrop-blur">
            <div className="text-zinc-200">
              <span className="font-medium">{uiSnap.focus.name}</span>님 포커스 중이에요
            </div>
            <div className="text-xs tabular-nums text-zinc-400">
              {Math.max(0, Math.ceil(uiSnap.focus.remainingMs / ms('1s')))}초
            </div>
          </div>
        ) : null}

        {phase === 'finished' && uiSnap?.winner && uiSnap.postFinish && uiSnap.postFinish.remainingMs > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex items-center justify-center">
            <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-zinc-200 backdrop-blur">
              <span className="font-medium" style={{ color: uiSnap.winner.colorHex }}>
                {uiSnap.winner.name}
              </span>
              님이 들어갔어요. 잠깐만 더 볼게요.
            </div>
          </div>
        ) : null}

        {phase === 'finished' && uiSnap?.winner && (!uiSnap.postFinish || uiSnap.postFinish.remainingMs <= 0) ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="w-[min(720px,calc(100%-32px))] rounded-3xl border border-white/10 bg-black/70 px-6 py-6 text-center backdrop-blur">
              <div className="text-sm font-medium text-zinc-300">우승</div>
              <div className="mt-2 text-4xl font-semibold tracking-tight" style={{ color: uiSnap.winner.colorHex }}>
                {uiSnap.winner.name}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {uiSnap.top10.slice(0, 3).map((r) => (
                  <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                    <div className="text-xs text-zinc-400">{r.rank}위</div>
                    <div className="mt-1 truncate text-sm font-medium" style={{ color: r.colorHex }}>
                      {r.name}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm text-zinc-400">다시 하려면 왼쪽에서 리셋을 눌러 주세요.</div>
            </div>
          </div>
        ) : null}
      </div>

      <p className="text-sm leading-6 text-zinc-400">
        {phase === 'setup'
          ? '시작을 누르면 바로 1,000개 구슬이 떨어져요.'
          : phase === 'running'
          ? '지금은 컷/워프/가속/슬로모션까지 들어가 있어요. 다음은 사운드랑 더 강한 연출이에요.'
          : 'Top3 시상식까지 보여줘요. 다음은 사운드/주스예요.'}
      </p>
    </section>
  );
}
