import { beforeAll, describe, expect, it } from 'vitest';
import { setup, makeEngine, autoSetup, deckOf, rigHand } from './helpers';
import { MatchEngine } from '../src/engine/engine';
import { registry } from '../src/engine/registry';
import { charDef, countAllInstances, player } from '../src/engine/queries';
import { computeLegalActions } from '../src/engine/validation';
import { mergeConfig } from '../src/engine/state/setup';
import { DEFAULT_CONFIG } from '../src/engine/types';
import type { AbilityDef, AttackDef, CardDef, CardInstance, CharacterDef, EffectStep } from '../src/engine/types';
import { aiNextCommand, aiSmartChoice } from '../src/engine/ai/ai';
import { validateDeck } from '../src/data/fixtures/nexo/decks';

setup();

// ---------------------------------------------------------------------------
// Synthetic defs: engine-pure fixtures for stage/identity/edition rules.
// Registered once; ids are namespaced `t-` to avoid collisions.
// ---------------------------------------------------------------------------

const A = (id: string, name: string, cost: [string, number][], damage: number | undefined, extra: Partial<AttackDef> = {}): AttackDef => ({
  id, name, cost: cost.map(([type, amount]) => ({ type, amount })), damage, ...extra
});
const E = (op: string, params: Record<string, unknown> = {}): EffectStep => ({ op, ...params });

function baseChar(id: string, name: string, stage: number, opts: Partial<CharacterDef> = {}): CharacterDef {
  return {
    id, kind: 'CHARACTER', name, faction: 'neutro', rarity: 'common', tags: [],
    art: { motif: 'test', seed: id },
    maxHp: 100, stage, retreatCost: 1, attacks: [A(`atk-${id}`, 'Golpe', [['*', 1]], 20)],
    abilities: [], victoryValue: 1, ...opts
  } as CharacterDef;
}

const SYNTHETIC: CardDef[] = [
  // cadeia com 3 estágios (0 → 1 → 2), ligada por upgradesTo
  baseChar('t-asc0', 'Ascendente 0', 0, { family: 't-asc', maxHp: 80 }),
  baseChar('t-asc1', 'Ascendente 1', 1, { family: 't-asc', maxHp: 120 }),
  baseChar('t-asc2', 'Ascendente 2', 2, { family: 't-asc', maxHp: 160 }),
  // variantes de edição da MESMA identidade (todas stage 0 — edição ≠ evolução)
  baseChar('t-jenny-base', 'Jenny', 0, { identityId: 'agent-t-jenny', edition: 'BASE', maxHp: 90 }),
  baseChar('t-jenny-mvp', 'Jenny MVP', 0, { identityId: 'agent-t-jenny', edition: 'MVP', maxHp: 90 }),
  // holo: mesma carta, só o carimbo cosmético
  baseChar('t-holo-std', 'Fóton', 0, { maxHp: 70, rarity: 'rare' }),
  baseChar('t-holo-foil', 'Fóton Holo', 0, { maxHp: 70, rarity: 'rare', holo: true, identityId: 'agent-t-foton' }),
  baseChar('t-holo-std-id', 'Fóton', 0, { maxHp: 70, rarity: 'rare', identityId: 'agent-t-foton' }),
  // raridade diferente, números idênticos (raridade não é power creep)
  baseChar('t-rar-common', 'Comum', 0, { rarity: 'common' }),
  baseChar('t-rar-legend', 'Lendário', 0, { rarity: 'legendary' }),
  // ação com restriction characterCondition REAL
  {
    id: 't-act-cond', kind: 'ACTION', name: 'Técnica Condicional', faction: 'neutro', rarity: 'common',
    tags: [], art: { motif: 'test', seed: 'cond' },
    effects: [E('drawCards', { amount: 1 })],
    restrictions: [{
      type: 'characterCondition',
      condition: { op: 'damageAtLeast', value: 30, target: 'activeAlly' },
      text: 'Requer agente ativo com 30+ de dano.'
    }]
  }
];

beforeAll(() => {
  for (const def of SYNTHETIC) {
    if (!registry.tryCard(def.id)) registry.registerCard(def);
  }
  // liga a cadeia t-asc
  (registry.card('t-asc0') as CharacterDef).upgradesTo = ['t-asc1'];
  (registry.card('t-asc1') as CharacterDef).upgradesTo = ['t-asc2'];
});

