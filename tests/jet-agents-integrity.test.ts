import { beforeAll, describe, expect, it } from 'vitest';
import { registerJetDataPack } from '../src/data/jet/pack';
import { JET_SNAPSHOT } from '../src/data/jet/snapshot';
import { registry } from '../src/engine/registry';
import { allOps, hasOp } from '../src/engine/effects/ops';
import { SELECTOR_IDS, type CardDef, type CharacterDef, type EffectStep } from '../src/engine/types';

/**
 * VALIDAÇÃO ESTRUTURAL DE TODO O ROSTER JET (18 identidades / 28 cartas).
 * Nenhuma carta pode referenciar effect op inexistente, status inexistente,
 * resource type impossível ou target selector desconhecido.
 */

beforeAll(() => { registerJetDataPack(); });

function* walkSteps(steps: EffectStep[] | undefined): Generator<EffectStep> {
  if (!steps) return;
  for (const st of steps) {
    yield st;
    if (st.op === 'conditionalEffect') {
      const then = (st as unknown as { then?: EffectStep[] }).then;
      const otherwise = (st as unknown as { otherwise?: EffectStep[] }).otherwise;
      yield* walkSteps(then);
      yield* walkSteps(otherwise);
    }
    if (st.op === 'repeatEffect') {
      yield* walkSteps((st as unknown as { steps?: EffectStep[]; times?: number }).steps);
    }
  }
}

const ALL_CHARS = (): CharacterDef[] =>
  registry.allCards().filter((d) => d.id.startsWith('agent-')) as CharacterDef[];

