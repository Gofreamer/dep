import type { AbilityDef, AttackDef, CardDef, CharacterDef, EffectStep } from '../../engine/types';

// ---------------------------------------------------------------------------
// Compact builders — characters are pure data.
// ---------------------------------------------------------------------------

const A = (id: string, name: string, cost: [string, number][], damage: number | undefined, extra: Partial<AttackDef> = {}): AttackDef => ({
  id, name, cost: cost.map(([type, amount]) => ({ type, amount })), damage, ...extra
});

const AB = (id: string, name: string, trigger: AbilityDef['trigger'], extra: Partial<AbilityDef> = {}): AbilityDef => ({
  id, name, trigger, ...extra
});

const E = (op: string, params: Record<string, unknown> = {}): EffectStep => ({ op, ...params });

interface CharOpts {
  text?: string; rarity?: CharacterDef['rarity']; family?: string; retreatCost?: number;
  weakness?: { affinity: string }; resistance?: { affinity: string; reduce?: number };
  abilities?: AbilityDef[]; tags?: string[]; victoryValue?: number; unique?: boolean; equipmentSlots?: number;
  flavor?: string;
}

const C = (id: string, name: string, faction: string, hp: number, stage: number, attacks: AttackDef[], o: CharOpts = {}): CharacterDef => ({
  id,
  kind: 'CHARACTER',
  name,
  text: o.text,
  flavor: o.flavor,
  faction,
  affinity: faction,
  rarity: o.rarity ?? (stage === 0 ? 'common' : stage === 1 ? 'uncommon' : 'rare'),
  tags: o.tags ?? [],
  art: { motif: faction, seed: id },
  maxHp: hp,
  stage,
  family: o.family,
  retreatCost: o.retreatCost ?? 1,
  weakness: o.weakness,
  resistance: o.resistance,
  abilities: o.abilities ?? [],
  attacks,
  victoryValue: o.victoryValue ?? (stage === 0 ? 1 : stage === 1 ? 1 : 2),
  unique: o.unique
});

// ---------------------------------------------------------------------------
// Upgrade families (Base → Estágio 1 → Estágio 2). Labels come from config.
// ---------------------------------------------------------------------------

// Família Cindro — Solar, agressiva com queimadura
const cindroLine = [
  C('char-cindro', 'Cindro', 'solar', 60, 0, [
    A('atk-cindro-faisca', 'Faísca', [['solar', 1]], 10)
  ], { family: 'cindro', weakness: { affinity: 'mare' }, text: 'Um embrião de chama que sonha em explodir.' }),
  C('char-ignarok', 'Ignarok', 'solar', 90, 1, [
    A('atk-ignarok-jato', 'Jato Ígneo', [['solar', 1], ['*', 1]], 30),
    A('atk-ignarok-pira', 'Píravore', [['solar', 2]], 20, { effects: [E('applyStatus', { target: 'enemyActive', status: 'burn', tokens: 2 })], text: 'Queima o alvo.' })
  ], { family: 'cindro', weakness: { affinity: 'mare' }, rarity: 'uncommon' }),
  C('char-vulcannon', 'Vulcannon', 'solar', 140, 2, [
    A('atk-vulcannon-erupcao', 'Erupção', [['solar', 2], ['*', 1]], 60),
    A('atk-vulcannon-ondacalor', 'Onda de Calor', [['solar', 2]], 30, {
      effects: [E('applyStatus', { target: 'enemyActive', status: 'burn', tokens: 2 })],
      text: '30 de dano e Queimadura.'
    })
  ], { family: 'cindro', weakness: { affinity: 'mare' }, rarity: 'rare', retreatCost: 2 })
];