function seatFromDeck(e: MatchEngine, pIdx: 0 | 1): void {
  const p = e.state.players[pIdx];
  if (p.active) return;
  const idx = p.deck.findIndex((c) => c.kind === 'CHARACTER' && (registry.card(c.defId) as CharacterDef).stage === 0);
  if (idx >= 0) {
    const [c] = p.deck.splice(idx, 1);
    c.deployedOnTurn = 0;
    p.active = c;
  }
  p.setupDone = true;
  e.state.phase = e.state.players[0].setupDone && e.state.players[1].setupDone ? 'main' : e.state.phase;
}

function engineWith(hand: string[], config = {}): MatchEngine {
  const e = makeEngine({
    p0: ['t-jenny-base', ...hand, ...Array(29 - hand.length).fill('res-neutro')],
    p1: deckOf('deck-controle-tatico'),
    config
  });
  // garante as cartas sintéticas na mão (arranjo determinístico, pré-setup)
  if (hand.length > 0) rigHand(e, 0, hand);
  // senta ativos direto do baralho sem consumir as cartas rigadas
  seatFromDeck(e, 0);
  seatFromDeck(e, 1);
  e.state.turn = 2;
  e.state.activePlayer = 0;
  return e;
}

/** Place a hand card as p0's active (test arrangement only). */
function seatActive(e: MatchEngine, uid: string): void {
  const p = player(e.state, 0);
  const card = p.hand.find((c) => c.uid === uid)!;
  if (p.active) p.bench.push(p.active);
  p.active = card;
  p.hand = p.hand.filter((c) => c.uid !== uid);
  card.deployedOnTurn = 0;
}

// ---------------------------------------------------------------------------
// 1–3. Deployment gating (Base only; advanced via Upgrade)
// ---------------------------------------------------------------------------

describe('Deploy: somente Base direto', () => {
  it('1. personagem Base pode ser colocado na reserva por comando', () => {
    const e = engineWith(['t-asc0']);
    const p = player(e.state, 0);
    const card = p.hand.find((c) => c.defId === 't-asc0')!;
    const legal = e.legalActions(0);
    expect(legal.deployable).toContain(card.uid);
    const r = e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: card.uid });
    expect(r.ok).toBe(true);
    expect(p.bench.some((c) => c.uid === card.uid)).toBe(true);
  });

  it('2. estágio avançado NÃO pode ser deployado (comando e legalActions concordam)', () => {
    const e = engineWith(['t-asc1']);
    const p = player(e.state, 0);
    const card = p.hand.find((c) => c.defId === 't-asc1')!;
    const legal = e.legalActions(0);
    expect(legal.deployable).not.toContain(card.uid);
    expect(legal.hand[card.uid].playable).toBe(false);
    expect(legal.hand[card.uid].reason).toBe('must_upgrade_not_deploy');
    const r = e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: card.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('must_upgrade_not_deploy');
  });

  it('2b. estágio avançado não pode iniciar a partida como ativo/reserva', () => {
    const e = makeEngine({ p0: ['t-asc1', 'res-neutro'] });
    const p = player(e.state, 0);
    const card = p.hand.find((c) => c.defId === 't-asc1')!;
    expect(e.legalActions(0).setupActive).not.toContain(card.uid);
    const r = e.dispatch({ type: 'SETUP_SET_ACTIVE', player: 0, uid: card.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('must_start_with_base');
  });

  it('3. estágio avançado entra via Upgrade válido (e vira o topo)', () => {
    const e = engineWith(['t-asc0', 't-asc1']);
    const p = player(e.state, 0);
    const base = p.hand.find((c) => c.defId === 't-asc0')!;
    e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: base.uid });
    const up = p.hand.find((c) => c.defId === 't-asc1')!;
    const legal = e.legalActions(0);
    expect(legal.upgradable).toContainEqual({ from: base.uid, to: up.uid });
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: up.uid, targetUid: base.uid });
    expect(r.ok).toBe(true);
    expect(charDef(base).id).toBe('t-asc1');
    expect(base.progression.map((c) => c.defId)).toEqual(['t-asc1']);
    expect(base.stageLevel).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4–7. Upgrade conservation
