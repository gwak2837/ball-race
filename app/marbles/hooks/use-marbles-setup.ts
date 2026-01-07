import { useState } from 'react';

import type { Participant } from '../participants';
import { buildParticipants, makeAutoNames, parseNamesFromTextarea } from '../participants';

export type SetupMode = 'paste' | 'auto';

type NamesInput = {
  setupMode: SetupMode;
  namesText: string;
  autoCount: number;
};

function getNames({ setupMode, namesText, autoCount }: NamesInput): string[] {
  if (setupMode === 'paste') {
    return parseNamesFromTextarea(namesText);
  }
  return makeAutoNames(autoCount);
}

export interface MarblesSetupModel {
  setupMode: SetupMode;
  setSetupMode: (v: SetupMode) => void;
  autoCount: number;
  setAutoCount: (v: number) => void;
  namesText: string;
  setNamesText: (v: string) => void;
  highlightName: string;
  setHighlightName: (v: string) => void;
  soundOn: boolean;
  setSoundOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  gravityY: number;
  setGravityY: (v: number) => void;
  minRoundSec: number;
  setMinRoundSec: (v: number) => void;
  participantsPreview: Participant[];
  getNames: () => string[];
}

export function useMarblesSetupModel(): MarblesSetupModel {
  const [setupMode, setSetupMode] = useState<SetupMode>('auto');
  const [autoCount, setAutoCount] = useState(1000);
  const [namesText, setNamesText] = useState('');
  const [highlightName, setHighlightName] = useState('');
  const [soundOn, setSoundOn] = useState(true);
  const [gravityY, setGravityY] = useState(1000);
  const [minRoundSec, setMinRoundSec] = useState(60);

  const names = getNames({ setupMode, namesText, autoCount });
  const participantsPreview = buildParticipants(names).slice(0, 12);

  function getNamesForStart() {
    return names;
  }

  return {
    setupMode,
    setSetupMode,
    autoCount,
    setAutoCount,
    namesText,
    setNamesText,
    highlightName,
    setHighlightName,
    soundOn,
    setSoundOn,
    gravityY,
    setGravityY,
    minRoundSec,
    setMinRoundSec,
    participantsPreview,
    getNames: getNamesForStart,
  };
}
