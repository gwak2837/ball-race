'use client'

import { sendGAEvent } from '@next/third-parties/google'

import { NEXT_PUBLIC_GA_ID } from '@/src/constant/env'

type UiClickTarget = 'start' | 'reset' | 'setup_mode_auto' | 'setup_mode_paste' | 'focus' | 'sound_toggle'

type UiClickParams =
  | { target: 'sound_toggle'; next: 'on' | 'off' }
  | { target: 'focus'; ok: 0 | 1 }
  | { target: Exclude<UiClickTarget, 'sound_toggle' | 'focus'> }

type GameStartParams = {
  participants_count: number
  has_highlight: 0 | 1
  sound_on: 0 | 1
  gravity_y: number
  min_round_sec: number
}

type GameCompleteParams = {
  elapsed_sec: number
  total_count: number
  finished_count: number
  eliminated_count: number
}

type GaEventParamsMap = {
  ui_click: UiClickParams
  game_start: GameStartParams
  game_complete: GameCompleteParams
}

type GaEventName = keyof GaEventParamsMap

export function trackGAEvent<Name extends GaEventName>(name: Name, params: GaEventParamsMap[Name]): void {
  if (typeof NEXT_PUBLIC_GA_ID === 'string' && NEXT_PUBLIC_GA_ID.length > 0) {
    sendGAEvent('event', name, params)
  }
}