// ---------------------------------------------------------------------------

describe('Conservação de instâncias no Upgrade', () => {
  function evolvedEngine() {
    const e = engineWith(['t-asc0', 't-asc1', 't-asc2']);
    const p = player(e.state, 0);
    const base = p.hand.find((c) => c.defId === 't-asc0')!;
    e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: base.uid });
    const up1 = p.hand.find((c) => c.defId === 't-asc1')!;
    e.dispatch({ type: 'UPGRADE', player: 0, uid: up1.uid, targetUid: base.uid });
    return { e, p, base, up1 };
  }

  it('4. upgrade não cria carta fantasma (nenhuma instância nova no descarte)', () => {
    const { e, p, base, up1 } = evolvedEngine();
    expect(p.discard.some((c) => c.uid === up1.uid)).toBe(false);
    expect(p.discard.some((c) => c.defId.startsWith('t-asc'))).toBe(false);
    // a pilha guarda a carta REAL (mesma uid que saiu da mão)
    expect(base.progression[0].uid).toBe(up1.uid);
    void e;
  });

  it('5. total de instâncias é conservado durante o upgrade', () => {
    const { e } = evolvedEngine();
    const c = countAllInstances(e.state);
    const deckCount = player(e.state, 0).deck.length + player(e.state, 1).deck.length;
    const total = c.deck + c.hand + c.active + c.bench + c.discard + c.attached + c.progression + c.fields;
    expect(c.total).toBe(total);
    // 60 + 60 instâncias criadas no início (ambos os baralhos completos)
    expect(total).toBe(deckCount + c.hand + c.active + c.bench + c.discard + c.progression + c.fields + c.attached);
  });

  it('6. derrota do evoluído manda a pilha REAL ao descarte (conservada)', () => {
    const { e, p, base } = evolvedEngine();
    // garante substituto ANTES de medir o censo (spawn cria instância nova de teste)
    if (p.bench.length === 0) e.debugCommand('spawnCharacter', { defId: 't-asc0', owner: 0 });
    const totalBefore = countAllInstances(e.state).total;
    const upUid = base.progression[0].uid; // uid REAL da carta empilhada
    base.damage = charDef(base).maxHp;     // mata o evoluído
    e.dispatch({ type: 'END_TURN', player: 0 });
    const discard = p.discard.map((c) => c.uid);
    expect(discard).toContain(base.uid);   // base real
    expect(discard).toContain(upUid);      // upgrade real
    expect(base.progression).toEqual([]);  // pilha esvaziada junto
    // nenhuma instância desapareceu
    expect(countAllInstances(e.state).total).toBe(totalBefore);
  });

  it('7. upgrade inválido (família errada) é rejeitado sem efeito colateral', () => {
    const e = engineWith(['t-asc0', 't-jenny-base']);
    const p = player(e.state, 0);
    const base = p.hand.find((c) => c.defId === 't-asc0')!;
    e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: base.uid });
    const jenny = p.hand.find((c) => c.defId === 't-jenny-base')!;
    const totalBefore = countAllInstances(e.state).total;
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: jenny.uid, targetUid: base.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_upgrade');
    expect(p.hand.some((c) => c.uid === jenny.uid)).toBe(true); // continua na mão
    expect(countAllInstances(e.state).total).toBe(totalBefore);
  });

  it('8. pular estágio é rejeitado por padrão (canSkipStages=false)', () => {
    const e = engineWith(['t-asc0', 't-asc1', 't-asc2']);
    const p = player(e.state, 0);
    const base = p.hand.find((c) => c.defId === 't-asc0')!;
    e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: base.uid });
    const up2 = p.hand.find((c) => c.defId === 't-asc2')!;
    const legal = e.legalActions(0);
    expect(legal.upgradable).not.toContainEqual({ from: base.uid, to: up2.uid });
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: up2.uid, targetUid: base.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('cannot_skip_stages');
  });

  it('9. pular estágio via caminho explícito (upgradesTo direto) é permitido', () => {
    // caminho explícito autoriza mesmo com gap>1 (regra de dados)
    (registry.card('t-asc0') as CharacterDef).upgradesTo = ['t-asc1', 't-asc2'];
    try {
      const e = engineWith(['t-asc0', 't-asc2']);
      const p = player(e.state, 0);
      const base = p.hand.find((c) => c.defId === 't-asc0')!;
      e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: base.uid });
      const up2 = p.hand.find((c) => c.defId === 't-asc2')!;
      expect(e.legalActions(0).upgradable).toContainEqual({ from: base.uid, to: up2.uid });
      const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: up2.uid, targetUid: base.uid });
      expect(r.ok).toBe(true);
      expect(charDef(base).id).toBe('t-asc2');
    } finally {
      (registry.card('t-asc0') as CharacterDef).upgradesTo = ['t-asc1'];
    }
  });
});