// Família Ploc — Maré, controle e resistência
const plocLine = [
  C('char-ploc', 'Ploc', 'mare', 50, 0, [
    A('atk-ploc-jato', 'Jato d’Água', [['mare', 1]], 10),
    A('atk-ploc-redome', 'Redome', [['mare', 1]], undefined, {
      effects: [E('drawCards', { amount: 1 })], text: 'Compre 1 carta.'
    })
  ], { family: 'ploc', weakness: { affinity: 'volt' }, abilities: [AB('ab-ploc-fluxo', 'Fluxo Lunar', 'onPlay', { effects: [E('drawCards', { amount: 1 })], text: 'Ao entrar em jogo: compre 1 carta.' })] }),
  C('char-marefix', 'Maréfix', 'mare', 90, 1, [
    A('atk-marefix-correnteza', 'Correnteza', [['mare', 1], ['*', 1]], 30),
    A('atk-marefix-vortice', 'Vórtice', [['mare', 2]], 20, { effects: [E('forceEnemySwitch', {})], text: 'O oponente troca seu personagem ativo.' })
  ], { family: 'ploc', weakness: { affinity: 'volt' }, rarity: 'uncommon' }),
  C('char-abissalor', 'Abissalor', 'mare', 150, 2, [
    A('atk-abissalor-maremoto', 'Maremoto', [['mare', 3]], 60),
    A('atk-abissalor-asfixia', 'Asfixia Abissal', [['mare', 2]], 30, { effects: [E('detachResource', { target: 'enemyActive', amount: 1 })], text: 'Descarte 1 recurso do ativo inimigo.' })
  ], {
    family: 'ploc', weakness: { affinity: 'volt' }, rarity: 'rare', retreatCost: 3,
    abilities: [AB('ab-abissalor-casca', 'Casca Abissal', 'whileActive', { mods: { damageTakenFlat: 10 }, text: 'Enquanto ativo: recebe 10 menos de dano.' })]
  })
];

// Família Brotinho — Flora, cura e veneno
const brotinhoLine = [
  C('char-brotinho', 'Brotinho', 'flora', 50, 0, [
    A('atk-brotinho-chicote', 'Chicote', [['flora', 1]], 10)
  ], { family: 'brotinho', weakness: { affinity: 'solar' }, abilities: [AB('ab-brotinho-fotossintese', 'Fotossíntese', 'turnEnd', { effects: [E('heal', { target: 'self', amount: 10 })], text: 'Fim de turno: cura 10.' })] }),
  C('char-floradon', 'Floradon', 'flora', 80, 1, [
    A('atk-floradon-esporos', 'Esporos', [['flora', 2]], 20, { effects: [E('applyStatus', { target: 'enemyActive', status: 'poison', tokens: 2, stacks: 1 })], text: 'Envenena o alvo.' })
  ], { family: 'brotinho', weakness: { affinity: 'solar' }, rarity: 'uncommon' }),
  C('char-silvana', 'Silvana', 'flora', 130, 2, [
    A('atk-silvana-juizo', 'Julgamento Verde', [['flora', 2], ['*', 1]], 50),
    A('atk-silvana-jardim', 'Jardim Vivo', [['flora', 2]], 30, { effects: [E('heal', { target: 'allAllies', count: 'all', amount: 15 })], text: 'Cura 15 de todos os seus personagens.' })
  ], {
    family: 'brotinho', weakness: { affinity: 'solar' }, rarity: 'rare', retreatCost: 2,
    abilities: [AB('ab-silvana-savia', 'Seiva Perene', 'activated', { zone: 'any', oncePerTurn: true, cost: [{ type: 'flora', amount: 1 }], effects: [E('heal', { target: 'anyAlly', amount: 40 })], text: 'Uma vez por turno (1 Flora): cure 40 de um aliado.' })]
  })
];

// Família Chispito — Volt, velocidade e atordoamento
const chispitoLine = [
  C('char-chispito', 'Chispito', 'volt', 50, 0, [
    A('atk-chispito-zap', 'Zap', [['volt', 1]], 10)
  ], { family: 'chispito', weakness: { affinity: 'flora' }, retreatCost: 1 }),
  C('char-voltraio', 'Voltraio', 'volt', 90, 1, [
    A('atk-voltraio-arco', 'Arco Voltaico', [['volt', 2]], 30),
    A('atk-voltraio-para', 'Paralís', [['volt', 1], ['*', 1]], 10, { effects: [E('applyStatus', { target: 'enemyActive', status: 'stun', tokens: 1 })], text: 'Atordoa o ativo inimigo.' })
  ], { family: 'chispito', weakness: { affinity: 'flora' }, rarity: 'uncommon' }),
  C('char-tempestrix', 'Tempestrix', 'volt', 140, 2, [
    A('atk-tempestrix-descarga', 'Descarga Total', [['volt', 3]], 60),
    A('atk-tempestrix-tempestade', 'Tempestade', [['volt', 2]], 30, {
      effects: [E('dealDamage', { target: 'enemyBench', count: 'all', amount: 10, label: 'tempestade' })],
      text: '30 no ativo e 10 em cada reserva inimiga.'
    })
  ], {
    family: 'chispito', weakness: { affinity: 'flora' }, rarity: 'rare', retreatCost: 1,
    abilities: [AB('ab-tempestrix-acelerar', 'Sobrecarga', 'activated', { zone: 'active', oncePerTurn: true, effects: [E('tempMod', { target: 'self', mods: { damageDealtFlat: 20 }, scope: 'nextAttack', label: 'Sobrecarga' })], text: 'Uma vez por turno: o próximo ataque causa +20.' })]
  })
];

