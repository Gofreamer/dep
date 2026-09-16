/**
 * AI PROFILES — níveis de habilidade reais sobre a MESMA engine.
 *
 * A IA nunca trapaceia: nenhum perfil pode ver mão/deck order do oponente,
 * controlar RNG, receber Energia grátis, ignorar custo ou usar informação
 * privada. Os parâmetros apenas modulam PESOS de avaliação sobre o estado
 * PÚBLICO + a profundidade do lookahead determinístico (seeded).
 */

import type { AiLevel } from '../types';

export interface AiProfile {
  id: string;
  label: string;
  /** 0..1 — peso em causar dano/pressionar cedo. */
  aggression: number;
  /** 0..1 — aceitar risco calculado (selfDamage, all-in). */
  riskTolerance: number;
  /** 0..1 — poupar recursos (não gastar Energia à toa, guardar para setup). */
  resourcePreservation: number;
  /** 0..1 — planejamento futuro (desenvolvimento de reserva/energia). */
  futurePlanning: number;
  /** peso do ritmo (recuo/troca de ativo). */
  tempoWeight: number;
  /** peso da detecção de lethal. */
  lethalWeight: number;
  /** peso do desenvolvimento de board (reserva). */
  boardWeight: number;
  /** 0..1 — probabilidade de escolher uma jogada subótima (seeded). */
  blunderRate: number;
  /** 0 | 1 | 2 — profundidade do lookahead determinístico (0 = heurística). */
  searchDepth: number;
  /** quantas jogadas candidatas o lookahead avalia (beam). */
  beamWidth: number;
  /** conhecimento de matchup 0..1 (bias de preservar a resposta certa). */
  matchupKnowledge: number;
  /** orçamento de tempo por decisão (ms) — nunca congela o browser. */
  timeBudgetMs: number;
}

export const PROFILE_LEVELS: Record<AiLevel, AiProfile> = {
  easy: {
    id: 'easy', label: 'Casual', aggression: 0.55, riskTolerance: 0.3, resourcePreservation: 0.2,
    futurePlanning: 0.15, tempoWeight: 0.4, lethalWeight: 0.5, boardWeight: 0.4,
    blunderRate: 0.28, searchDepth: 0, beamWidth: 4, matchupKnowledge: 0, timeBudgetMs: 40
  },
  normal: {
    id: 'normal', label: 'Normal', aggression: 0.7, riskTolerance: 0.5, resourcePreservation: 0.45,
    futurePlanning: 0.4, tempoWeight: 0.6, lethalWeight: 0.8, boardWeight: 0.6,
    blunderRate: 0.1, searchDepth: 0, beamWidth: 6, matchupKnowledge: 0.3, timeBudgetMs: 60
  },
  hard: {
    id: 'hard', label: 'Difícil', aggression: 0.8, riskTolerance: 0.6, resourcePreservation: 0.6,
    futurePlanning: 0.6, tempoWeight: 0.8, lethalWeight: 1, boardWeight: 0.8,
    blunderRate: 0.03, searchDepth: 1, beamWidth: 8, matchupKnowledge: 0.5, timeBudgetMs: 120
  },
  elite: {
    id: 'elite', label: 'Elite', aggression: 0.85, riskTolerance: 0.7, resourcePreservation: 0.7,
    futurePlanning: 0.8, tempoWeight: 1, lethalWeight: 1, boardWeight: 0.9,
    blunderRate: 0, searchDepth: 2, beamWidth: 10, matchupKnowledge: 0.8, timeBudgetMs: 220
  }
};

export function profileForLevel(level: AiLevel): AiProfile {
  // Record total sobre AiLevel + fallback: um nível fora da união nunca pode
  // devolver `undefined` (foi assim que o jogo quebraria com um nível novo).
  return PROFILE_LEVELS[level] ?? DEFAULT_PROFILE;
}

export const DEFAULT_PROFILE: AiProfile = PROFILE_LEVELS.normal;

/** Perfil StellaPrime — rushadora extremamente agressiva, punitiva, consciente (sem cheat). */
export const STELLA_PROFILE: AiProfile = {
  id: 'stella-prime', label: 'StellaPrime', aggression: 0.98, riskTolerance: 0.82, resourcePreservation: 0.35,
  futurePlanning: 0.5, tempoWeight: 0.95, lethalWeight: 1, boardWeight: 0.5,
  blunderRate: 0, searchDepth: 2, beamWidth: 10, matchupKnowledge: 0.9, timeBudgetMs: 220
};

/** Perfil Luna underdog — controladora, paciente, calculista (sem cheat). */
export const LUNA_PROFILE: AiProfile = {
  id: 'luna-underdog', label: 'Luna underdog', aggression: 0.4, riskTolerance: 0.25, resourcePreservation: 0.95,
  futurePlanning: 0.95, tempoWeight: 0.6, lethalWeight: 1, boardWeight: 0.9,
  blunderRate: 0, searchDepth: 2, beamWidth: 10, matchupKnowledge: 0.95, timeBudgetMs: 220
};
