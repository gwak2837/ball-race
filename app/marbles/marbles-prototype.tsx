'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import ms from 'ms';

import type { MarblesUiSnapshot } from './marbles-game';
import { MarblesGame } from './marbles-game';
import type { Participant } from './participants';
import { buildParticipants, makeAutoNames, parseNamesFromTextarea } from './participants';
import { MarblesSfx } from './sfx';

type SetupMode = 'paste' | 'auto';

function getNames(args: { setupMode: SetupMode; namesText: string; autoCount: number }): string[] {
  if (args.setupMode === 'paste') return parseNamesFromTextarea(args.namesText);
  return makeAutoNames(args.autoCount);
}

function drawIdleScene(args: { PIXI: typeof import('pixi.js'); app: import('pixi.js').Application }) {
  args.app.stage.removeChildren();
  const g = new args.PIXI.Graphics()
    .roundRect(0, 0, 1280, 720, 24)
    .fill({ color: 0x0b0b0c })
    .stroke({ color: 0x2a2a2a, width: 2 });
  const title = new args.PIXI.Text({
    text: '구슬 레이스 프로토타입이에요',
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 32,
      fill: 0xffffff,
    },
  });
  title.x = 64;
  title.y = 64;
  const sub = new args.PIXI.Text({
    text: '왼쪽에서 참가자를 설정하고 시작해 주세요.',
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 18,
      fill: 0x9ca3af,
    },
  });
  sub.x = 64;
  sub.y = 112;
  args.app.stage.addChild(g, title, sub);
}

