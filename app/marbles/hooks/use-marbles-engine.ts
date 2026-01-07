import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import ms from 'ms';

import type { Application as PixiApplication } from 'pixi.js';

import type { MarblesUiSnapshot } from '../marbles-game';
import { MarblesGame } from '../marbles-game';
import type { Participant } from '../participants';
import { MarblesSfx } from '../sfx';
import { VIEW_H, VIEW_W } from '../view';

export type MarblesClientPhase = 'setup' | 'running' | 'finished';

type PixiModule = typeof import('pixi.js');
type RapierModule = typeof import('@dimforge/rapier2d-compat');

type IdleSceneInput = {
  PIXI: PixiModule;
  app: PixiApplication;
};

export type MarblesEngineStartInput = {
  participants: Participant[];
  highlightName: string;
  soundOn: boolean;
  gravityY: number;
  minRoundSec: number;
};

function drawIdleScene({ PIXI, app }: IdleSceneInput) {
  app.stage.removeChildren();

  const g = new PIXI.Graphics()
    .roundRect(0, 0, VIEW_W, VIEW_H, 24)
    .fill({ color: 0x0b0b0c })
    .stroke({ color: 0x2a2a2a, width: 2 });

  const title = new PIXI.Text({
    text: '구슬 레이스예요',
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 32,
      fill: 0xffffff,
    },
  });

  title.x = 64;
  title.y = 64;

  const sub = new PIXI.Text({
    text: '왼쪽에서 참가자를 설정하고 시작해 주세요.',
    style: {
      fontFamily: 'var(--font-geist-sans)',
      fontSize: 18,
      fill: 0x9ca3af,
    },
  });

  sub.x = 64;
  sub.y = 112;
  app.stage.addChild(g, title, sub);
}

function mapGamePhaseToClientPhase(phase: MarblesUiSnapshot['phase']): MarblesClientPhase {
  if (phase === 'running') {
    return 'running';
  }
  if (phase === 'finished') {
    return 'finished';
  }
  return 'setup';
}

export interface MarblesEngineModel {
  canvasWrapRef: RefObject<HTMLDivElement | null>;
  canStart: boolean;
  phase: MarblesClientPhase;
  uiSnap: MarblesUiSnapshot | null;
  start: (input: MarblesEngineStartInput) => void;
  reset: () => void;
  focusByName: (name: string) => boolean;
  panCameraBy: (dx: number, dy: number) => void;
  jumpCameraTo: (x: number, y: number, durationMs: number) => void;
  setHighlightName: (name: string) => void;
}

export function useMarblesEngine(): MarblesEngineModel {
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const pixiAppRef = useRef<PixiApplication | null>(null);
  const pixiRef = useRef<PixiModule | null>(null);
  const rapierRef = useRef<RapierModule | null>(null);
  const gameRef = useRef<MarblesGame | null>(null);
  const sfxRef = useRef<MarblesSfx | null>(null);

  const [isClientReady, setIsClientReady] = useState(false);
  const [isWasmReady, setIsWasmReady] = useState(false);
  const [isPixiReady, setIsPixiReady] = useState(false);
  const [uiSnap, setUiSnap] = useState<MarblesUiSnapshot | null>(null);
  const [phase, setPhase] = useState<MarblesClientPhase>('setup');

  function reset() {
    const app = pixiAppRef.current;
    const PIXI = pixiRef.current;
    gameRef.current?.destroy();
    gameRef.current = null;
    setUiSnap(null);
    setPhase('setup');

    if (app && PIXI) {
      drawIdleScene({ app, PIXI });
    }
  }

  function start({ participants, highlightName, soundOn, gravityY, minRoundSec }: MarblesEngineStartInput) {
    const app = pixiAppRef.current;
    const PIXI = pixiRef.current;
    const R = rapierRef.current;

    if (!app || !PIXI || !R) {
      return;
    }

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
      participants: participants.slice(0, 1000),
      highlightName,
      sfx,
      gravityY,
      minRoundMs: ms(`${minRoundSec}s`),
      onUi: (snap) => {
        setUiSnap(snap);
        setPhase(mapGamePhaseToClientPhase(snap.phase));
      },
    });
  }

  function focusByName(name: string): boolean {
    return gameRef.current?.focusByName(name) ?? false;
  }

  function panCameraBy(dx: number, dy: number) {
    gameRef.current?.panCameraBy(dx, dy);
  }

  function jumpCameraTo(x: number, y: number, durationMs: number) {
    gameRef.current?.jumpCameraTo(x, y, durationMs);
  }

  function setHighlightName(name: string) {
    gameRef.current?.setHighlightName(name);
  }

  // NOTE: 클라이언트 준비 상태를 표시해요(이 훅은 클라이언트에서만 실행되지만, UI 게이팅을 위해 플래그를 둬요).
  useEffect(() => {
    setIsClientReady(true);
  }, []);

  // NOTE: Rapier WASM을 1회 로드/초기화하고 모듈 ref로 보관해요
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
      setIsWasmReady(false);
    };
  }, []);

  // NOTE: Pixi(canvas + renderer)를 1회 마운트하고 언마운트 시 정리해요
  useEffect(() => {
    let cancelled = false;
    async function mountPixi() {
      const wrap = canvasWrapRef.current;
      if (!wrap) {
        return;
      }

      const PIXI = await import('pixi.js');
      const app = new PIXI.Application();
      await app.init({
        width: VIEW_W,
        height: VIEW_H,
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
      setIsPixiReady(true);

      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.display = 'block';
      wrap.replaceChildren(app.canvas);
      drawIdleScene({ PIXI, app });
    }

    void mountPixi();
    return () => {
      cancelled = true;
      setIsPixiReady(false);
      gameRef.current?.destroy();
      gameRef.current = null;
      sfxRef.current?.dispose();
      sfxRef.current = null;
      pixiAppRef.current?.destroy(true);
      pixiAppRef.current = null;
      pixiRef.current = null;
    };
  }, []);

  return {
    canvasWrapRef,
    canStart: isClientReady && isWasmReady && isPixiReady,
    phase,
    uiSnap,
    start,
    reset,
    focusByName,
    panCameraBy,
    jumpCameraTo,
    setHighlightName,
  };
}
