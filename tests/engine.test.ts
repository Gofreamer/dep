import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { registry } from '../src/engine/registry';
import { charDef, findCard, player, charactersInPlay, costSatisfied, countAllInstances } from '../src/engine/queries';
import { validateDeck, STARTER_DECKS } from '../src/data/fixtures/nexo/decks';
import { DEFAULT_CONFIG } from '../src/engine/types';
import { autoSetup, deckOf, makeEngine, playUntilEnd, setup } from './helpers';

setup();

// ---------------------------------------------------------------------------
// RNG / determinism
// ---------------------------------------------------------------------------

describe('RNG determinístico', () => {
  it('mesma semente → mesma sequência', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('sementes diferentes → sequências diferentes', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });
});

// ---------------------------------------------------------------------------
// Setup & mulligan
// ---------------------------------------------------------------------------

describe('Início da partida', () => {
  it('distribui mão inicial com ao menos 1 personagem base', () => {
    const e = makeEngine();
    for (const p of e.state.players) {
      const basic = p.hand.some((c) => c.kind === 'CHARACTER' && charDef(c).stage === 0);
      expect(basic).toBe(true);
    }
  });

  it('mulligan automático embarrega de novo até haver base', () => {
    // construct a deck with characters buried deep: all resources first is impossible via shuffle;
    // instead use a tiny deck with exactly one basic at the bottom — mulligan loop resolves it.
    const ids = [
      ...Array(20).fill('res-solar'),
      'char-cindro'
    ];
    const e = makeEngine({ seed: 777, p0: ids, p1: deckOf('deck-furia-solar') });
    const p = player(e.state, 0);
    const basic = p.hand.some((c) => c.kind === 'CHARACTER' && charDef(c).stage === 0);
    expect(basic).toBe(true);
  });

  it('sorteia o jogador inicial e entra na fase principal', () => {
    const e = makeEngine();
    autoSetup(e);
    expect(e.state.phase).toBe('main');
    expect([0, 1]).toContain(e.state.startingPlayer);
    expect(e.state.turn).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

describe('Compra de cartas', () => {
  it('compra 1 carta no início do turno', () => {
    const e = makeEngine();
    autoSetup(e);
    const nextIdx = e.state.activePlayer === 0 ? 1 : 0;
    const handBefore = player(e.state, nextIdx).hand.length;
    e.dispatch({ type: 'END_TURN', player: e.state.activePlayer });
    const next = player(e.state, nextIdx);
    expect(next.hand.length).toBe(handBefore + 1);
  });

  it('baralho vazio na compra obrigatória derrota o jogador', () => {
    const e = makeEngine({ config: { victory: { targetPoints: 0, deckOutLoses: true, noActiveLoses: true } } });
    autoSetup(e);
    // quem compra é o PRÓXIMO jogador
    const loser = e.state.activePlayer === 0 ? 1 : 0;
    const winner = loser === 0 ? 1 : 0;
    player(e.state, loser).deck = [];
    e.dispatch({ type: 'END_TURN', player: e.state.activePlayer });
    expect(e.state.winner).toBe(winner);
    expect(e.state.endReason).toBe('deck_out');
  });
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

describe('Recursos', () => {
  it('conecta recurso a um personagem próprio', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const res = p.hand.find((c) => c.kind === 'RESOURCE');
    if (!res) return;
    const target = p.active!;
    const r = e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: res.uid, targetUid: target.uid });
    expect(r.ok).toBe(true);
    expect(target.attached.some((a) => a.uid === res.uid)).toBe(true);
  });

  it('rejeita conexão acima do limite por turno', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const ress = p.hand.filter((c) => c.kind === 'RESOURCE');
    if (ress.length < 2) return;
    e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: ress[0].uid, targetUid: p.active!.uid });
    const r2 = e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: ress[1].uid, targetUid: p.active!.uid });
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('attach_limit');
  });

  it('rejeita recurso em personagem inimigo', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const res = p.hand.find((c) => c.kind === 'RESOURCE');
    const enemy = player(e.state, 1).active!;
    if (!res) return;
    const r = e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: res.uid, targetUid: enemy.uid });
    expect(r.ok).toBe(false);
  });

  it('recursos permanecem conectados entre turnos', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const res = p.hand.find((c) => c.kind === 'RESOURCE');
    if (!res) return;
    e.dispatch({ type: 'ATTACH_RESOURCE', player: 0, uid: res.uid, targetUid: p.active!.uid });
    e.dispatch({ type: 'END_TURN', player: 0 });
    e.dispatch({ type: 'END_TURN', player: 1 });
    expect(p.active!.attached.some((a) => a.uid === res.uid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Attacks / damage / defeat
// ---------------------------------------------------------------------------

describe('Ataques e dano', () => {
  function setupFight() {
    const e = makeEngine();
    autoSetup(e);
    // force turn to player 0 and skip the first-turn rule
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p0 = player(e.state, 0);
    const p1 = player(e.state, 1);
    // clear hands, give known resources
    const res = (n: number) => Array.from({ length: n }, () => 'res-solar').map((id) => registry.card(id));
    void res;
    return { e, p0, p1 };
  }

  it('ataque aplica dano no ativo inimigo', () => {
    const { e, p0, p1 } = setupFight();
    const atk = charDef(p0.active!).attacks.find((a) => a.damage !== undefined)!;
    // give enough resources
    for (let i = 0; i < 5; i++) {
      const inst = { ...p0.hand[0] } as any;
      void inst;
    }
    // attach generic resources via debug
    for (let i = 0; i < 5; i++) e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    const hpBefore = p1.active!.damage;
    const dmg = atk.damage ?? 0;
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id });
    expect(r.ok).toBe(true);
    expect(p1.active!.damage).toBeGreaterThanOrEqual(hpBefore + Math.max(0, dmg));
  });

  it('fraqueza dobra o dano', () => {
    const { e, p0, p1 } = setupFight();
    // Cindro (solar) attacks Flora => weakness ×2. Put cindro as p0 active, brotinho as p1 active.
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    e.debugCommand('spawnCharacter', { defId: 'char-floradon', owner: 1 });
    const cindro = player(e.state, 0).bench.find((c) => c.defId === 'char-cindro')!;
    const brotinho = player(e.state, 1).bench.find((c) => c.defId === 'char-floradon')!;
    cindro.deployedOnTurn = 0;
    player(e.state, 0).bench = player(e.state, 0).bench.filter((c) => c !== cindro);
    player(e.state, 1).bench = player(e.state, 1).bench.filter((c) => c !== brotinho);
    player(e.state, 0).active = cindro;
    player(e.state, 1).active = brotinho;
    for (let i = 0; i < 3; i++) e.debugCommand('giveResource', { targetUid: cindro.uid, defId: 'res-solar' });
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: 'atk-cindro-faisca' });
    expect(r.ok).toBe(true);
    // Faísca: 10 base, weakness ×2 = 20
    expect(brotinho.damage).toBe(20);
  });

  it('derrote concede PV, move para o descarte e exige substituta', () => {
    const { e, p0, p1 } = setupFight();
    e.state.config.victory.targetPoints = 99;
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    const cindro = player(e.state, 0).bench.find((c) => c.defId === 'char-cindro')!;
    cindro.deployedOnTurn = 0;
    player(e.state, 0).active = cindro;
    player(e.state, 0).bench = player(e.state, 0).bench.filter((c) => c !== cindro);
    for (let i = 0; i < 3; i++) e.debugCommand('giveResource', { targetUid: cindro.uid, defId: 'res-solar' });
    // enemy active nearly dead
    e.debugCommand('spawnCharacter', { defId: 'char-floradon', owner: 1 });
    e.debugCommand('spawnCharacter', { defId: 'char-ondina', owner: 1 });
    const vitima = player(e.state, 1).bench.find((c) => c.defId === 'char-floradon')!;
    player(e.state, 1).active = vitima;
    player(e.state, 1).bench = player(e.state, 1).bench.filter((c) => c !== vitima);
    if (player(e.state, 1).bench.length === 0) {
      // garante uma substituta
      e.debugCommand('spawnCharacter', { defId: 'char-musgo', owner: 1 });
    }
    vitima.damage = charDef(vitima).maxHp - 5;
    const vpBefore = player(e.state, 0).victoryPoints;
    const discardBefore = player(e.state, 1).discard.length;
    e.dispatch({ type: 'ATTACK', player: 0, attackId: 'atk-cindro-faisca' });
    expect(player(e.state, 0).victoryPoints).toBeGreaterThanOrEqual(vpBefore + 1);
    expect(player(e.state, 1).discard.length).toBeGreaterThan(discardBefore);
    // AI replaced the active automatically (suspension auto-resolved)
    expect(player(e.state, 1).active).not.toBeNull();
  });

  it('sem substituta disponível → derrota do jogador', () => {
    const { e, p0, p1 } = setupFight();
    e.state.config.victory.targetPoints = 99;
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    const cindro = player(e.state, 0).bench.find((c) => c.defId === 'char-cindro')!;
    cindro.deployedOnTurn = 0;
    player(e.state, 0).active = cindro;
    player(e.state, 0).bench = player(e.state, 0).bench.filter((c) => c !== cindro);
    for (let i = 0; i < 3; i++) e.debugCommand('giveResource', { targetUid: cindro.uid, defId: 'res-solar' });
    e.debugCommand('spawnCharacter', { defId: 'char-floradon', owner: 1 });
    const vitima = player(e.state, 1).bench.find((c) => c.defId === 'char-floradon')!;
    player(e.state, 1).active = vitima;
    player(e.state, 1).bench = player(e.state, 1).bench.filter((c) => c !== vitima);
    vitima.damage = charDef(vitima).maxHp;
    player(e.state, 1).bench = [];
    e.dispatch({ type: 'ATTACK', player: 0, attackId: 'atk-cindro-faisca' });
    expect(e.state.winner).toBe(0);
    expect(e.state.endReason).toBe('no_active');
  });

  it('personagem não ataca no turno em que entrou — motivo exato just_deployed', () => {
    const { e, p0 } = setupFight();
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    const cindro = p0.bench.find((c) => c.defId === 'char-cindro')!;
    cindro.deployedOnTurn = e.state.turn; // entrou NESTE turno
    p0.active = cindro;
    p0.bench = p0.bench.filter((c) => c !== cindro);
    for (let i = 0; i < 3; i++) e.debugCommand('giveResource', { targetUid: cindro.uid, defId: 'res-solar' });
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: 'atk-cindro-faisca' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('just_deployed');
    // legalActions concorda com a engine no mesmo estado
    const legal = e.legalActions(0);
    expect(legal.attacks.find((a) => a.attackId === 'atk-cindro-faisca')?.playable).toBe(false);
    expect(legal.attacks.find((a) => a.attackId === 'atk-cindro-faisca')?.reason).toBe('just_deployed');
  });

  it('ataque bem-sucedido encerra o turno (attackEndsTurn)', () => {
    const { e, p0 } = setupFight();
    const atk = charDef(p0.active!).attacks.find((a) => (a.damage ?? 0) > 0)!;
    for (let i = 0; i < 5; i++) e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id });
    expect(r.ok).toBe(true);
    expect(e.state.activePlayer).toBe(1); // turno passou
  });
});