// Família Sombrio — Umbra, disruptiva
const sombrioLine = [
  C('char-sombrio', 'Sombrio', 'umbra', 60, 0, [
    A('atk-sombrio-garra', 'Garra Sombria', [['umbra', 1]], 10)
  ], { family: 'sombrio', weakness: { affinity: 'volt' }, resistance: { affinity: 'solar', reduce: 30 } }),
  C('char-penumbra', 'Penumbra', 'umbra', 90, 1, [
    A('atk-penumbra-lobrego', 'Golpe Lobrego', [['umbra', 2]], 30),
    A('atk-penumbra-furto', 'Furto de Luz', [['umbra', 1]], 10, { effects: [E('mill', { player: 'opponent', amount: 1 })], text: 'O oponente descarta 1 carta do topo do baralho.' })
  ], { family: 'sombrio', weakness: { affinity: 'volt' }, resistance: { affinity: 'solar', reduce: 30 }, rarity: 'uncommon' }),
  C('char-nihilux', 'Nihilux', 'umbra', 150, 2, [
    A('atk-nihilux-vazio', 'Vazio Devorador', [['umbra', 3]], 60),
    A('atk-nihilux- eclipse', 'Eclipse Interior', [['umbra', 2]], 30, {
      effects: [E('applyStatus', { target: 'enemyActive', status: 'silence', tokens: 2 })],
      text: 'Silencia o ativo inimigo por 2 turnos.'
    })
  ], {
    family: 'sombrio', weakness: { affinity: 'volt' }, resistance: { affinity: 'solar', reduce: 30 }, rarity: 'rare', retreatCost: 2,
    abilities: [AB('ab-nihilux-fome', 'Fome do Vazio', 'onEnemyDefeated', { effects: [E('tempMod', { target: 'self', mods: { damageDealtFlat: 20 }, scope: 'thisTurn', label: 'Fome' })], text: 'Quando um inimigo é derrotado: +20 de dano neste turno.' })]
  })
];

// Família Ferrolho — Neutro, tanque
const ferrolhoLine = [
  C('char-ferrolho', 'Ferrolho', 'neutro', 70, 0, [
    A('atk-ferrolho-batida', 'Batida', [['*', 2]], 20)
  ], { family: 'ferrolho', retreatCost: 3, resistance: { affinity: 'umbra', reduce: 30 } }),
  C('char-fortaleza', 'Fortaleza', 'neutro', 110, 1, [
    A('atk-fortaleza-pistao', 'Pistão', [['*', 2], ['*', 1]], 40)
  ], { family: 'ferrolho', retreatCost: 3, resistance: { affinity: 'umbra', reduce: 30 }, rarity: 'uncommon' }),
  C('char-bastiao', 'Bastião Titânico', 'neutro', 160, 2, [
    A('atk-bastiao-esmagar', 'Esmagar', [['*', 4]], 50),
    A('atk-bastiao-muralha', 'Erguer Muralha', [['*', 2]], undefined, {
      effects: [E('applyStatus', { target: 'self', status: 'shield', tokens: 2 })],
      text: 'Ganha Escudo (recebe 30 menos de dano).'
    })
  ], {
    family: 'ferrolho', retreatCost: 4, resistance: { affinity: 'umbra', reduce: 30 }, rarity: 'rare', tags: ['tanque'],
    abilities: [AB('ab-bastiao-pele', 'Pele de Cerne', 'whileActive', { mods: { damageTakenFlat: 10 }, text: 'Enquanto ativo: recebe 10 menos de dano.' })]
  })
];

// Linhas de dois estágios ---------------------------------------------------

