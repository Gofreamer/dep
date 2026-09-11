import React from 'react';
import type { CardInstance, LegalActions, MatchState } from '../../engine/types';
import { charDef, currentHp, defOf, getStatus, maxHp } from '../../engine/queries';
import { registry } from '../../engine/registry';
import { TERMINOLOGY as T } from '../../data/terminology';
import { factionColor } from './Artwork';
import { CardArt } from './CardArt';
import { stageLabel, triggerShort } from './CardView';

const STATUS_ICON: Record<string, string> = {
  poison: '☠', burn: '🔥', stun: '✦', sleep: '💤', confusion: '❓', silence: '🤐', shield: '🛡', regeneration: '✚'
};

/** Personagem em campo (ativo ou reserva). */
export const BoardCard: React.FC<{
  state: MatchState;
  inst: CardInstance;
  isActive: boolean;
  legal?: LegalActions | null;
  targeting?: boolean;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
}> = ({ state, inst, isActive, legal, targeting, selected, onClick, compact }) => {
  const def = charDef(inst);
  const hpMax = maxHp(state, inst);
  const hp = currentHp(state, inst);
  const hpPct = Math.max(0, Math.round((hp / hpMax) * 100));
  const resources = inst.attached.filter((a) => a.kind === 'RESOURCE');
  const equipment = inst.attached.filter((a) => a.kind === 'EQUIPMENT');
  const color = factionColor(def.faction);
  const canAttack = legal?.attacks.some((a) => a.playable) ?? false;
  const justPlayed = state.turn === inst.deployedOnTurn;
  const isMySide = inst.owner === 0;
  const playableHere = targeting || (isMySide && legal?.hand && Object.keys(legal.hand).length > 0 && (legal.deployable.includes(inst.uid) || false));

  const attackRows = def.attacks;
  const activeAttackPlayable = legal?.attacks ?? [];

  return (
    <div
      className={`board-card ${isActive ? 'is-active' : ''} ${targeting ? 'targetable' : ''} ${selected ? 'selected' : ''} ${canAttack && isActive && isMySide ? 'can-attack' : ''} ${playableHere && !isActive ? 'soft-glow' : ''} r-${def.rarity}`}
      data-uid={inst.uid}
      onClick={onClick}
      style={{ ['--faction' as any]: color }}
    >
      {justPlayed && <span className="just-played" title="Entrou em jogo neste turno">🌙</span>}
      <div className="bc-top">
        <span className="bc-name">{def.name}</span>
        <span className="bc-hp" data-damaged={inst.damage > 0}>{hp}<small>/{hpMax}</small></span>
      </div>
      <div className="bc-art">
        <CardArt def={def} className="art-svg" eager />
        <div className="hp-bar"><span style={{ width: `${hpPct}%` }} data-low={hpPct <= 30} /></div>
        {inst.damage > 0 && <span className="dmg-count">−{inst.damage}</span>}
      </div>
      <div className="bc-stage">{stageLabel(inst.stageLevel)}{def.family ? ` · ${def.family}` : ''}</div>
      {!compact && (
        <div className="bc-attacks">
          {attackRows.map((atk) => {
            const info = activeAttackPlayable.find((a) => a.attackId === atk.id);
            return (
              <div key={atk.id} className={`bc-attack ${info?.playable ? 'playable' : ''}`} title={atk.text ?? atk.name}>
                <span className="bc-atk-name">{atk.name}</span>
                <span className="bc-atk-dmg">{atk.damage ?? '—'}</span>
              </div>
            );
          })}
          {equipment.map((eq) => (
            <div key={eq.uid} className="bc-equip" title={defOf(eq).name}>⚙ {defOf(eq).name}</div>
          ))}
        </div>
      )}
      <div className="bc-res">
        {resources.map((r) => (
          <span key={r.uid} className="res-pip" title={defOf(r).name} style={{ background: factionColor((defOf(r) as any).resourceType === '*' ? 'neutro' : (defOf(r) as any).resourceType) }} />
        ))}
        {resources.length === 0 && <span className="res-empty" />}
      </div>
      {inst.statuses.length > 0 && (
        <div className="bc-status">
          {inst.statuses.map((s) => (
            <span key={s.id} className={`status-chip st-${s.id}`} title={`${T.statusNames[s.id] ?? s.id} — ${registry.status(s.id)?.text ?? ''}`}>
              {STATUS_ICON[s.id] ?? '✧'}{s.stacks > 1 ? `×${s.stacks}` : ''}
            </span>
          ))}
        </div>
      )}
      {Object.keys(inst.counters).filter((k) => inst.counters[k] > 0).map((k) => (
        <span key={k} className="counter-chip">{k}: {inst.counters[k]}</span>
      ))}
      {isActive && isMySide && (
        <div className="bc-abilities">
          {def.abilities.filter((ab) => ab.trigger === 'activated').map((ab) => {
            const info = legal?.abilities.find((x) => x.charUid === inst.uid && x.abilityId === ab.id);
            return (
              <span key={ab.id} className={`ability-btn ${info?.playable ? 'playable' : ''}`} title={`${ab.text ?? ''} (${triggerShort(ab.trigger)})`}>
                ✧ {ab.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Zona (pilha) de baralho/descarte. */
export const ZonePile: React.FC<{ label: string; count: number; kind: 'deck' | 'discard'; onClick?: () => void }> = ({ label, count, kind, onClick }) => (
  <div
    className={`zone-pile ${kind}`}
    onClick={onClick}
    title={label}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    aria-label={`${label}: ${count} cartas`}
    onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
  >
    <div className="pile-visual" />
    <span className="pile-count">{count}</span>
    <span className="pile-label">{label}</span>
  </div>
);

export function statusName(id: string): string {
  return T.statusNames[id] ?? id;
}

export function findInst(state: MatchState, uid: string): CardInstance | undefined {
  for (const p of state.players) {
    if (p.active?.uid === uid) return p.active;
    const b = p.bench.find((c) => c.uid === uid);
    if (b) return b;
    for (const c of [p.active, ...p.bench].filter(Boolean) as CardInstance[]) {
      const att = c.attached.find((a) => a.uid === uid);
      if (att) return att;
    }
    const h = p.hand.find((c) => c.uid === uid);
    if (h) return h;
  }
  return undefined;
}

export function statusOf(inst: CardInstance, id: string) {
  return getStatus(inst, id);
}