// ---------------------------------------------------------------------------
// Upgrades
// ---------------------------------------------------------------------------

describe('Evoluções', () => {
  it('evolui com conservação real: a carta vai para a pilha, sem carta fantasma', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    const p0 = player(e.state, 0);
    const cindro = p0.bench.find((c) => c.defId === 'char-cindro')!;
    cindro.damage = 20;
    e.debugCommand('giveResource', { targetUid: cindro.uid, defId: 'res-solar' });
    e.debugCommand('addCardToHand', { defId: 'char-ignarok' });
    const ign = p0.hand.find((c) => c.defId === 'char-ignarok')!;
    const totalBefore = countAllInstances(e.state).total;
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: ign.uid, targetUid: cindro.uid });
    expect(r.ok).toBe(true);
    // a MESMA instância permanece em campo — nada foi criado nem clonado
    expect(p0.bench.some((c) => c.uid === cindro.uid)).toBe(true);
    expect(cindro.defId).toBe('char-cindro'); // a base continua sendo a própria carta
    expect(cindro.progression.map((c) => c.defId)).toEqual(['char-ignarok']); // carta REAL empilhada
    expect(cindro.progression[0].uid).toBe(ign.uid);
    expect(cindro.damage).toBe(20); // dano permanece (config)
    expect(cindro.attached.length).toBe(1); // recursos permanecem
    expect(p0.hand.some((c) => c.uid === ign.uid)).toBe(false); // saiu da mão
    expect(p0.discard.some((c) => c.uid === ign.uid)).toBe(false); // NÃO foi ao descarte
    expect(p0.discard.some((c) => c.defId === 'char-cindro')).toBe(false); // base NÃO foi ao descarte
    // definição ativa = topo da pilha
    expect(charDef(cindro).attacks.some((a) => a.id === 'atk-ignarok-jato')).toBe(true);
    // número de cartas existentes na partida permanece conservado
    expect(countAllInstances(e.state).total).toBe(totalBefore);
  });

  it('rejeita evolução inválida (família errada)', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    const p0 = player(e.state, 0);
    const cindro = p0.bench.find((c) => c.defId === 'char-cindro')!;
    e.debugCommand('addCardToHand', { defId: 'char-marefix' });
    const marefix = p0.hand.find((c) => c.defId === 'char-marefix')!;
    const r = e.dispatch({ type: 'UPGRADE', player: 0, uid: marefix.uid, targetUid: cindro.uid });
    expect(r.ok).toBe(false);
  });

  it('evolução por efeito (upgradeCharacter) funciona', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    e.debugCommand('spawnCharacter', { defId: 'char-cindro', owner: 0 });
    const p0 = player(e.state, 0);
    const cindro = p0.bench.find((c) => c.defId === 'char-cindro')!;
    e.debugCommand('addCardToHand', { defId: 'act-estimulo' });
    // make cindro the active to satisfy the action's target
    p0.active = cindro;
    p0.bench = p0.bench.filter((c) => c !== cindro);
    const act = p0.hand.find((c) => c.defId === 'act-estimulo')!;
    const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: act.uid });
    expect(r.ok).toBe(true);
    // transformação por efeito: a definição ATIVA passa a ser o topo da pilha…
    expect(charDef(p0.active!).id).toBe('char-ignarok');
    // …mas a carta real continua sendo a base, e o novo topo é um token GERADO explícito
    expect(p0.active!.defId).toBe('char-cindro');
    expect(p0.active!.progression[0].generated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

describe('Statuses', () => {
  it('veneno causa dano no fim do turno e pode derrotar', () => {
    const e = makeEngine();
    autoSetup(e);
    const p = player(e.state, e.state.activePlayer);
    e.debugCommand('applyStatus', { targetUid: p.active!.uid, statusId: 'poison', tokens: 2 });
    // envenena o ATIVO INIMIGO (IA) quase morto e roda até o fim do turno dele
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const vitima = player(e.state, 1).active!;
    if (player(e.state, 1).bench.length === 0) e.debugCommand('spawnCharacter', { defId: 'char-musgo', owner: 1 });
    vitima.damage = charDef(vitima).maxHp - 5;
    e.debugCommand('applyStatus', { targetUid: vitima.uid, statusId: 'poison', tokens: 1 });
    const vpBefore = player(e.state, 0).victoryPoints;
    e.dispatch({ type: 'END_TURN', player: 0 });
    if (e.state.phase !== 'gameOver') e.dispatch({ type: 'END_TURN', player: 1 }); // fim do turno da vítima: veneno tiquetaqueia
    // 10 de veneno ≥ 5 de HP restante → derrotada e substituída
    expect(player(e.state, 1).active).not.toBeNull();
    expect(player(e.state, 1).active!.uid).not.toBe(vitima.uid);
    expect(player(e.state, 1).discard.some((c) => c.uid === vitima.uid)).toBe(true);
    expect(player(e.state, 0).victoryPoints).toBe(vpBefore + charDef(vitima).victoryValue);
  });

  it('escudo reduz o dano recebido', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p0 = player(e.state, 0);
    const p1 = player(e.state, 1);
    e.debugCommand('applyStatus', { targetUid: p1.active!.uid, statusId: 'shield', tokens: 2 });
    const hpBefore = p1.active!.damage;
    // attacker neutro para ignorar fraqueza/resistência
    e.debugCommand('spawnCharacter', { defId: 'char-faiscante', owner: 0 });
    const at = p0.bench.find((c) => c.defId === 'char-faiscante')!;
    at.deployedOnTurn = 0;
    p0.active = at;
    p0.bench = p0.bench.filter((c) => c !== at);
    e.debugCommand('giveResource', { targetUid: at.uid, defId: 'res-neutro' });
    e.debugCommand('giveResource', { targetUid: at.uid, defId: 'res-neutro' });
    e.dispatch({ type: 'ATTACK', player: 0, attackId: 'atk-faiscante-duas' });
    expect(p1.active!.damage).toBe(hpBefore); // 20 − 30 (escudo) → 0
  });

  it('atordoamento bloqueia ataques', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p0 = player(e.state, 0);
    e.debugCommand('applyStatus', { targetUid: p0.active!.uid, statusId: 'stun', tokens: 1 });
    const atk = charDef(p0.active!).attacks[0];
    const r = e.dispatch({ type: 'ATTACK', player: 0, attackId: atk.id });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('status_blocks_attack');
  });
});

