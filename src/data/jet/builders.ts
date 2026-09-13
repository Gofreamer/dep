/**
 * Builders compactos do CORE SET JET 2.0 — conteúdo gameplay-original do TCG
 * (Técnicas, Equipamentos, Campos, cartas de equipe/tática). NADA aqui afirma
 * fato canônico do universo JET; agentes/edições/equipes continuam derivando
 * exclusivamente da fonte oficial (RocksXB/jet-tactics. @ 769196ea55).
 *
 * Curva de referência Energia × dano (ataques concedidos por equipamento):
 *   1E: 15–40 · 2E: 40–75 · 3E: 70–115 · 4E: 105–160 · 5E: 150–220
 * Efeitos consomem power budget: quanto mais utilidade, menor o dano relativo.
 */
import type { AbilityDef, ActionDef, AttackDef, EquipmentDef, EffectStep, FieldDef } from '../../engine/types';

/** Uma linha de efeito (op + parâmetros). */
export const FX = (op: string, params: Record<string, unknown> = {}): EffectStep => ({ op, ...params });

/** Ataque concedido (finishers de 4–5 Energias vivem aqui, nunca em agente). */
export function grantAttack(
  id: string, name: string, cost: number, damage: number, text: string,
  extra: Partial<AttackDef> = {}
): AttackDef {
  return { id, name, cost: [{ type: '*', amount: cost }], damage, text, ...extra };
}

export interface ActionOpts {
  text: string;
  faction?: string;
  rarity?: ActionDef['rarity'];
  tags?: string[];
  restrictions?: ActionDef['restrictions'];
  unique?: boolean;
  flavor?: string;
}

/** Técnica (carta de AÇÃO — grátis, limitada pelas restrictions). */
export function tech(
  id: string, name: string, effects: EffectStep[], o: ActionOpts
): ActionDef {
  return {
    id, kind: 'ACTION', name,
    text: o.text,
    flavor: o.flavor,
    faction: o.faction ?? 'neutro',
    rarity: o.rarity ?? 'uncommon',
    tags: o.tags ?? ['técnica'],
    art: { motif: 'tecnica', seed: id },
    effects,
    restrictions: o.restrictions ?? [{ type: 'oncePerTurn' }],
    unique: o.unique
  };
}

export interface EquipmentOpts {
  text: string;
  faction?: string;
  rarity?: EquipmentDef['rarity'];
  tags?: string[];
  mods?: EquipmentDef['mods'];
  triggers?: AbilityDef[];
  grantsAttacks?: AttackDef[];
  unique?: boolean;
  flavor?: string;
}

/** Equipamento (pode conceder ataques/finishers via grantsAttacks). */
export function equip(
  id: string, name: string, o: EquipmentOpts
): EquipmentDef {
  return {
    id, kind: 'EQUIPMENT', name,
    text: o.text,
    flavor: o.flavor,
    faction: o.faction ?? 'neutro',
    rarity: o.rarity ?? 'common',
    tags: o.tags ?? ['equipamento'],
    art: { motif: 'equipamento', seed: id },
    mods: o.mods,
    triggers: o.triggers,
    grantsAttacks: o.grantsAttacks,
    unique: o.unique
  };
}

export interface FieldOpts {
  text: string;
  faction?: string;
  rarity?: FieldDef['rarity'];
  tags?: string[];
  subtype?: FieldDef['subtype'];
  mods?: FieldDef['mods'];
  triggers?: AbilityDef[];
  onPlay?: EffectStep[];
  override?: FieldDef['override'];
  scope?: 'all' | 'owner';
  unique?: boolean;
  flavor?: string;
}

/** Campo (1 global ativo; o novo substitui o antigo, que vai ao descarte). */
export function field(
  id: string, name: string, o: FieldOpts
): FieldDef {
  return {
    id, kind: 'FIELD', name,
    text: o.text,
    flavor: o.flavor,
    faction: o.faction ?? 'neutro',
    rarity: o.rarity ?? 'uncommon',
    tags: o.tags ?? ['campo'],
    art: { motif: 'campo', seed: id },
    subtype: o.subtype,
    mods: o.mods,
    triggers: o.triggers,
    onPlay: o.onPlay,
    override: o.override,
    scope: o.scope,
    unique: o.unique
  };
}
