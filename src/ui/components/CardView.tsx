import React from 'react';
import type { AttackDef, CardDef, CharacterDef, ResourceCost } from '../../engine/types';
import { registry } from '../../engine/registry';
import { TERMINOLOGY as T } from '../../data/terminology';
import { factionColor } from './Artwork';
import { CardArt } from './CardArt';

export const RARITY_COLORS: Record<string, string> = {
  common: '#94a3b8',
  uncommon: '#4ade80',
  rare: '#38bdf8',
  epic: '#a78bfa',
  legendary: '#fbbf24'
};

export function costPips(cost: ResourceCost): React.ReactNode {
  return cost.map((c, i) => (
    <span key={i} className="cost-pip" title={c.type === '*' ? 'Qualquer' : c.type} style={{ background: factionColor(c.type === '*' ? 'neutro' : c.type) }}>
      {c.amount}
    </span>
  ));
}

export function kindLabel(def: CardDef): string {
  return T.kindNames[def.kind]?.singular ?? def.kind;
}

export function stageLabel(stage: number): string {
  return T.stageLabels[stage] ?? `Estágio ${stage}`;
}

const RARITY_GLYPH: Record<string, string> = { common: '●', uncommon: '◆', rare: '★', epic: '✦', legendary: '♛' };

/** Carta em tamanho integral (inspeção, construtor, coleção). */
export const CardView: React.FC<{ def: CardDef; quantity?: number; onClick?: () => void; dim?: boolean; highlight?: boolean; selected?: boolean }> = ({ def, quantity, onClick, dim, highlight, selected }) => {
  const color = factionColor(def.faction);
  return (
    <div
      className={`card card-full kind-${def.kind.toLowerCase()} r-${def.rarity} ${dim ? 'dim' : ''} ${highlight ? 'glow' : ''} ${selected ? 'selected' : ''} ${def.holo ? 'holo' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${def.name} — ver detalhes` : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{ ['--faction' as any]: color }}
    >
      <div className="card-head">
        <span className="card-name">{def.name}</span>
        <span className="card-cost">{def.kind === 'CHARACTER' && <em className="hp-badge">{(def as CharacterDef).maxHp}<small>HP</small></em>}</span>
      </div>
      <div className="card-stage">
        <span className="chip kind-chip">{kindLabel(def)}</span>
        {def.kind === 'CHARACTER' && <span className="chip">{stageLabel((def as CharacterDef).stage)}</span>}
        {def.edition && <span className={`chip edition-chip ed-${def.edition.toLowerCase()}`}>{def.edition}</span>}
        {def.identityId && def.edition && def.edition !== 'BASE' && <span className="chip identity-chip" title={`Identidade: ${def.identityId}`}>{identityNameOf(def.identityId)}</span>}
        {def.holo && <span className="chip holo-chip" title="Holo — apenas cosmético">✧ HOLo</span>}
        {def.unique && <span className="chip unique-chip">Única</span>}
        {quantity !== undefined && <span className="chip qty">×{quantity}</span>}
      </div>
      <div className="card-art">
        <CardArt def={def} className="art-svg" />
        <span className="rarity" style={{ color: RARITY_COLORS[def.rarity] }}>{RARITY_GLYPH[def.rarity]}</span>
      </div>
      {def.text && <div className="card-rulebox">{def.text}</div>}
      {def.kind === 'CHARACTER' && (
        <div className="card-body">
          {(def as CharacterDef).abilities.map((ab) => (
            <div key={ab.id} className="ability-line">
              <b className="ab-name">{ab.name}</b>
              <span className="ab-trigger">{ab.trigger === 'activated' ? 'Ativa' : triggerShort(ab.trigger)}</span>
              {ab.text && <span className="ab-text">{ab.text}</span>}
            </div>
          ))}
          {(def as CharacterDef).attacks.map((atk: AttackDef) => (
            <div key={atk.id} className="attack-line">
              <span className="atk-cost">{costPips(atk.cost)}</span>
              <b className="atk-name">{atk.name}</b>
              {atk.damage !== undefined && <span className="atk-dmg">{atk.damage}</span>}
              {atk.text && <span className="atk-text">{atk.text}</span>}
            </div>
          ))}
        </div>
      )}
      {def.kind === 'CHARACTER' && (
        <div className="card-foot">
          <span className="weak">{T.weaknessName}: {weakText(def as CharacterDef)}</span>
          <span className="resist">{T.resistanceName}: {resistText(def as CharacterDef)}</span>
          <span className="retreat">{T.retreatName}: {'◆'.repeat(Math.min(4, (def as CharacterDef).retreatCost)) || '0'}</span>
        </div>
      )}
      {def.kind === 'RESOURCE' && (
        <div className="card-body resource-body">
          <div className="res-amount">Fornece <b>1</b> {def.id === 'res-prisma' ? 'recurso curinga' : `recurso ${def.affinity !== 'neutro' ? def.affinity : 'de qualquer tipo'}`}</div>
        </div>
      )}
      <div className="card-number">JET · {String(def.number ?? 0).padStart(3, '0')}</div>
    </div>
  );
};