const flurroLine = [
  C('char-flurro', 'Flurro', 'mare', 50, 0, [
    A('atk-flurro-sopro', 'Sopro Gélido', [['mare', 1]], 10)
  ], { family: 'flurro', weakness: { affinity: 'volt' } }),
  C('char-glaciar', 'Glaciar Prime', 'mare', 95, 1, [
    A('atk-glaciar-nevasca', 'Nevasca', [['mare', 2]], 30, {
      effects: [E('dealDamage', { target: 'enemyBench', count: 'all', amount: 10, label: 'nevasca' })],
      text: '10 de dano em cada reserva inimiga.'
    })
  ], { family: 'flurro', weakness: { affinity: 'volt' }, rarity: 'uncommon' })
];

const nimboLine = [
  C('char-nimbo', 'Nimbo', 'volt', 40, 0, [
    A('atk-nimbo-carga', 'Carga Estática', [['volt', 1]], 10)
  ], { family: 'nimbo', weakness: { affinity: 'flora' }, abilities: [AB('ab-nimbo-cargo', 'Carga Rápida', 'onPlay', { effects: [E('drawCards', { amount: 1 })], text: 'Ao entrar em jogo: compre 1 carta.' })] }),
  C('char-ciclone', 'Ciclone Sereno', 'volt', 85, 1, [
    A('atk-ciclone-redemoinho', 'Redemoinho', [['volt', 2]], 30, { effects: [E('forceEnemySwitch', {})], text: 'O oponente troca o ativo.' })
  ], { family: 'nimbo', weakness: { affinity: 'flora' }, rarity: 'uncommon' })
];

const vesperLine = [
  C('char-vesper', 'Vesper', 'umbra', 50, 0, [
    A('atk-vesper-uivo', 'Uivo Noturno', [['umbra', 1]], 10)
  ], { family: 'vesper', weakness: { affinity: 'volt' } }),
  C('char-espectro', 'Espectro Errante', 'umbra', 90, 1, [
    A('atk-espectro-maldicao', 'Maldição', [['umbra', 2]], 20, { effects: [E('applyStatus', { target: 'enemyActive', status: 'poison', tokens: 2, stacks: 1 })], text: 'Envenena o alvo.' })
  ], {
    family: 'vesper', weakness: { affinity: 'volt' }, rarity: 'uncommon',
    abilities: [AB('ab-espectro-partida', 'Última Sombra', 'onLeavePlay', { effects: [E('dealDamage', { target: 'enemyActive', amount: 20, label: 'ultima-sombra' })], text: 'Ao sair de jogo: 20 de dano no ativo inimigo.' })]
  })
];

// ---------------------------------------------------------------------------
// Personagens independentes
// ---------------------------------------------------------------------------