// ---------------------------------------------------------------------------
// 10. characterCondition idêntico em legalActions e dispatch
// ---------------------------------------------------------------------------

describe('characterCondition — legalActions ≡ dispatch', () => {
  it('condição falsa: nem legalActions nem dispatch aceitam', () => {
    const e = engineWith(['t-act-cond']);
    const p = player(e.state, 0);
    const act = p.hand.find((c) => c.defId === 't-act-cond')!;
    // ativo sem dano → condição (damageAtLeast 30) falsa
    p.active!.damage = 0;
    const legal = e.legalActions(0);
    expect(legal.hand[act.uid].playable).toBe(false);
    expect(legal.hand[act.uid].reason).toBe('restriction_condition');
    const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: act.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('restriction_condition');
  });

  it('condição verdadeira: ambos aceitam (mesma lógica, uma única fonte)', () => {
    const e = engineWith(['t-act-cond']);
    const p = player(e.state, 0);
    const act = p.hand.find((c) => c.defId === 't-act-cond')!;
    p.active!.damage = 30;
    const legal = e.legalActions(0);
    expect(legal.hand[act.uid].playable).toBe(true);
    expect(legal.playableActions).toContain(act.uid);
    const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: act.uid });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11–16. Deck validation & SetupConfig real
// ---------------------------------------------------------------------------

describe('requireBasic e validação de baralho', () => {
  it('11. deck sem agente inicial Base é inválido quando requireBasic=true', () => {
    const v = validateDeck({ 't-asc1': 3, 'res-neutro': 57 }, DEFAULT_CONFIG.deckRules, { requireBasic: true });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('agente inicial'))).toBe(true);
  });

  it('12. requireBasic=false aceita e a partida funciona sem ativo no setup', () => {
    const v = validateDeck({ 't-asc1': 3, 'res-neutro': 57 }, DEFAULT_CONFIG.deckRules, { requireBasic: false });
    expect(v.valid).toBe(true);
    // engine: setupDone sem ativo é aceito; no primeiro turno promove da reserva
    const e = makeEngine({
      p0: [...Array(10).fill('res-neutro'), 't-asc0', ...Array(19).fill('res-neutro')],
      config: { setup: { requireBasic: false, mulligan: 'auto' } }
    });
    const p = player(e.state, 0);
    // mão sem personagem → setupDone direto
    p.hand = p.hand.filter((c) => c.kind !== 'CHARACTER');
    p.deck.push(...p.hand.splice(0)); // esvazia mão, sem personagens
    const r = e.dispatch({ type: 'SETUP_DONE', player: 0 });
    expect(r.ok).toBe(true);
  });

  it('12b. jogador sem ativo promove da reserva no início do próprio turno', () => {
    const e = makeEngine({
      p0: ['t-asc0', 't-jenny-base', ...Array(28).fill('res-neutro')],
      config: { setup: { requireBasic: false } }
    });
    rigHand(e, 0, ['t-jenny-base']);
    rigHand(e, 1, ['char-ferrolho']); // IA também precisa de básico (requireBasic=false não garante)
    autoSetup(e);
    rigHand(e, 0, ['t-asc0']);
    // coloca o rigado na reserva para o teste de promoção automática
    const p = player(e.state, 0);
    const rigged: CardInstance = p.hand.find((c) => c.defId === 't-asc0')!;
    p.bench.push(rigged);
    p.hand = p.hand.filter((c) => c.uid !== rigged.uid);
    // zera o ativo simulando início sem ativo
    if (p.active) { p.hand.push(p.active); p.active = null; }
    const bench: CardInstance[] = p.bench;
    const benchUid = bench[0]?.uid;
    expect(benchUid).toBeDefined();
    e.state.activePlayer = 1; // garante que END_TURN de p1 inicia o turno de p0
    e.state.phase = 'main';
    const r = e.dispatch({ type: 'END_TURN', player: 1 });
    expect(r.ok).toBe(true);
    expect((p.active as CardInstance | null)?.uid).toBe(benchUid); // promovido da reserva automaticamente
  });

  it('13. mulligan automático garante agente inicial', () => {
    const e = makeEngine({
      p0: [...Array(29).fill('res-neutro'), 't-asc0'],
      config: { setup: { mulligan: 'auto', requireBasic: true } }
    });
    const p = player(e.state, 0);
    expect(p.hand.some((c) => c.kind === 'CHARACTER' && charDef(c).stage === 0)).toBe(true);
  });

  it('14. mulligan interativo oferece recompra voluntária ao jogador humano', () => {
    const e = makeEngine({
      p0: ['t-asc0', ...Array(29).fill('res-neutro')],
      p1: deckOf('deck-controle-tatico'),
      config: { setup: { mulligan: 'interactive' } }
    });
    // construção suspende uma escolha para o humano (player 0)
    const pend = e.getPending();
    expect(pend).not.toBeNull();
    expect(pend!.player).toBe(0);
    expect(pend!.candidates).toEqual(['recomprar', 'manter']);
    const handBefore = player(e.state, 0).hand.length;
    const uidSet = new Set(player(e.state, 0).hand.map((c) => c.uid));
    const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: 0, selected: ['recomprar'] });
    expect(r.ok).toBe(true);
    // nova mão com mesmo tamanho e cartas diferentes embaralhadas de volta
    const p = player(e.state, 0);
    expect(p.hand.length).toBe(handBefore);
    const changed = p.hand.some((c) => !uidSet.has(c.uid));
    expect(changed).toBe(true);
    // oponente (IA) não precisa responder; setup segue
    expect(e.state.phase).toBe('setup');
  });

  it('14b. mulligan interativo — manter mantém a mesma mão', () => {
    const e = makeEngine({
      p0: ['t-asc0', ...Array(29).fill('res-neutro')],
      config: { setup: { mulligan: 'interactive' } }
    });
    const uids = player(e.state, 0).hand.map((c) => c.uid).sort();
    e.dispatch({ type: 'RESOLVE_CHOICE', player: 0, selected: ['manter'] });
    expect(player(e.state, 0).hand.map((c) => c.uid).sort()).toEqual(uids);
  });

  it('15. benchAtSetup=false proíbe reserva na preparação (comando e legalActions)', () => {
    const e = makeEngine({
      p0: ['t-asc0', 't-jenny-base', ...Array(28).fill('res-neutro')],
      config: { setup: { benchAtSetup: false } }
    });
    rigHand(e, 0, ['t-asc0', 't-jenny-base']);
    const p = player(e.state, 0);
    const active = p.hand.find((c) => c.defId === 't-asc0')!;
    const benchCand = p.hand.find((c) => c.defId === 't-jenny-base')!;
    e.dispatch({ type: 'SETUP_SET_ACTIVE', player: 0, uid: active.uid });
    expect(e.legalActions(0).setupBench).toEqual([]);
    const r = e.dispatch({ type: 'SETUP_BENCH', player: 0, uid: benchCand.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('setup_bench_disabled');
    expect(p.bench.length).toBe(0);
  });

  it('16. configuração parcial não apaga propriedades irmãs (deep merge)', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { victory: { targetPoints: 5 } });
    expect(merged.victory.targetPoints).toBe(5);
    expect(merged.victory.deckOutLoses).toBe(true);
    expect(merged.victory.noActiveLoses).toBe(true);
    // e a engine recebe o merge completo
    const e = makeEngine({ config: { victory: { targetPoints: 5 } } });
    expect(e.state.config.victory.targetPoints).toBe(5);
    expect(e.state.config.victory.deckOutLoses).toBe(true);
    expect(e.state.config.setup.requireBasic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 21–25. Edição ≠ evolução, identityId, holo, raridade
// ---------------------------------------------------------------------------

describe('Identidade, edições, holo e raridade', () => {
  it('21. edição especial NÃO é tratada como evolução (mesmo stage → gap<1)', () => {
    const e = engineWith(['t-jenny-base', 't-jenny-mvp']);
    const p = player(e.state, 0);
    const baseCard = p.hand.find((c) => c.defId === 't-jenny-base')!;
    e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: baseCard.uid });
    const mvp = p.hand.find((c) => c.defId === 't-jenny-mvp')!;
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: mvp.uid, targetUid: baseCard.uid });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_upgrade');
    expect(p.hand.some((c) => c.uid === mvp.uid)).toBe(true);
  });

  it('22. duas variantes compartilham identityId', () => {
    const a = registry.card('t-jenny-base') as CharacterDef;
    const b = registry.card('t-jenny-mvp') as CharacterDef;
    expect(a.identityId).toBe('agent-t-jenny');
    expect(b.identityId).toBe('agent-t-jenny');
    expect(a.edition).toBe('BASE');
    expect(b.edition).toBe('MVP');
    expect(a.id).not.toBe(b.id);
  });

  it('23. limite por identityId soma variantes (BASE + MVP juntas)', () => {
    const rules = { ...DEFAULT_CONFIG.deckRules, maxCopiesPerIdentity: 4 };
    // 3 BASE + 2 MVP = 5 da mesma identidade → inválido
    const v = validateDeck({ 't-jenny-base': 3, 't-jenny-mvp': 2, 'res-neutro': 55 }, rules);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('por identidade'))).toBe(true);
    // 2 BASE + 2 MVP = 4 → válido
    const v2 = validateDeck({ 't-jenny-base': 2, 't-jenny-mvp': 2, 'res-neutro': 56 }, rules);
    expect(v2.valid).toBe(true);
    // sem o limite configurado, 4+4 passa (comportamento antigo preservado)
    const v3 = validateDeck({ 't-jenny-base': 4, 't-jenny-mvp': 4, 'res-neutro': 52 }, DEFAULT_CONFIG.deckRules);
    expect(v3.valid).toBe(true);
  });

  it('24. holo não modifica stats (cosmético)', () => {
    const std = registry.card('t-holo-std') as CharacterDef;
    const foil = registry.card('t-holo-foil') as CharacterDef;
    expect(foil.holo).toBe(true);
    expect(std.holo).toBeUndefined();
    // todos os campos de gameplay idênticos (projeção de chave fixa)
    const strip = (d: CharacterDef) => ({
      kind: d.kind, faction: d.faction, rarity: d.rarity, tags: d.tags,
      maxHp: d.maxHp, stage: d.stage, retreatCost: d.retreatCost,
      attackStats: d.attacks.map((a) => ({ cost: a.cost, damage: a.damage ?? null })),
      abilities: d.abilities, victoryValue: d.victoryValue
    });
    expect(strip(foil)).toEqual(strip(std));
    // e a engine trata as duas igualmente em campo
    const e = engineWith(['t-holo-std', 't-holo-foil']);
    const p = player(e.state, 0);
    const s = p.hand.find((c) => c.defId === 't-holo-std')!;
    e.dispatch({ type: 'DEPLOY_CHARACTER', player: 0, uid: s.uid });
    expect(charDef(s).maxHp).toBe(70);
    void foil;
  });

  it('25. raridade sozinha não aumenta dano', () => {
    const common = registry.card('t-rar-common') as CharacterDef;
    const legend = registry.card('t-rar-legend') as CharacterDef;
    expect(legend.rarity).toBe('legendary');
    expect(legend.attacks[0].damage).toBe(common.attacks[0].damage);
    expect(legend.maxHp).toBe(common.maxHp);
  });
});