export function MarblesPrototype() {
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);
  const pixiAppRef = useRef<import('pixi.js').Application | null>(null);
  const pixiRef = useRef<typeof import('pixi.js') | null>(null);
  const rapierRef = useRef<typeof import('@dimforge/rapier2d-compat') | null>(null);
  const gameRef = useRef<MarblesGame | null>(null);
  const sfxRef = useRef<MarblesSfx | null>(null);

  const [isClientReady, setIsClientReady] = useState(false);
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>('auto');
  const [autoCount, setAutoCount] = useState(1000);
  const [namesText, setNamesText] = useState('');
  const [streamerPick, setStreamerPick] = useState('');
  const [uiSnap, setUiSnap] = useState<MarblesUiSnapshot | null>(null);
  const [phase, setPhase] = useState<'setup' | 'running' | 'finished'>('setup');
  const [focusFeedback, setFocusFeedback] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [gravityY, setGravityY] = useState(1000);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dragRef = useRef<
    | {
        active: boolean;
        pointerId: number;
        lastX: number;
        lastY: number;
      }
    | undefined
  >(undefined);

  const uiHint = useMemo(() => {
    const t = ms('3s');
    return `체크포인트 컷은 선두가 도착하면 ${Math.round(t / 1000)}초 후에 발동돼요.`;
  }, []);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWasm() {
      const R = await import('@dimforge/rapier2d-compat');
      await R.init();
      if (!cancelled) {
        rapierRef.current = R;
        setIsWasmReady(true);
      }
    }
    void loadWasm();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function mountPixi() {
      const wrap = canvasWrapRef.current;
      if (!wrap) return;
      const PIXI = await import('pixi.js');
      const app = new PIXI.Application();
      await app.init({
        width: 1280,
        height: 720,
        background: '#0a0a0a',
        backgroundAlpha: 1,
        clearBeforeRender: true,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
      });
      if (cancelled) {
        app.destroy(true);
        return;
      }
      pixiAppRef.current = app;
      pixiRef.current = PIXI;
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.display = 'block';
      wrap.replaceChildren(app.canvas);
      drawIdleScene({ PIXI, app });

      return () => {
        app.destroy(true);
      };
    }

    const cleanupPromise = mountPixi();
    return () => {
      cancelled = true;
      gameRef.current?.destroy();
      gameRef.current = null;
      sfxRef.current?.dispose();
      sfxRef.current = null;
      void cleanupPromise.then((cleanup) => cleanup?.());
      pixiAppRef.current = null;
      pixiRef.current = null;
    };
  }, []);

  const participantsPreview = useMemo(() => {
    const names = getNames({ setupMode, namesText, autoCount });
    return buildParticipants(names).slice(0, 12);
  }, [autoCount, namesText, setupMode]);

  const canStart = isClientReady && isWasmReady;

  useEffect(() => {
    gameRef.current?.setStreamerPickName(streamerPick);
  }, [streamerPick]);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFsChange);
    onFsChange();
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function resetToSetup() {
    const app = pixiAppRef.current;
    const PIXI = pixiRef.current;
    gameRef.current?.destroy();
    gameRef.current = null;
    setUiSnap(null);
    setPhase('setup');
    if (app && PIXI) drawIdleScene({ app, PIXI });
  }

  function startGame() {
    const app = pixiAppRef.current;
    const PIXI = pixiRef.current;
    const R = rapierRef.current;
    if (!app || !PIXI || !R) return;

    const names = getNames({ setupMode, namesText, autoCount });
    const participants: Participant[] = buildParticipants(names).slice(0, 1000);

    let sfx: MarblesSfx | null = null;
    if (soundOn) {
      const inst = sfxRef.current ?? new MarblesSfx();
      inst.enable();
      sfxRef.current = inst;
      sfx = inst;
    }

    const game = new MarblesGame({ app, PIXI, R });
    gameRef.current = game;
    setPhase('running');

    game.start({
      participants,
      streamerPickName: streamerPick,
      sfx,
      gravityY,
      onUi: (snap) => {
        setUiSnap(snap);
        setPhase(snap.phase === 'running' ? 'running' : snap.phase === 'finished' ? 'finished' : 'setup');
      },
    });
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">구슬 레이스 프로토타입</h1>
          <p className="text-sm leading-6 text-zinc-400">
            {uiHint} {phase === 'running' ? '지금 달리고 있어요.' : ''}
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">참가자 설정</h2>
              <span aria-live="polite" className="text-xs text-zinc-400" data-ready={canStart}>
                {canStart ? '준비됐어요' : '로딩 중이에요…'}
              </span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full border border-white/10 px-3 py-1 text-sm aria-pressed:border-white/30 aria-pressed:bg-white/5"
                aria-pressed={setupMode === 'auto'}
                onClick={() => setSetupMode('auto')}
              >
                자동 생성
              </button>
              <button
                type="button"
                className="rounded-full border border-white/10 px-3 py-1 text-sm aria-pressed:border-white/30 aria-pressed:bg-white/5"
                aria-pressed={setupMode === 'paste'}
                onClick={() => setSetupMode('paste')}
              >
                복붙 입력
              </button>
            </div>

            {setupMode === 'auto' ? (
              <label className="flex flex-col gap-2">
                <span className="text-sm text-zinc-300">자동 생성 인원(최대 1,000명)</span>
                <input
                  className="h-10 rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm outline-none focus:border-white/30"
                  type="number"
                  min={1}
                  max={1000}
                  value={autoCount}
                  onChange={(e) => setAutoCount(Math.max(1, Math.min(1000, Number(e.target.value || 0))))}
                />
              </label>
            ) : (
              <label className="flex flex-col gap-2">
                <span className="text-sm text-zinc-300">닉네임을 줄바꿈으로 붙여 넣어 주세요</span>
                <textarea
                  className="min-h-40 resize-y rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm leading-6 outline-none focus:border-white/30"
                  placeholder={'예)\n치즈\n고양이\n시청자0007'}
                  value={namesText}
                  onChange={(e) => setNamesText(e.target.value)}
                />
              </label>
            )}

            <label className="flex flex-col gap-2">
              <span className="text-sm text-zinc-300">스트리머 지정 닉네임(후광 + Top10 강조예요)</span>
              <div className="flex gap-2">
                <input
                  className="h-10 flex-1 rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm outline-none focus:border-white/30"
                  placeholder="예: 치즈"
                  value={streamerPick}
                  onChange={(e) => setStreamerPick(e.target.value)}
                />
                <button
                  type="button"
                  className="h-10 rounded-xl border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-40"
                  disabled={phase !== 'running'}
                  onClick={() => {
                    const ok = gameRef.current?.focusByName(streamerPick) ?? false;
                    setFocusFeedback(ok ? '포커스했어요' : '찾을 수 없어요');
                    window.setTimeout(() => setFocusFeedback(null), ms('2s'));
                  }}
                >
                  포커스
                </button>
              </div>
              {focusFeedback ? (
                <div className="text-xs text-zinc-400">{focusFeedback}</div>
              ) : (
                <div className="text-xs text-zinc-500">포커스는 몇 초만 보여주고 자동으로 돌아와요.</div>
              )}
            </label>

            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950 px-3 py-2">
              <div className="text-sm text-zinc-300">사운드</div>
              <button
                type="button"
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-200 aria-pressed:border-white/30 aria-pressed:bg-white/5"
                aria-pressed={soundOn}
                onClick={() => setSoundOn((v) => !v)}
              >
                {soundOn ? '켜짐' : '꺼짐'}
              </button>
            </div>

            <label className="flex flex-col gap-2 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-300">중력</div>
                <div className="text-xs tabular-nums text-zinc-400">{gravityY}</div>
              </div>
              <input
                className="w-full accent-white"
                type="range"
                min={500}
                max={1500}
                step={25}
                value={gravityY}
                disabled={phase === 'running'}
                onChange={(e) => setGravityY(Number(e.target.value))}
              />
              <div className="text-xs text-zinc-500">너무 빠르면 낮추고, 답답하면 올려 주세요.</div>
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                className="h-11 flex-1 rounded-xl bg-white text-sm font-medium text-zinc-950 disabled:opacity-40"
                disabled={!canStart || phase === 'running'}
                onClick={startGame}
              >
                시작할게요
              </button>
              <button
                type="button"
                className="h-11 rounded-xl border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-40"
                disabled={phase === 'setup'}
                onClick={resetToSetup}
              >
                리셋
              </button>
            </div>

            {uiSnap ? (
              <div className="mt-2 rounded-2xl border border-white/10 bg-zinc-950 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Top 10</div>
                  <div className="text-xs text-zinc-400">
                    생존 {uiSnap.aliveCount.toLocaleString()} / 탈락 {uiSnap.eliminatedCount.toLocaleString()}
                  </div>
                </div>
                {uiSnap.eliminatedBy ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                    <div>낙사 {uiSnap.eliminatedBy.fall.toLocaleString()}</div>
                    <div>컷 {uiSnap.eliminatedBy.cut.toLocaleString()}</div>
                    <div className="text-zinc-500">경과 {Math.max(0, Math.round(uiSnap.elapsedMs / ms('1s')))}초</div>
                  </div>
                ) : null}
                {uiSnap.cut ? (
                  <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-zinc-200">체크포인트 {uiSnap.cut.checkpointNumber} 컷이에요</div>
                      <div className="text-xs tabular-nums text-zinc-300">
                        {Math.max(0, Math.ceil(uiSnap.cut.remainingMs / ms('1s')))}초
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      하위 {uiSnap.cut.cutCount.toLocaleString()}명이 컷될 거예요.
                    </div>
                  </div>
                ) : null}
                {uiSnap.slowMo && uiSnap.slowMo.remainingMs > 0 ? (
                  <div className="mt-2 rounded-xl border border-amber-200/10 bg-amber-400/10 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-amber-200">골든 모먼트예요</div>
                      <div className="text-xs tabular-nums text-amber-100/80">
                        {Math.max(0, Math.ceil(uiSnap.slowMo.remainingMs / ms('1s')))}초
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-amber-100/70">결승 직전 초근접 경합이에요.</div>
                  </div>
                ) : null}
                <ol className="mt-2 flex flex-col gap-1">
                  {uiSnap.top10.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-1 text-sm data-[selected=true]:bg-white/5"
                      data-selected={r.isFocusTarget}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-5 text-xs tabular-nums text-zinc-400">{r.rank}</span>
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.colorHex }} />
                        <span className="truncate">
                          {r.name}
                          {r.isStreamerPick ? ' (스트리머)' : ''}
                        </span>
                      </div>
                      {uiSnap.winner?.id === r.id ? (
                        <span className="text-xs font-semibold text-emerald-300">우승</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {uiSnap.winner ? (
                  <div className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm">
                    <span className="text-zinc-300">우승은 </span>
                    <span className="font-semibold" style={{ color: uiSnap.winner.colorHex }}>
                      {uiSnap.winner.name}
                    </span>
                    <span className="text-zinc-300"> 님이에요.</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-2 flex flex-col gap-2">
              <div className="text-xs text-zinc-400">미리보기(일부)</div>
              <ul className="grid grid-cols-3 gap-2">
                {participantsPreview.map((p) => (
                  <li key={p.id} className="rounded-xl border border-white/10 bg-zinc-950 px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-zinc-950"
                        style={{ backgroundColor: p.colorHex }}
                      >
                        {p.initials}
                      </span>
                      <span className="truncate text-xs text-zinc-200">{p.name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">프리뷰(16:9)</h2>
              <div className="text-xs text-zinc-400">1280×720 내부 해상도로 고정돼요</div>
            </div>
            <div
              className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black"
              ref={videoShellRef}
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                if (phase !== 'running') return;
                dragRef.current = {
                  active: true,
                  pointerId: e.pointerId,
                  lastX: e.clientX,
                  lastY: e.clientY,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d?.active || d.pointerId !== e.pointerId) return;
                const dx = e.clientX - d.lastX;
                const dy = e.clientY - d.lastY;
                d.lastX = e.clientX;
                d.lastY = e.clientY;
                // Dragging the view: move camera opposite the pointer delta.
                gameRef.current?.panCameraBy(-dx, -dy);
              }}
              onPointerUp={(e) => {
                const d = dragRef.current;
                if (!d || d.pointerId !== e.pointerId) return;
                dragRef.current = undefined;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onPointerCancel={() => {
                dragRef.current = undefined;
              }}
            >
              <div className="absolute inset-0" ref={canvasWrapRef} />

              <div className="absolute right-3 top-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-black/40 px-3 py-1 text-xs text-zinc-200 backdrop-blur"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={async () => {
                    const el = videoShellRef.current;
                    if (!el) return;
                    if (document.fullscreenElement) {
                      await document.exitFullscreen();
                      return;
                    }
                    await el.requestFullscreen();
                  }}
                >
                  {isFullscreen ? '전체화면 종료' : '전체화면'}
                </button>
              </div>

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
                    <div
                      className="mt-2 text-4xl font-semibold tracking-tight"
                      style={{ color: uiSnap.winner.colorHex }}
                    >
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
        </div>
      </div>
    </div>
  );
}
