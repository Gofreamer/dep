import type { ActionDef } from '../../engine/types';
import { FX, tech } from './builders';

/**
 * TÉCNICAS JET — cartas de AÇÃO (grátis, limitadas por restrictions) com
 * identidade de arquétipo. Conteúdo gameplay-original do TCG: nada aqui
 * afirma fato canônico; a identidade de cada equipe é preservada nas
 * mecânicas (Marca/Exaustão para aggro, curas/Tenacidade para controle etc.).
 */
export const JET_TECHNIQUES: ActionDef[] = [
  // -------------------------------------------------------------------------
  // Suporte / economia (genérico)
  // -------------------------------------------------------------------------
  tech('jact-purificacao', 'Purificação', [
    FX('removeStatus', { target: 'activeAlly', status: 'all' })
  ], { text: 'Remova todos os efeitos do seu Agente Ativo.', rarity: 'common', tags: ['suporte'] }),

  tech('jact-leitura', 'Leitura de Combate', [
    FX('drawCards', { amount: 2 })
  ], { text: 'Compre 2 cartas.', rarity: 'common', tags: ['suporte'] }),

  tech('jact-retomada', 'Retomada', [
    FX('retrieveFromDiscard', { amount: 1, pick: 'you', reveal: true })
  ], { text: 'Recupere 1 carta do seu descarte para a mão.', rarity: 'rare', tags: ['suporte'] }),

  tech('jact-recarga', 'Recarga Rápida', [
    FX('attachResource', { target: 'activeAlly', amount: 1, from: 'hand' }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Conecte 1 Energia da sua mão ao seu Agente Ativo e compre 1 carta.', rarity: 'uncommon', tags: ['energia'] }),

  tech('jact-abre-espaco', 'Abre-Espaço', [
    FX('switchActive')
  ], { text: 'Troque seu Agente Ativo por um da Reserva (sem pagar recuo).', rarity: 'common', tags: ['manobra'] }),

  tech('jact-rally', 'Rally de Equipe', [
    FX('heal', { target: 'allAllies', amount: 20 }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Cure 20 de todos os seus Agentes e compre 1 carta.', rarity: 'rare', tags: ['suporte', 'equipe'] }),

  tech('jact-trincheira', 'Trincheira', [
    FX('reduceDamage', { target: 'activeAlly', amount: 30, label: 'Trincheira' })
  ], { text: 'Reduza em 30 o dano recebido pelo seu Agente Ativo neste turno.', rarity: 'uncommon', tags: ['defesa'] }),

  tech('jact-foco-ofensivo', 'Foco Ofensivo', [
    FX('increaseDamage', { target: 'activeAlly', amount: 20, label: 'Foco Ofensivo' })
  ], { text: 'O próximo ataque do seu Agente Ativo causa +20 de dano neste turno.', rarity: 'uncommon', tags: ['ofensiva'] }),

  tech('jact-marcacao', 'Marca Tática', [
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 2 })
  ], { text: 'O Agente Ativo inimigo fica Marcado por 2 turnos (recebe +10 de dano).', rarity: 'uncommon', tags: ['ofensiva'] }),

  tech('jact-corte-energia', 'Corte de Energia', [
    FX('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' })
  ], { text: 'Descarte 1 Energia JET conectada ao Agente Ativo inimigo.', rarity: 'uncommon', tags: ['disrupção'] }),

  // -------------------------------------------------------------------------
  // Aggro / pressão (KOF 12) — KO rápido, Marca, Exaustão, tempo
  // -------------------------------------------------------------------------
  tech('jact-primeiro-sangue', 'Primeiro Sangue', [
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Primeiro Sangue' })
  ], { text: 'Cause 10 de dano ao Agente Ativo inimigo.', rarity: 'common', faction: 'kof-12', tags: ['aggro'] }),

  tech('jact-ultimato', 'Ultimato', [
    FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'Ultimato' }),
    FX('dealDamage', { target: 'self', amount: 15, label: 'Recuo do Ultimato' })
  ], { text: 'Cause 20 de dano ao Ativo inimigo e 15 de dano ao seu Ativo.', rarity: 'uncommon', faction: 'kof-12', tags: ['aggro', 'risco'] }),

  tech('jact-pressao-total', 'Pressão Total', [
    FX('applyStatus', { target: 'enemyActive', status: 'exhausted', tokens: 1 })
  ], { text: 'Exauste o Agente Ativo inimigo (não ataca no próximo turno).', rarity: 'uncommon', faction: 'kof-12', tags: ['aggro'] }),

  tech('jact-marca-quente', 'Marca Quente', [
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 2 }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Marca Quente' })
  ], { text: 'Marque o Ativo inimigo por 2 turnos e cause 10 de dano.', rarity: 'rare', faction: 'kof-12', tags: ['aggro', 'marca'] }),

  tech('jact-varredura', 'Varredura de Campo', [
    FX('dealDamage', { target: 'enemyBench', count: 'all', amount: 10, label: 'Varredura' })
  ], { text: 'Cause 10 de dano a cada Agente inimigo na Reserva.', rarity: 'uncommon', faction: 'kof-12', tags: ['aggro'] }),

  // -------------------------------------------------------------------------
  // Controle / fortaleza (Asgard) — cura, mitigação, proteção
  // -------------------------------------------------------------------------
  tech('jact-muralha', 'Muralha Viva', [
    FX('heal', { target: 'activeAlly', amount: 30 }),
    FX('applyStatus', { target: 'activeAlly', status: 'tenacity', tokens: 1 })
  ], { text: 'Cure 30 do seu Ativo e conceda Tenacidade (−20 de dano recebido).', rarity: 'uncommon', faction: 'asgard', tags: ['controle'] }),

  tech('jact-bencao', 'Bênção de Equipe', [
    FX('heal', { target: 'allAllies', amount: 30 })
  ], { text: 'Cure 30 de todos os seus Agentes.', rarity: 'rare', faction: 'asgard', tags: ['controle', 'equipe'] }),

  tech('jact-purga', 'Purga Coletiva', [
    FX('removeStatus', { target: 'allAllies', status: 'all' }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Purifique todos os seus Agentes e compre 1 carta.', rarity: 'uncommon', faction: 'asgard', tags: ['controle'] }),

  tech('jact-escudo', 'Escudo de Fé', [
    FX('applyStatus', { target: 'activeAlly', status: 'shield', tokens: 1 })
  ], { text: 'Conceda Escudo ao seu Ativo (−30 de dano recebido).', rarity: 'rare', faction: 'asgard', tags: ['controle'] }),

  tech('jact-sentinela', 'Sentinela', [
    FX('drawCards', { amount: 1 }),
    FX('reduceDamage', { target: 'activeAlly', amount: 20, label: 'Sentinela' })
  ], { text: 'Compre 1 carta e reduza em 20 o dano recebido pelo seu Ativo neste turno.', rarity: 'common', faction: 'asgard', tags: ['controle'] }),

  // -------------------------------------------------------------------------
  // Midrange / economia (Morning Star) — recursos, consistência, liderança
  // -------------------------------------------------------------------------
  tech('jact-engenharia', 'Engenharia de Campo', [
    FX('searchDeck', { amount: 1, filter: { kinds: ['RESOURCE'] }, to: 'hand', prompt: 'Escolha uma Energia do baralho' })
  ], { text: 'Busque 1 Energia no seu baralho e coloque-a na mão.', rarity: 'uncommon', faction: 'morning-star', tags: ['midrange', 'economia'] }),

  tech('jact-planejamento', 'Planejamento de Mercado', [
    FX('drawCards', { amount: 2 }),
    FX('discardCards', { amount: 1, from: 'hand', prompt: 'Descarte 1 carta da mão' })
  ], { text: 'Compre 2 cartas e descarte 1 da sua mão.', rarity: 'uncommon', faction: 'morning-star', tags: ['midrange'] }),

  tech('jact-lideranca', 'Comando de Liderança', [
    FX('heal', { target: 'activeAlly', amount: 20 }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Cure 20 do seu Ativo e compre 1 carta.', rarity: 'uncommon', faction: 'morning-star', tags: ['midrange'] }),

  tech('jact-reciclagem', 'Reciclagem', [
    FX('shuffleIntoDeck', { from: 'discard', amount: 3 }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Embaralhe 3 cartas do seu descarte de volta ao baralho e compre 1 carta.', rarity: 'uncommon', faction: 'morning-star', tags: ['midrange', 'economia'] }),

  tech('jact-contingencia', 'Plano de Contingência', [
    FX('reduceDamage', { target: 'activeAlly', amount: 30, label: 'Contingência' }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Reduza em 30 o dano recebido pelo seu Ativo neste turno e compre 1 carta.', rarity: 'rare', faction: 'morning-star', tags: ['midrange', 'defesa'] }),

  // -------------------------------------------------------------------------
  // Burst / troca (Bastard Gran Tubarões XYZ) — pressão, finishers, troca
  // -------------------------------------------------------------------------
  tech('jact-ruptura', 'Ruptura', [
    FX('dealDamage', { target: 'enemyActive', amount: 15, label: 'Ruptura' }),
    FX('conditionalEffect', {
      condition: { op: 'hasStatus', status: 'marked', target: 'enemyActive' },
      then: [FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'Ruptura em Marca' })]
    })
  ], { text: 'Cause 15 de dano ao Ativo inimigo; +20 se ele estiver Marcado.', rarity: 'rare', faction: 'bastard-gran-tubaroes-xyz', tags: ['burst'] }),

  tech('jact-allin', 'All-In Tubarão', [
    FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'All-In' }),
    FX('dealDamage', { target: 'self', amount: 15, label: 'Recuo do All-In' })
  ], { text: 'Cause 20 de dano ao Ativo inimigo e 15 de dano ao seu Ativo.', rarity: 'uncommon', faction: 'bastard-gran-tubaroes-xyz', tags: ['burst', 'risco'] }),

  tech('jact-dentes', 'Dentes Expostos', [
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 2 }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Mordida' })
  ], { text: 'Marque o Ativo inimigo por 2 turnos e cause 10 de dano.', rarity: 'common', faction: 'bastard-gran-tubaroes-xyz', tags: ['burst'] }),

  tech('jact-troca-violenta', 'Troca Violenta', [
    FX('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Troca Violenta' })
  ], { text: 'Descarte 1 Energia do Ativo inimigo e cause 10 de dano.', rarity: 'uncommon', faction: 'bastard-gran-tubaroes-xyz', tags: ['burst', 'disrupção'] }),

  // -------------------------------------------------------------------------
  // Disrupção / negação (Rainbow Six) — Energy denial, posicionamento, silêncio
  // -------------------------------------------------------------------------
  tech('jact-blackout', 'Blackout Tático', [
    FX('applyStatus', { target: 'enemyActive', status: 'silence', tokens: 2 })
  ], { text: 'Silencie o Agente Ativo inimigo (habilidades bloqueadas) por 2 turnos.', rarity: 'uncommon', faction: 'rainbow-six', tags: ['disrupção'] }),

  tech('jact-sabotagem', 'Sabotagem de Canal', [
    FX('detachResource', { target: 'enemyActive', amount: 1, to: 'discard' }),
    FX('drawCards', { amount: 1 })
  ], { text: 'Descarte 1 Energia do Ativo inimigo e compre 1 carta.', rarity: 'uncommon', faction: 'rainbow-six', tags: ['disrupção', 'energy denial'] }),

  tech('jact-interdicao', 'Interdição', [
    FX('applyStatus', { target: 'enemyActive', status: 'stun', tokens: 1 }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Interdição' })
  ], { text: 'Atordoe o Ativo inimigo (não ataca nem recua) e cause 10 de dano.', rarity: 'rare', faction: 'rainbow-six', tags: ['disrupção'] }),

  tech('jact-zona-de-combate', 'Zona de Combate', [
    FX('forceEnemySwitch')
  ], { text: 'Force o adversário a trocar o Agente Ativo por um da Reserva dele.', rarity: 'rare', faction: 'rainbow-six', tags: ['disrupção', 'posicionamento'] }),

  tech('jact-nevoa', 'Névoa de Cobertura', [
    FX('applyStatus', { target: 'enemyActive', status: 'confusion', tokens: 1 }),
    FX('reduceDamage', { target: 'activeAlly', amount: 20, label: 'Cobertura' })
  ], { text: 'Confunda o Ativo inimigo (30% de se ferir ao atacar) e reduza em 20 o dano recebido pelo seu Ativo neste turno.', rarity: 'uncommon', faction: 'rainbow-six', tags: ['disrupção'] }),

  // -------------------------------------------------------------------------
  // Tempo / setup (Platinum) — precisão, controle de ritmo, setup
  // -------------------------------------------------------------------------
  tech('jact-precisao', 'Tiro de Precisão', [
    FX('dealDamage', { target: 'enemyActive', amount: 15, label: 'Precisão' }),
    FX('applyStatus', { target: 'enemyActive', status: 'root', tokens: 1 })
  ], { text: 'Cause 15 de dano e Imobilize o Ativo inimigo (não recua).', rarity: 'uncommon', faction: 'platinum', tags: ['tempo'] }),

  tech('jact-preparacao', 'Preparação', [
    FX('searchDeck', { amount: 1, filter: { kinds: ['CHARACTER'] }, to: 'hand', prompt: 'Escolha um Agente do baralho' })
  ], { text: 'Busque 1 Agente no seu baralho e coloque-o na mão.', rarity: 'uncommon', faction: 'platinum', tags: ['tempo', 'setup'] }),

  tech('jact-gambito', 'Gambito Calculado', [
    FX('coinFlip', { chance: 0.5, label: 'Gambito', then: [FX('drawCards', { amount: 2 })], else: [FX('discardCards', { amount: 1, from: 'hand', prompt: 'Descarte 1 carta' })] })
  ], { text: '50%: compre 2 cartas; senão, descarte 1 carta da mão.', rarity: 'common', faction: 'platinum', tags: ['tempo', 'risco'] }),

  tech('jact-antecipacao', 'Antecipação', [
    FX('drawCards', { amount: 1 }),
    FX('increaseDamage', { target: 'activeAlly', amount: 15, label: 'Antecipação' })
  ], { text: 'Compre 1 carta; o próximo ataque do seu Ativo causa +15 de dano neste turno.', rarity: 'uncommon', faction: 'platinum', tags: ['tempo'] }),

  tech('jact-contragolpe', 'Contragolpe', [
    FX('reduceDamage', { target: 'activeAlly', amount: 30, label: 'Contragolpe' }),
    FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Contragolpe' })
  ], { text: 'Reduza em 30 o dano recebido pelo seu Ativo neste turno e cause 10 de dano ao Ativo inimigo.', rarity: 'rare', faction: 'platinum', tags: ['tempo', 'defesa'] }),

  // -------------------------------------------------------------------------
  // Sustain / âncora (Weigon) — resistência, cura, inevitabilidade
  // -------------------------------------------------------------------------
  tech('jact-regeneracao', 'Regeneração Ativa', [
    FX('applyStatus', { target: 'activeAlly', status: 'regeneration', tokens: 2 })
  ], { text: 'Seu Ativo ganha Regeneração (cura 20 no fim de cada turno) por 2 turnos.', rarity: 'uncommon', faction: 'weigon', tags: ['sustain'] }),

  tech('jact-ancora', 'Âncora de Linha', [
    FX('heal', { target: 'activeAlly', amount: 40 }),
    FX('applyStatus', { target: 'activeAlly', status: 'root', tokens: 1 })
  ], { text: 'Cure 40 do seu Ativo, mas o Imobilize (não recua) por 1 turno.', rarity: 'rare', faction: 'weigon', tags: ['sustain'] }),

  tech('jact-resiliencia', 'Resiliência de Equipe', [
    FX('heal', { target: 'allAllies', amount: 20 }),
    FX('applyStatus', { target: 'allAllies', status: 'tenacity', tokens: 1 })
  ], { text: 'Cure 20 de todos os seus Agentes e conceda Tenacidade a todos.', rarity: 'rare', faction: 'weigon', tags: ['sustain', 'equipe'] }),

  tech('jact-fortaleza', 'Fortaleza de Campo', [
    FX('heal', { target: 'activeAlly', amount: 30 }),
    FX('reduceDamage', { target: 'activeAlly', amount: 20, label: 'Fortaleza' })
  ], { text: 'Cure 30 do seu Ativo e reduza em 20 o dano recebido por ele neste turno.', rarity: 'uncommon', faction: 'weigon', tags: ['sustain'] }),

  // -------------------------------------------------------------------------
  // Combo / caçada (Salvatore) — Marca, valor condicional, inevitabilidade
  // -------------------------------------------------------------------------
  tech('jact-cacada', 'Caçada', [
    FX('applyStatus', { target: 'enemyActive', status: 'marked', tokens: 2 }),
    FX('conditionalEffect', {
      condition: { op: 'hadStatus', status: 'marked', target: 'enemyActive' },
      then: [FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'Presas Marcadas' })]
    })
  ], { text: 'Marque o Ativo inimigo por 2 turnos; se ele JÁ estava Marcado, cause +20 de dano.', rarity: 'rare', faction: 'salvatore', tags: ['combo', 'marca'] }),

  tech('jact-cadeia', 'Cadeia de Valor', [
    FX('drawCards', { amount: 1 }),
    FX('conditionalEffect', {
      condition: { op: 'discardAtLeast', count: 5, side: 'source' },
      then: [FX('drawCards', { amount: 1 })]
    })
  ], { text: 'Compre 1 carta; +1 carta se você tiver 5+ cartas no descarte.', rarity: 'uncommon', faction: 'salvatore', tags: ['combo'] }),

  tech('jact-climax', 'Clímax de Caçada', [
    FX('conditionalEffect', {
      condition: { op: 'benchAtLeast', value: 3, side: 'source' },
      then: [FX('dealDamage', { target: 'enemyActive', amount: 20, label: 'Clímax' })],
      else: [FX('dealDamage', { target: 'enemyActive', amount: 10, label: 'Clímax' })]
    })
  ], { text: 'Cause 20 de dano ao Ativo inimigo (10 se você tiver menos de 3 Agentes em campo).', rarity: 'rare', faction: 'salvatore', tags: ['combo'] }),

  // -------------------------------------------------------------------------
  // Táticas genéricas (flex)
  // -------------------------------------------------------------------------
  tech('jact-troca-limpa', 'Troca Limpa', [
    FX('removeStatus', { target: 'activeAlly', status: 'all' }),
    FX('switchActive')
  ], { text: 'Purifique seu Ativo e troque-o por um Agente da Reserva (sem pagar recuo).', rarity: 'rare', tags: ['manobra'] }),

  tech('jact-reflexo', 'Reflexo de Combate', [
    FX('drawCards', { amount: 1 }),
    FX('reduceDamage', { target: 'activeAlly', amount: 15, label: 'Reflexo' })
  ], { text: 'Compre 1 carta e reduza em 15 o dano recebido pelo seu Ativo neste turno.', rarity: 'common', tags: ['defesa'] })
];