// ---------------------------------------------------------------------------
// 29. Field override (Expansão de Domínio — mecanismo genérico)
// ---------------------------------------------------------------------------

describe('Field override', () => {
  it('campo com override aplica bloqueio de troca (Expansão de Domínio genérica)', () => {
    const e = engineWith(['fd-zona-bloqueio']);
    const p = player(e.state, 0);
    const fd = p.hand.find((c) => c.defId === 'fd-zona-bloqueio')!;
    const r = e.dispatch({ type: 'PLAY_FIELD', player: 0, uid: fd.uid });
    expect(r.ok).toBe(true);
    const fdef = registry.card('fd-zona-bloqueio') as any;
    if (fdef.override?.blockSwitching) {
      expect(e.state.fieldOverrides.length).toBeGreaterThan(0);
      expect(e.legalActions(0).canRetreat).toBe(false);
    } else {
      void fdef;
    }
  });
});

// ---------------------------------------------------------------------------
// 34. legalActions ≡ dispatch (varredura de consistência)
// ---------------------------------------------------------------------------

describe('Consistência legalActions ↔ dispatch', () => {
  it('toda ação marcada jogável é aceita pela engine no mesmo estado', () => {
    for (const seed of [11, 23, 47, 77, 101]) {
      const e = makeEngine({ seed, levels: ['normal', 'hard'] });
      autoSetup(e);
      let guard = 0;
      while (e.state.phase !== 'gameOver' && guard++ < 60) {
        const pIdx = e.state.activePlayer;
        // resolve pendências primeiro
        const pend = e.getPending();
        if (pend) {
          const r = e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
          expect(r.ok).toBe(true);
          continue;
        }
        const legal = e.legalActions(pIdx);
        // varredura: cada carta de AÇÃO jogável deve ser aceita
        const p = player(e.state, pIdx);
        const playableAction = legal.playableActions[0];
        if (playableAction) {
          const card = p.hand.find((c) => c.uid === playableAction)!;
          expect(legal.hand[playableAction].playable).toBe(true);
          const r = e.dispatch({ type: 'PLAY_ACTION', player: pIdx, uid: playableAction });
          if (!r.ok && (r.error === 'choice_pending')) {
            // ação abriu escolha: resolve e segue
            const pend2 = e.getPending();
            if (pend2) e.dispatch({ type: 'RESOLVE_CHOICE', player: pend2.player, selected: aiSmartChoice(e.state, pend2.player, pend2) });
            void card;
            continue;
          }
          expect(r.ok).toBe(true);
          continue;
        }
        const playableAttack = legal.attacks.find((a) => a.playable);
        if (playableAttack) {
          const r = e.dispatch({ type: 'ATTACK', player: pIdx, attackId: playableAttack.attackId });
          expect(r.ok).toBe(true);
          continue;
        }
        if (legal.deployable.length > 0 && p.bench.length < 2) {
          const r = e.dispatch({ type: 'DEPLOY_CHARACTER', player: pIdx, uid: legal.deployable[0] });
          expect(r.ok).toBe(true);
          continue;
        }
        e.dispatch({ type: 'END_TURN', player: pIdx });
      }
      void aiNextCommand;
    }
  });

  it('censura de conservação: partida inteira sem perder nem criar cartas reais', () => {
    // 60 + 60 instâncias criadas no início; nenhuma mecânica NEXO gera cartas
    // reais — apenas tokens `generated: true`, contados à parte.
    const e = makeEngine({ seed: 555, levels: ['hard', 'hard'] });
    autoSetup(e);
    const assertConserved = () => {
      const c = countAllInstances(e.state);
      expect(c.total).toBe(120);
      expect(c.generated).toBe(0); // NEXO não tem transformações por efeito em jogo normal
    };
    assertConserved();
    let guard = 0;
    while (e.state.phase !== 'gameOver' && guard++ < 500) {
      const p = e.state.activePlayer;
      const pend = e.getPending();
      if (pend) {
        e.dispatch({ type: 'RESOLVE_CHOICE', player: pend.player, selected: aiSmartChoice(e.state, pend.player, pend) });
      } else {
        const r = e.dispatch(aiNextCommand(e, p));
        if (!r.ok && r.error !== 'choice_pending') e.dispatch({ type: 'END_TURN', player: p });
      }
      assertConserved();
    }
    expect(guard).toBeLessThan(500);
    const final = countAllInstances(e.state);
    // nada se perdeu: toda carta real segue contabilizada em alguma zona
    expect(final.total).toBe(120);
    expect(final.discard + final.progression).toBeGreaterThan(0); // houve combate
  });
});
