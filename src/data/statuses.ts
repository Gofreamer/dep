import { registry } from '../engine/registry';
import type { StatusDef } from '../engine/types';

/**
 * Status effects — fully structured. New statuses only need a new entry here.
 */
export const STATUSES: StatusDef[] = [
  {
    id: 'poison', kind: 'debuff', timing: 'turnEndOwner', stacking: 'stack',
    damagePerTick: 10, visual: 'poison',
    text: 'No fim do turno de quem o possui, recebe 10 de dano por marcador.'
  },
  {
    id: 'burn', kind: 'debuff', timing: 'turnEndOwner', stacking: 'unique',
    damagePerTick: 20, visual: 'burn',
    text: 'No fim do turno de quem o possui, recebe 20 de dano.'
  },
  {
    // REGRA OFICIAL TCG: Atordoado = não ataca NEM recua no próximo turno do
    // dono. Distinto de exhausted (só ataca) e de root (só recuo manual,
    // enquanto durar). Ambos os bloqueios testados numericamente.
    id: 'stun', kind: 'debuff', timing: 'turnEndOwner', stacking: 'unique',
    blocksAttack: true, blocksRetreat: true, visual: 'stun',
    text: 'Atordoado: não pode atacar nem recuar até o fim do próximo turno de quem o possui.'
  },
  {
    id: 'sleep', kind: 'debuff', timing: 'turnStartOwner', stacking: 'unique',
    blocksAttack: true, shedChance: 0.5, visual: 'sleep',
    text: 'Não pode atacar. A cada início de turno, 50% de chance de acordar.'
  },
  {
    id: 'confusion', kind: 'debuff', timing: 'turnEndOwner', stacking: 'unique',
    visual: 'confusion',
    text: 'Ao atacar, 30% de chance de se ferir em 20 e encerrar a confusão.'
  },
  {
    id: 'silence', kind: 'debuff', timing: 'turnEndOwner', stacking: 'unique',
    blocksAbilities: true, visual: 'silence',
    text: 'Habilidades desativadas enquanto durar.'
  },
  {
    // +10 de dano recebido de QUALQUER fonte (ataque ou efeito) — veja a
    // convenção de sinal em StatusDef (damageTakenBonusFlat).
    id: 'marked', kind: 'debuff', timing: 'turnEndOwner', stacking: 'refresh',
    damageTakenBonusFlat: 10, visual: 'marked',
    text: 'Alvo exposto: recebe 10 de dano adicional de qualquer fonte enquanto durar.'
  },
  {
    // timing turnEndOwner: aplicado no turno do oponente, bloqueia o turno
    // INTEIRO seguinte do dono e expira no fim dele. (turnStartOwner expirava
    // antes de bloquear qualquer ataque — bug corrigido no hardening v1.)
    id: 'exhausted', kind: 'debuff', timing: 'turnEndOwner', stacking: 'unique',
    blocksAttack: true, visual: 'exhausted',
    text: 'Exausto: não pode atacar no próximo turno.'
  },
  {
    id: 'root', kind: 'debuff', timing: 'turnEndOwner', stacking: 'unique',
    blocksRetreat: true, visual: 'root',
    text: 'Imobilizado: não pode recuar enquanto durar.'
  },
  {
    id: 'tenacity', kind: 'buff', timing: 'turnEndOwner', stacking: 'unique',
    damageTakenFlat: 20, visual: 'tenacity',
    text: 'Tenaz: reduz 20 do dano recebido enquanto durar.'
  },
  {
    id: 'shield', kind: 'buff', timing: 'turnEndOwner', stacking: 'unique',
    damageTakenFlat: 30, visual: 'shield',
    text: 'Reduz em 30 o dano recebido enquanto durar.'
  },
  {
    id: 'regeneration', kind: 'buff', timing: 'turnEndOwner', stacking: 'unique',
    healPerTick: 20, visual: 'regeneration',
    text: 'Cura 20 no fim do turno de quem o possui.'
  }
];

export function registerStatuses(): void {
  registry.registerStatuses(STATUSES);
}