// ---------------------------------------------------------------------------
// Switching / retreat
// ---------------------------------------------------------------------------

describe('Recuo e trocas', () => {
  it('recuo paga recursos e troca o ativo', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p0 = player(e.state, 0);
    if (!p0.active || p0.bench.length === 0) return;
    e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    const resBefore = p0.active!.attached.length;
    const target = p0.bench[0];
    const r = e.dispatch({ type: 'RETREAT', player: 0, benchUid: target.uid });
    expect(r.ok).toBe(true);
    expect(p0.active!.uid).toBe(target.uid);
    // pagou 1 recurso de recuo do Cindro (custo 1)
    expect(p0.bench[0].attached.length).toBe(resBefore - 1);
  });

  it('uma troca por turno', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p0 = player(e.state, 0);
    if (p0.bench.length === 0) return;
    e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    e.debugCommand('giveResource', { targetUid: p0.active!.uid, defId: 'res-prisma' });
    const first = p0.bench[0];
    e.dispatch({ type: 'RETREAT', player: 0, benchUid: first.uid });
    const second = p0.bench[0];
    const r2 = e.dispatch({ type: 'RETREAT', player: 0, benchUid: second.uid });
    expect(r2.ok).toBe(false);
    expect(r2.error).toBe('retreat_limit');
  });
});

