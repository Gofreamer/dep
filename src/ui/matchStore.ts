import { create } from 'zustand';
import type { ChoiceRequest, LegalActions, MatchState, PlayerId } from '../engine/types';
import type { Cue } from '../game/controller';

/**
 * UI-side mirror of the match. The engine remains the single source of truth;
 * this store only tracks what the view needs (version, pending choice, cues).
 */
interface MatchUiState {
  version: number;
  stateRef: MatchState | null;
  pending: ChoiceRequest | null;
  legal: LegalActions | null;
  cues: Cue[];
  inspectUid: string | null;
  targetingFrom: string | null;   // hand card awaiting a target
  showLog: boolean;
  showDebug: boolean;
  paused: boolean;
  tutorial: { active: boolean; step: number; title: string; text: string } | null;

  sync: (version: number, state: MatchState, legal: LegalActions, pending: ChoiceRequest | null) => void;
  pushCue: (cue: Cue) => void;
  dropCue: (id: number) => void;
  setInspect: (uid: string | null) => void;
  setTargeting: (uid: string | null) => void;
  toggleLog: () => void;
  toggleDebug: () => void;
  setPaused: (v: boolean) => void;
  setTutorial: (t: MatchUiState['tutorial']) => void;
  reset: () => void;
}

let cueSeq = 1;

export const useMatch = create<MatchUiState>((set) => ({
  version: 0,
  stateRef: null,
  pending: null,
  legal: null,
  cues: [],
  inspectUid: null,
  targetingFrom: null,
  showLog: false,
  showDebug: false,
  paused: false,
  tutorial: null,

  sync: (version, state, legal, pending) => set({ version, stateRef: state, legal, pending }),
  pushCue: (cue) => set((s) => ({ cues: [...s.cues, { ...cue, id: cue.id ?? cueSeq++ }].slice(-24) })),
  dropCue: (id) => set((s) => ({ cues: s.cues.filter((c) => c.id !== id) })),
  setInspect: (uid) => set({ inspectUid: uid }),
  setTargeting: (uid) => set({ targetingFrom: uid }),
  toggleLog: () => set((s) => ({ showLog: !s.showLog })),
  toggleDebug: () => set((s) => ({ showDebug: !s.showDebug })),
  setPaused: (v) => set({ paused: v }),
  setTutorial: (t) => set({ tutorial: t }),
  reset: () => set({ version: 0, stateRef: null, pending: null, legal: null, cues: [], inspectUid: null, targetingFrom: null, showLog: false, showDebug: false, paused: false, tutorial: null })
}));

export function sideName(state: MatchState, p: PlayerId): string {
  return state.players[p].name;
}
