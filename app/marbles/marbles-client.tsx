'use client'

import ms from 'ms'

import { trackGAEvent } from '@/src/lib/analytics/ga'
import { RacePreview } from './components/race-preview'
import { SetupPanel } from './components/setup-panel'
import { useMarblesEngine } from './hooks/use-marbles-engine'
import { useMarblesSetupModel } from './hooks/use-marbles-setup'
import { buildParticipants } from './participants'

const CHECKPOINT_CUT_DELAY_MS = ms('3s')
const UI_HINT = `체크포인트 컷은 선두가 도착하면 ${Math.round(CHECKPOINT_CUT_DELAY_MS / 1000)}초 후에 발동돼요.`

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

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">구슬 레이스</h1>
          <p className="text-sm leading-6 text-zinc-400">{phase === 'running' ? '지금 달리고 있어요.' : UI_HINT}</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <SetupPanel setup={setup} engine={engine} onStart={onStart} />
          <RacePreview race={engine} />
        </div>
      </div>
    </div>
  )
}