// ---------------------------------------------------------------------------
// Victory conditions
// ---------------------------------------------------------------------------

describe('Condições de vitória', () => {
  it('atingir o alvo de PV encerra a partida', () => {
    const e = makeEngine({ config: { victory: { targetPoints: 3, deckOutLoses: true, noActiveLoses: true } } });
    autoSetup(e);
    e.debugCommand('setVp', { value: 3, player: 0 });
    e.state.activePlayer = 0;
    const r = e.dispatch({ type: 'END_TURN', player: 0 });
    expect(r.ok).toBe(true);
    // checkMatchEnd roda após cada comando
    expect(e.state.winner).toBe(0);
  });

  it('concesso entrega a vitória ao oponente', () => {
    const e = makeEngine();
    autoSetup(e);
    e.dispatch({ type: 'CONCEDE', player: 0 });
    expect(e.state.winner).toBe(1);
    expect(e.state.endReason).toBe('concede');
  });
});

// ---------------------------------------------------------------------------
// Deck validation
// ---------------------------------------------------------------------------

describe('Validação de baralho', () => {
  it('baralho inicial válido (60 cartas, ≤4 cópias)', () => {
    const v = validateDeck(STARTER_DECKS[0].cards, DEFAULT_CONFIG.deckRules);
    expect(v.errors).toEqual([]);
    expect(v.counts.total).toBe(60);
  });

  it('rejeita mais de 4 cópias', () => {
    const v = validateDeck({ 'char-cindro': 5, ...filler(55) }, DEFAULT_CONFIG.deckRules);
    expect(v.valid).toBe(false);
  });

  it('rejeita cartas únicas em excesso', () => {
    const v = validateDeck({ 'char-magnus': 2, ...filler(58) }, DEFAULT_CONFIG.deckRules);
    expect(v.errors.some((e) => e.includes('Única'))).toBe(true);
  });

  it('rejeita baralho pequeno', () => {
    const v = validateDeck({ 'char-cindro': 4 }, DEFAULT_CONFIG.deckRules);
    expect(v.valid).toBe(false);
  });
});

