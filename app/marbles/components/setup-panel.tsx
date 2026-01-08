import type { ChangeEvent } from 'react'
import { useState } from 'react'

import ms from 'ms'

import { trackGAEvent } from '@/src/lib/analytics/ga'

import type { MarblesEngineModel } from '../hooks/use-marbles-engine'
import type { MarblesSetupModel } from '../hooks/use-marbles-setup'

export interface SetupPanelProps {
  setup: MarblesSetupModel
  engine: Pick<MarblesEngineModel, 'canStart' | 'phase' | 'uiSnap' | 'reset' | 'focusByName' | 'setHighlightName'>
  onStart: () => void
}

export function SetupPanel({ setup, engine, onStart }: SetupPanelProps) {
  const {
    setupMode,
    autoCount,
    namesText,
    highlightName,
    soundOn,
    gravityY,
    minRoundSec,
    participantsPreview,
    setSetupMode,
    setAutoCount,
    setNamesText,
    setHighlightName: setSetupHighlightName,
    setSoundOn,
    setGravityY,
    setMinRoundSec,
  } = setup

  const { canStart, phase, uiSnap, reset, focusByName, setHighlightName: setEngineHighlightName } = engine
  const [focusFeedback, setFocusFeedback] = useState<string | null>(null)

  function onSelectAutoMode() {
    setSetupMode('auto')
    trackGAEvent('ui_click', { target: 'setup_mode_auto' })
  }

  function onSelectPasteMode() {
    setSetupMode('paste')
    trackGAEvent('ui_click', { target: 'setup_mode_paste' })
  }

  function onAutoCountChange(e: ChangeEvent<HTMLInputElement>) {
    setAutoCount(Math.max(1, Math.min(1000, Number(e.target.value || 0))))
  }

  function onNamesTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setNamesText(e.target.value)
  }

  function onHighlightNameChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setSetupHighlightName(next)
    setEngineHighlightName(next)
  }

  function onClickFocus() {
    const ok = focusByName(highlightName)
    trackGAEvent('ui_click', { target: 'focus', ok: ok ? 1 : 0 })
    setFocusFeedback(ok ? '포커스했어요' : '찾을 수 없어요')
    window.setTimeout(() => setFocusFeedback(null), ms('2s'))
  }

  function onToggleSound() {
    trackGAEvent('ui_click', { target: 'sound_toggle', next: soundOn ? 'off' : 'on' })
    setSoundOn((v) => !v)
  }

  function onGravityChange(e: ChangeEvent<HTMLInputElement>) {
    setGravityY(Number(e.target.value))
  }

  function onMinRoundSecChange(e: ChangeEvent<HTMLInputElement>) {
    setMinRoundSec(Number(e.target.value))
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">참가자 설정</h2>
        <span aria-live="polite" className="text-xs text-zinc-400" data-ready={canStart}>
          {canStart ? '시작할 수 있어요' : '레이스 화면 준비 중이에요…'}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-full border border-white/10 px-3 py-1 text-sm aria-pressed:border-white/30 aria-pressed:bg-white/5"
          aria-pressed={setupMode === 'auto'}
          onClick={onSelectAutoMode}
        >
          자동 생성
        </button>
        <button
          type="button"
          className="rounded-full border border-white/10 px-3 py-1 text-sm aria-pressed:border-white/30 aria-pressed:bg-white/5"
          aria-pressed={setupMode === 'paste'}
          onClick={onSelectPasteMode}
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
            onChange={onAutoCountChange}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-2">
          <span className="text-sm text-zinc-300">닉네임을 줄바꿈으로 붙여 넣어 주세요</span>
          <textarea
            className="min-h-40 resize-y rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm leading-6 outline-none focus:border-white/30"
            placeholder={'예)\n치즈\n고양이\n참가자0007'}
            value={namesText}
            onChange={onNamesTextChange}
          />
        </label>
      )}

      <label className="flex flex-col gap-2">
        <span className="text-sm text-zinc-300">강조 닉네임(후광 + Top10 강조예요)</span>
        <div className="flex gap-2">
          <input
            className="h-10 flex-1 rounded-xl border border-white/10 bg-zinc-950 px-3 text-sm outline-none focus:border-white/30"
            placeholder="예: 치즈"
            value={highlightName}
            onChange={onHighlightNameChange}
          />
          <button
            type="button"
            className="h-10 rounded-xl border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-40"
            disabled={phase !== 'running'}
            onClick={onClickFocus}
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
          onClick={onToggleSound}
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
          onChange={onGravityChange}
        />
        <div className="text-xs text-zinc-500">너무 빠르면 낮추고, 답답하면 올려 주세요.</div>
      </label>

      <label className="flex flex-col gap-2 rounded-xl border border-white/10 bg-zinc-950 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-300">자동 종료 최소 시간</div>
          <div className="text-xs tabular-nums text-zinc-400">{minRoundSec}초</div>
        </div>
        <input
          className="w-full accent-white"
          type="range"
          min={10}
          max={180}
          step={5}
          value={minRoundSec}
          disabled={phase === 'running'}
          onChange={onMinRoundSecChange}
        />
        <div className="text-xs text-zinc-500">이 시간 전에는 완주가 나와도 끝나지 않아요.</div>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          className="h-11 flex-1 rounded-xl bg-white text-sm font-medium text-zinc-950 disabled:opacity-40"
          disabled={!canStart || phase === 'running'}
          onClick={onStart}
        >
          시작할게요
        </button>
        <button
          type="button"
          className="h-11 rounded-xl border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-40"
          disabled={phase === 'setup'}
          onClick={reset}
        >
          리셋
        </button>
      </div>

      {uiSnap ? (
        <div className="mt-2 rounded-2xl border border-white/10 bg-zinc-950 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Top 10</div>
            <div className="text-xs text-zinc-400">
              남은 {uiSnap.aliveCount.toLocaleString()} / 완주 {uiSnap.finishedCount.toLocaleString()} / 탈락{' '}
              {uiSnap.eliminatedCount.toLocaleString()}
            </div>
          </div>
          {uiSnap.eliminatedBy ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <div>낙사 {uiSnap.eliminatedBy.fall.toLocaleString()}</div>
              <div>컷 {uiSnap.eliminatedBy.cut.toLocaleString()}</div>
              <div className="text-zinc-500">경과 {Math.max(0, Math.round(uiSnap.elapsedMs / ms('1s')))}초</div>
            </div>
          ) : null}
          {/* Reserve ONE slot to avoid CLS when notices appear/disappear */}
          <div className="mt-2 min-h-16">
            {uiSnap.slowMo && uiSnap.slowMo.remainingMs > 0 ? (
              <div className="rounded-xl border border-amber-200/10 bg-amber-400/10 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-amber-200">골든 모먼트예요</div>
                  <div className="text-xs tabular-nums text-amber-100/80">
                    {Math.max(0, Math.ceil(uiSnap.slowMo.remainingMs / ms('1s')))}초
                  </div>
                </div>
                <div className="mt-1 text-xs text-amber-100/70">결승 직전 초근접 경합이에요.</div>
              </div>
            ) : uiSnap.cut ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
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
            ) : uiSnap.fastForward && uiSnap.fastForward.scale > 1 ? (
              <div className="rounded-xl border border-sky-200/10 bg-sky-400/10 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sky-200">빨리감기예요</div>
                  <div className="text-xs tabular-nums text-sky-100/80">×{uiSnap.fastForward.scale}</div>
                </div>
                <div className="mt-1 text-xs text-sky-100/70">Top10이 나와서 빠르게 마무리 중이에요.</div>
              </div>
            ) : (
              <div className="h-16 rounded-xl border border-white/10 bg-white/0" />
            )}
          </div>
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
                    {r.isHighlighted ? ' (강조)' : ''}
                  </span>
                </div>
                <span
                  className={[
                    'w-10 text-right text-xs font-semibold tabular-nums',
                    uiSnap.winner?.id === r.id
                      ? 'text-emerald-300'
                      : r.didFinish
                        ? 'text-emerald-200'
                        : 'text-transparent',
                  ].join(' ')}
                >
                  {uiSnap.winner?.id === r.id ? '우승' : r.didFinish ? '완주' : '완주'}
                </span>
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
        <div className="text-xs text-zinc-400">참가자 미리보기 (최대 12명까지)</div>
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
  )
}
