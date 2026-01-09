'use client'

import { trackGAEvent } from '@/src/lib/analytics/ga'
import { RacePreview } from './components/race-preview'
import { SetupPanel } from './components/setup-panel'
import { useMarblesEngine } from './hooks/use-marbles-engine'
import { useMarblesSetupModel } from './hooks/use-marbles-setup'
import { buildParticipants } from './participants'

export function MarblesClient() {
  const setup = useMarblesSetupModel()
  const engine = useMarblesEngine()
  const { getNames, gravityY, highlightName, minRoundSec, soundOn } = setup
  const { phase, start } = engine

  function onStart() {
    trackGAEvent('ui_click', { target: 'start' })
    const names = getNames()
    const participants = buildParticipants(names).slice(0, 1000)

    start({
      participants,
      highlightName,
      soundOn,
      gravityY,
      minRoundSec,
    })
  }

  function onToggleSound(next: boolean) {
    setup.setSoundOn(next)
    engine.setSoundOn(next)
    trackGAEvent('ui_click', { target: 'sound_toggle', next: next ? 'on' : 'off' })
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">구슬 레이스</h1>
          <p className="text-sm leading-6 text-zinc-400">
            {phase === 'running'
              ? '지금 달리고 있어요.'
              : '최대 1,000명이 달리는 구슬 레이스예요. 참가자를 설정하고 바로 시작해 보세요.'}
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <SetupPanel setup={setup} engine={engine} onStart={onStart} />
          <RacePreview race={engine} soundOn={soundOn} onToggleSound={onToggleSound} />
        </div>
      </div>
    </div>
  )
}