function filler(n: number): Record<string, number> {
  return { 'res-neutro': n };
}

// ---------------------------------------------------------------------------
// Effect primitives
// ---------------------------------------------------------------------------

describe('Primitivas de efeito', () => {
  it('drawCards compra cartas', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const before = p.hand.length;
    e.debugCommand('addCardToHand', { defId: 'act-inspiracao' });
    const act = p.hand.find((c) => c.defId === 'act-inspiracao')!;
    e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: act.uid });
    expect(p.hand.length).toBe(before + 3);
  });

  it('searchDeck move carta do baralho para a mão', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    const before = p.hand.length;
    e.debugCommand('addCardToHand', { defId: 'act-reforcos' });
    const act = p.hand.find((c) => c.defId === 'act-reforcos')!;
    const r = e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: act.uid });
    expect(r.ok).toBe(true);
    const pend = e.getPending();
    if (pend) {
      e.dispatch({ type: 'RESOLVE_CHOICE', player: 0, selected: [e.state.players[0].deck.find((c) => c.kind === 'CHARACTER')!.uid] });
    }
    expect(p.hand.length).toBe(before + 1);
  });

  it('heal cura sem passar do HP máximo', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    const p = player(e.state, 0);
    p.active!.damage = 15;
    e.debugCommand('addCardToHand', { defId: 'act-soro' });
    const act = p.hand.find((c) => c.defId === 'act-soro')!;
    e.dispatch({ type: 'PLAY_ACTION', player: 0, uid: act.uid });
    expect(p.active!.damage).toBe(0); // cura 50, dano era 15 → 0
  });

  it('custos de ataque com curingas funcionam', () => {
    const e = makeEngine();
    autoSetup(e);
    e.state.turn = 2;
    e.state.activePlayer = 0;
    e.debugCommand('spawnCharacter', { defId: 'char-vulcannon', owner: 0 });
    const p = player(e.state, 0);
    const v = p.bench.find((c) => c.defId === 'char-vulcannon')!;
    e.debugCommand('giveResource', { targetUid: v.uid, defId: 'res-solar' });
    e.debugCommand('giveResource', { targetUid: v.uid, defId: 'res-prisma' });
    e.debugCommand('giveResource', { targetUid: v.uid, defId: 'res-neutro' });
    const def = registry.card('char-vulcannon') as any;
    const erupcao = def.attacks.find((a: any) => a.id === 'atk-vulcannon-erupcao');
    expect(costSatisfied(v, erupcao.cost, 0)).toBe(true); // 2 solar + 1 qualquer
  });
});