describe('Cartas do registro', () => {
  it('todo CardDef tem id único', () => {
    const ids = registry.allCards().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda facção referenciada está registrada', () => {
    for (const def of registry.allCards()) {
      expect(registry.faction(def.faction), `${def.id} facção ${def.faction}`).toBeDefined();
    }
  });

  it('todo AttackDef de agente tem role canônico e ids únicos dentro da carta', () => {
    for (const cd of ALL_CHARS()) {
      const atkIds = cd.attacks.map((a) => a.id);
      expect(new Set(atkIds).size, `${cd.id}: ids de ataque únicos`).toBe(atkIds.length);
      for (const a of cd.attacks) {
        expect(['skill', 'signature'], `${cd.id}/${a.id} role`).toContain(a.role);
      }
    }
  });

  it('cada id de ataque pertence a UMA identidade (variantes herdam, nunca colidem)', () => {
    const owner = new Map<string, string>();
    for (const cd of ALL_CHARS()) {
      expect(cd.identityId, cd.id).toBeTruthy();
      const identity = cd.identityId!;
      for (const a of cd.attacks) {
        const prev = owner.get(a.id);
        if (prev === undefined) owner.set(a.id, identity);
        else expect(prev, `${a.id} compartilhado por ${prev} e ${identity}`).toBe(identity);
      }
    }
  });

  it('efeitos referenciam ops existentes no registry de ops', () => {
    expect(allOps().length).toBeGreaterThan(20);
    for (const def of registry.allCards()) {
      const steps: EffectStep[] = [
        ...((def as { effects?: EffectStep[] }).effects ?? []),
        ...(def.kind === 'CHARACTER' ? (def as CharacterDef).abilities.flatMap((ab) => ab.effects ?? []) : []),
        ...(def.kind === 'CHARACTER' ? (def as CharacterDef).attacks.flatMap((a) => a.effects ?? []) : [])
      ];
      for (const st of walkSteps(steps)) {
        expect(hasOp(st.op), `${def.id}: op '${st.op}' existe`).toBe(true);
      }
    }
  });

  it('status referenciados existem no registry de status', () => {
    const known = (id: string) => {
      try { return registry.status(id) !== undefined; } catch { return false; }
    };
    for (const def of registry.allCards()) {
      const steps: EffectStep[] = [
        ...((def as { effects?: EffectStep[] }).effects ?? []),
        ...(def.kind === 'CHARACTER' ? (def as CharacterDef).abilities.flatMap((ab) => ab.effects ?? []) : []),
        ...(def.kind === 'CHARACTER' ? (def as CharacterDef).attacks.flatMap((a) => a.effects ?? []) : [])
      ];
      for (const st of walkSteps(steps)) {
        if (st.op === 'applyStatus') {
          const sid = (st as unknown as { status: string }).status;
          expect(known(sid), `${def.id}: status '${sid}' registrado`).toBe(true);
        }
        if (st.op === 'removeStatus') {
          const sid = (st as unknown as { status?: string }).status;
          if (sid && sid !== 'all') expect(known(sid), `${def.id}: status '${sid}' registrado`).toBe(true);
        }
      }
    }
  });

  it('target selectors em efeitos/condições são válidos', () => {
    const valid = new Set<string>(SELECTOR_IDS);
    const checkTarget = (def: CardDef, st: EffectStep) => {
      const t = (st as unknown as { target?: string }).target;
      if (t) expect(valid.has(t), `${def.id}: selector '${t}'`).toBe(true);
    };
    for (const def of registry.allCards()) {
      const steps: EffectStep[] = [
        ...((def as { effects?: EffectStep[] }).effects ?? []),
        ...(def.kind === 'CHARACTER' ? (def as CharacterDef).abilities.flatMap((ab) => ab.effects ?? []) : []),
        ...(def.kind === 'CHARACTER' ? (def as CharacterDef).attacks.flatMap((a) => a.effects ?? []) : [])
      ];
      for (const st of walkSteps(steps)) checkTarget(def, st);
      // condições (conditionalEffect/attack condition)
      const conds: { target?: string }[] = [];
      for (const st of walkSteps(steps)) {
        const cond = (st as unknown as { condition?: { target?: string } }).condition;
        if (cond) conds.push(cond);
      }
      for (const c of conds) if (c.target) expect(valid.has(c.target)).toBe(true);
      // abilities whileActive/whileBench sem target estrutural — nada a checar
    }
  });

  it('custos de ataque usam tipos de recurso registrados e quantidades positivas', () => {
    const types = new Set(['*']);
    for (const def of registry.allCards()) {
      if (def.kind === 'RESOURCE') types.add((def as unknown as { resourceType: string }).resourceType);
    }
    for (const cd of ALL_CHARS()) {
      for (const a of cd.attacks) {
        for (const c of a.cost) {
          expect(types.has(c.type), `${cd.id}/${a.id}: tipo '${c.type}'`).toBe(true);
          expect(c.amount).toBeGreaterThan(0);
        }
      }
      for (const ab of cd.abilities) {
        for (const c of ab.cost ?? []) {
          expect(types.has(c.type)).toBe(true);
          expect(c.amount).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('As 18 identidades JET', () => {
  it('snapshot tem 18 agentes e todos viraram cartas BASE jogáveis', () => {
    expect(JET_SNAPSHOT.agents.length).toBe(18);
    for (const identity of JET_SNAPSHOT.agents) {
      const def = registry.tryCard(`${identity.agentId}-base`) as CharacterDef | undefined;
      expect(def, identity.agentId).toBeDefined();
    }
  });

  it('cada agente jogável passa na validação estrutural completa', () => {
    for (const cd of ALL_CHARS()) {
      expect(cd.id).toMatch(/^agent-[a-z0-9-]+(-base|-mvp|-champion|-finals|-icon)$/);
      expect(cd.identityId).toMatch(/^agent-[a-z0-9-]+$/);
      expect(['BASE', 'MVP', 'CHAMPION', 'FINALS', 'ICON']).toContain(cd.edition);
      expect(cd.stage).toBe(0);
      expect(cd.maxHp).toBeGreaterThan(0);
      expect(cd.victoryValue).toBeGreaterThan(0);
      expect(cd.retreatCost).toBeGreaterThanOrEqual(0);
      expect(registry.faction(cd.faction)).toBeDefined();
      expect(cd.attacks.length + cd.abilities.length).toBeGreaterThan(0);
      expect(cd.attacks.length).toBe(2); // kit padrão: skill + signature
      expect(cd.holo).toBeUndefined();
    }
  });

  it('28 cartas de agente no total (18 BASE + 10 sidegrades)', () => {
    expect(ALL_CHARS().length).toBe(28);
    const byEdition: Record<string, number> = {};
    for (const c of ALL_CHARS()) byEdition[c.edition as string] = (byEdition[c.edition as string] ?? 0) + 1;
    expect(byEdition).toEqual({ BASE: 18, MVP: 2, CHAMPION: 4, FINALS: 3, ICON: 1 });
  });

  it('texto do ataque corresponde ao efeito (auditoria efeito vs texto — amostragem de padrões)', () => {
    for (const cd of ALL_CHARS()) {
      for (const a of cd.attacks) {
        const ops = [...walkSteps(a.effects)].map((s) => s.op);
        // "compre" → drawCards presente
        if (/compre 1 carta/i.test(a.text ?? '')) expect(ops, `${cd.id}/${a.id}`).toContain('drawCards');
        // "cure" → heal presente
        if (/cure \d+/i.test(a.text ?? '')) expect(ops, `${cd.id}/${a.id}`).toContain('heal');
        // "Marca"/"Silencia"/"Exauste"/"Imobiliza"/"Atordoa" → applyStatus presente
        if (/marca|silencia|exauste|imobiliza|atordoa/i.test(a.text ?? '')) {
          expect(ops, `${cd.id}/${a.id}: status citado no texto precisa de applyStatus`).toContain('applyStatus');
        }
        // "descarte 1 Energia do Ativo inimigo" → detachResource em alvo inimigo
        if (/descarte 1 energia do ativo inimigo/i.test(a.text ?? '')) {
          const detach = [...walkSteps(a.effects)].find((s) => s.op === 'detachResource') as unknown as { target?: string } | undefined;
          expect(detach, `${cd.id}/${a.id}`).toBeDefined();
          expect(detach?.target).toBe('enemyActive');
        }
        // "descarte 1 das suas Energias" → detachResource SEM target inimigo
        if (/descarte 1 das suas energias/i.test(a.text ?? '')) {
          const detach = [...walkSteps(a.effects)].find((s) => s.op === 'detachResource') as unknown as { target?: string } | undefined;
          expect(detach, `${cd.id}/${a.id}`).toBeDefined();
          expect(detach?.target).not.toBe('enemyActive');
        }
        // "Purifique" → removeStatus all
        if (/purifique/i.test(a.text ?? '')) {
          const rem = [...walkSteps(a.effects)].find((s) => s.op === 'removeStatus') as unknown as { status?: string } | undefined;
          expect(rem?.status, `${cd.id}/${a.id}`).toBe('all');
        }
        // riders "JÁ estava Marcado" usam hadStatus (pré-estado), não hasStatus
        if (/JÁ estava Marcado/i.test(a.text ?? '')) {
          const cond = [...walkSteps(a.effects)].map((s) => (s as unknown as { condition?: { op: string } }).condition);
          expect(cond.some((c) => c?.op === 'hadStatus'), `${cd.id}/${a.id}`).toBe(true);
        }
      }
    }
  });
});