const singles: CharacterDef[] = [
  // Solar
  C('char-faiscante', 'Faiscante', 'solar', 60, 0, [
    A('atk-faiscante-duas', 'Duplo Corte', [['*', 2]], 20)
  ], { weakness: { affinity: 'mare' } }),
  C('char-braseiro', 'Braseiro Vivo', 'solar', 70, 0, [
    A('atk-braseiro-lamba', 'Labareda', [['solar', 1], ['*', 1]], 20, { effects: [E('coinFlip', { chance: 0.5, label: 'Queimar?', then: [E('applyStatus', { target: 'enemyActive', status: 'burn', tokens: 2 })] })], text: '50% de chance de Queimar.' })
  ], { weakness: { affinity: 'mare' }, rarity: 'uncommon' }),
  C('char-magnus', 'Magnus Solaris', 'solar', 180, 2, [
    A('atk-magnus-julgamento', 'Julgamento Solar', [['solar', 4]], 80)
  ], {
    weakness: { affinity: 'mare' }, rarity: 'legendary', unique: true, retreatCost: 3, victoryValue: 3, tags: ['supremo'],
    abilities: [AB('ab-magnus-aurora', 'Aurora Imperiosa', 'activated', { zone: 'active', oncePerMatch: true, effects: [E('dealDamage', { target: 'allEnemies', count: 'all', amount: 30, label: 'aurora' })], text: 'Uma vez por partida: 30 de dano em todos os inimigos.' })]
  }),
  // Maré
  C('char-ondina', 'Ondina', 'mare', 60, 0, [
    A('atk-ondina-lamina', 'Lâmina de Maré', [['mare', 1], ['*', 1]], 20)
  ], {
    weakness: { affinity: 'volt' },
    abilities: [AB('ab-ondina-bencao', 'Bênção da Maré', 'activated', { zone: 'any', oncePerTurn: true, effects: [E('heal', { target: 'anyAlly', amount: 20 })], text: 'Uma vez por turno: cure 20 de um aliado.' })]
  }),
  C('char-leviata', 'Leviatã Cinzento', 'mare', 130, 1, [
    A('atk-leviata-engo', 'Engolir', [['mare', 3]], 60),
    A('atk-leviata-cauda', 'Cauda de Maré', [['mare', 2]], 30, { effects: [E('drawCards', { amount: 1 })], text: 'Compre 1 carta.' })
  ], { weakness: { affinity: 'volt' }, rarity: 'rare', retreatCost: 3, victoryValue: 2 }),
  // Flora
  C('char-sementeira', 'Sementeira', 'flora', 60, 0, [
    A('atk-sementeira-casco', 'Casco Duro', [['*', 2]], 10)
  ], {
    weakness: { affinity: 'solar' },
    abilities: [AB('ab-sementeira-jardim', 'Viveiro', 'activated', { zone: 'bench', oncePerTurn: true, effects: [E('searchDeck', { filter: { kinds: ['CHARACTER'] }, amount: 1, to: 'hand', prompt: 'Escolha um personagem do baralho' })], text: 'Uma vez por turno: busque 1 personagem no baralho.' })]
  }),
  C('char-carvalho', 'Carvalho Ancião', 'flora', 100, 1, [
    A('atk-carvalho-raiz', 'Raízes Afiadas', [['flora', 2], ['*', 1]], 40)
  ], {
    weakness: { affinity: 'solar' }, rarity: 'rare', retreatCost: 3,
    abilities: [AB('ab-carvalho-ciclo', 'Ciclo das Estações', 'turnEnd', { effects: [E('heal', { target: 'self', amount: 10 })], text: 'Fim de turno: cura 10.' })]
  }),
  C('char-musgo', 'Musgo Silvestre', 'flora', 60, 0, [
    A('atk-musgo-toque', 'Toque de Musgo', [['flora', 1]], 10, { effects: [E('heal', { target: 'self', amount: 10 })], text: 'Cura 10.' })
  ], { weakness: { affinity: 'solar' }, retreatCost: 1 }),
  // Volt
  C('char-elo', 'Elo Condutor', 'volt', 60, 0, [
    A('atk-elo-choque', 'Choque Rápido', [['volt', 1]], 20)
  ], { weakness: { affinity: 'flora' }, retreatCost: 1 }),
  C('char-torre', 'Torre Condutora', 'volt', 90, 1, [
    A('atk-torre-tesla', 'Arco de Tesla', [['volt', 2], ['*', 1]], 40)
  ], {
    weakness: { affinity: 'flora' }, rarity: 'rare',
    abilities: [AB('ab-torre-recarga', 'Recarga Emergencial', 'activated', { zone: 'any', oncePerTurn: true, effects: [E('attachResource', { from: 'discard', amount: 1, target: 'self' })], text: 'Uma vez por turno: conecte 1 recurso do descarte a este personagem.' })]
  }),
  // Umbra
  C('char-lunaris', 'Lunaris', 'umbra', 60, 0, [
    A('atk-lunaris-vento', 'Vento Lunar', [['umbra', 1]], 10)
  ], {
    weakness: { affinity: 'volt' }, resistance: { affinity: 'solar', reduce: 30 },
    abilities: [AB('ab-lunaris-agouro', 'Agouro', 'onPlay', { effects: [E('drawCards', { amount: 2 }), E('discardCards', { amount: 1, optional: true, prompt: 'Descarte 1 carta (opcional)' })], text: 'Ao entrar em jogo: compre 2 e descarte 1 (opcional).' })]
  }),
  C('char-ceifador', 'Ceifador Pálido', 'umbra', 110, 1, [
    A('atk-ceifador-foice', 'Foice Crescente', [['umbra', 2], ['*', 1]], 30, {
      effectsBefore: [E('conditionalEffect', { condition: { op: 'damageAtLeast', value: 40, target: 'defender' }, then: [E('tempMod', { target: 'self', mods: { damageDealtFlat: 30 }, scope: 'nextAttack', label: 'Execução' })] })],
      text: '+30 se o alvo já tiver 40+ de dano.'
    })
  ], { weakness: { affinity: 'volt' }, resistance: { affinity: 'solar', reduce: 30 }, rarity: 'rare' }),
  C('char-nix', 'Nix, a Última Sombra', 'umbra', 170, 2, [
    A('atk-nix-penumbra', 'Sentença Penumbrosa', [['umbra', 4]], 70)
  ], {
    weakness: { affinity: 'volt' }, resistance: { affinity: 'solar', reduce: 30 }, rarity: 'legendary', unique: true, retreatCost: 2, victoryValue: 3, tags: ['supremo'],
    abilities: [AB('ab-nix-vazios', 'Passo entre Vazios', 'activated', { zone: 'active', oncePerTurn: true, cost: [{ type: 'umbra', amount: 1 }], effects: [E('switchActive', {})], text: 'Uma vez por turno (1 Umbra): troque seu ativo à vontade.' })]
  }),
  // Neutro
  C('char-automato', 'Autômato Porteiro', 'neutro', 80, 0, [
    A('atk-automato-lanca', 'Lança de Ferro', [['*', 2]], 20)
  ], {
    retreatCost: 3,
    abilities: [AB('ab-automato-placa', 'Placa Reforçada', 'whileActive', { mods: { damageTakenFlat: 10 }, text: 'Enquanto ativo: recebe 10 menos de dano.' })]
  }),
  C('char-drone', 'Drone de Reconhecimento', 'neutro', 40, 0, [
    A('atk-drone-scan', 'Pulso de Varredura', [['*', 1]], 10, { effects: [E('drawCards', { amount: 1 })], text: 'Compre 1 carta.' })
  ], { tags: ['tec'] }),
  C('char-golem', 'Golem de Sucata', 'neutro', 90, 0, [
    A('atk-golem-detonacao', 'Detonação Enferrujada', [['*', 3]], 20, {
      scaling: [{ per: 'counter', counter: 'furia', amount: 10 }],
      text: '20 + 10 por marcador de Fúria.'
    })
  ], {
    abilities: [AB('ab-golem-ranca', 'Rancor', 'onDamaged', { effects: [E('addCounter', { target: 'self', counter: 'furia', amount: 1 })], text: 'Ao ser ferido: ganha 1 de Fúria.' })]
  }),
  C('char-curandeiro', 'Curandeiro Errante', 'neutro', 70, 0, [
    A('atk-curandeiro-bengala', 'Golpe de Bengala', [['*', 2]], 10)
  ], {
    abilities: [AB('ab-curandeiro-toque', 'Toque Restaudor', 'activated', { zone: 'any', oncePerTurn: true, effects: [E('heal', { target: 'anyAlly', amount: 20 })], text: 'Uma vez por turno: cure 20 de um aliado.' })]
  }),
  C('char-bandido', 'Bandido do Descampo', 'neutro', 60, 0, [
    A('atk-bandido-adaga', 'Adagada', [['*', 1]], 10, { effects: [E('mill', { player: 'opponent', amount: 1 })], text: 'O oponente descarta 1 do topo do baralho.' })
  ], {}),
  C('char-guardia', 'Guardiã do Portal', 'neutro', 80, 0, [
    A('atk-guardia-onda', 'Onda do Portal', [['*', 2]], 20)
  ], {
    rarity: 'uncommon',
    abilities: [AB('ab-guardia-passo', 'Passo Dimensional', 'activated', { zone: 'active', oncePerTurn: true, cost: [{ type: '*', amount: 1 }], effects: [E('switchActive', {})], text: 'Uma vez por turno (1 neutro): troque seu ativo sem recuar.' })]
  })
];

// ---------------------------------------------------------------------------
// Wiring de famílias: cada estágio aponta para a próxima forma
// ---------------------------------------------------------------------------

function wireFamily(defs: CharacterDef[]): CharacterDef[] {
  for (let i = 0; i < defs.length - 1; i++) {
    defs[i].upgradesTo = [defs[i + 1].id];
  }
  return defs;
}

const familyDefs = [
  cindroLine, plocLine, brotinhoLine, chispitoLine, sombrioLine, ferrolhoLine,
  flurroLine, nimboLine, vesperLine
].map(wireFamily);

export const CHARACTERS: CharacterDef[] = [...familyDefs.flat(), ...singles];

export const ALL_CARDS: CardDef[] = [...CHARACTERS];