// ---------------------------------------------------------------------------
// Full match (AI vs AI) — estabilidade do loop completo
// ---------------------------------------------------------------------------

describe('Partida completa IA vs IA', () => {
  it('termina dentro do limite de comandos (3 sementes)', () => {
    for (const seed of [11, 222, 3333]) {
      const e = makeEngine({ seed, levels: ['normal', 'normal'] });
      autoSetup(e);
      playUntilEnd(e);
      expect(e.state.phase).toBe('gameOver');
      expect(e.state.winner !== null).toBe(true);
    }
  }, 60_000);

  it('log de eventos registra os momentos-chave', () => {
    const e = makeEngine({ seed: 55 });
    autoSetup(e);
    playUntilEnd(e);
    const types = new Set(e.state.log.map((ev) => ev.type));
    expect(types.has('MATCH_STARTED')).toBe(true);
    expect(types.has('TURN_STARTED')).toBe(true);
    expect(types.has('CARD_DRAWN')).toBe(true);
    expect(types.has('MATCH_ENDED')).toBe(true);
    expect(e.state.winner !== null).toBe(true);
  }, 60_000);

  it('estados de personagens permanecem consistentes', () => {
    const e = makeEngine({ seed: 9001 });
    autoSetup(e);
    playUntilEnd(e);
    for (const p of e.state.players) {
      for (const c of charactersInPlay(e.state, p.index)) {
        expect(c.damage).toBeGreaterThanOrEqual(0);
        expect(findCard(e.state, c.uid)).not.toBeNull();
      }
    }
  }, 60_000);
});