function weakText(def: CharacterDef): string {
  if (!def.weakness) return '—';
  return `${def.weakness.affinity} ×2`;
}

function resistText(def: CharacterDef): string {
  if (!def.resistance) return '—';
  return `${def.resistance.affinity} −${def.resistance.reduce ?? 30}`;
}

export function triggerShort(trigger: string): string {
  const map: Record<string, string> = {
    onPlay: 'Ao entrar', onUpgrade: 'Ao evoluir', turnStart: 'Início do turno', turnEnd: 'Fim do turno',
    beforeAttack: 'Antes de atacar', afterAttack: 'Depois de atacar', onDamaged: 'Ao ser ferido', onHealed: 'Ao ser curado',
    onResourceAttached: 'Recurso conectado', onAllyEnter: 'Aliado entra', onAllyDefeated: 'Aliado derrotado',
    onEnemyDefeated: 'Inimigo derrotado', onLeavePlay: 'Ao sair', whileActive: 'Enquanto ativo', whileBench: 'Na Reserva'
  };
  return map[trigger] ?? trigger;
}

/** Mini-carta (mão, listas do construtor). */
export const CardMini: React.FC<{ def: CardDef; count?: number; quantity?: number; playable?: boolean; dim?: boolean; onClick?: () => void; onInspect?: () => void }> = ({ def, count, quantity, playable, dim, onClick, onInspect }) => {
  const color = factionColor(def.faction);
  const hp = def.kind === 'CHARACTER' ? (def as CharacterDef).maxHp : undefined;
  return (
    <div
      className={`card-mini kind-${def.kind.toLowerCase()} ${playable ? 'playable' : ''} ${dim ? 'dim' : ''}`}
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onInspect?.(); }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${def.name}${hp ? ` (${hp} HP)` : ''}` : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{ ['--faction' as any]: color }}
    >
      <div className="mini-art"><CardArt def={def} className="art-svg" /></div>
      <div className="mini-info">
        <div className="mini-name">{def.name} {(count ?? quantity) !== undefined && (count ?? quantity)! > 1 && <em>×{count ?? quantity}</em>}</div>
        <div className="mini-sub">
          <span className="chip kind-chip">{kindLabel(def)}</span>
          {def.edition && <span className={`chip edition-chip ed-${def.edition.toLowerCase()}`}>{def.edition}</span>}
          {def.kind === 'CHARACTER' && <span className="chip">{stageLabel((def as CharacterDef).stage)}</span>}
          {hp !== undefined && <span className="mini-hp">{hp}HP</span>}
        </div>
      </div>
      <span className="rarity" style={{ color: RARITY_COLORS[def.rarity] }}>{RARITY_GLYPH[def.rarity]}</span>
    </div>
  );
};

/** Nome da identidade a partir do identityId (agent-jenny → Jenny). */
export function identityNameOf(identityId: string): string {
  const anyDef = registry.allCards().find((c) => c.identityId === identityId);
  if (!anyDef) return identityId;
  const base = registry.tryCard(`${identityId}-base`);
  return (base ?? anyDef).name.replace(/ (MVP|CHAMPION|FINALS|ICON)$/i, '');
}

export function allCardsSorted(): CardDef[] {
  return registry.allCards().sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}
