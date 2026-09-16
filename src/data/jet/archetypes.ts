import type { DeckDef } from '../deckUtils';

/**
 * ARQUÉTIPOS COMPETITIVOS JET 2.0 — 8 identidades de deck, cada uma com
 * plano, condição de vitória, forças, fraquezas e matchups (documentadas em
 * docs/META.md e verificadas pelo meta-sim).
 *
 * Todos os decks têm exatamente 60 cartas (a função `complete` preenche com
 * Energia JET básica o que faltar) e passam por validateDeck.
 */

/** Plano/condição de vitória de cada arquétipo (usado na UI e no meta-sim). */
export interface ArchetypeProfile {
  id: string;
  name: string;
  faction: string;
  strategy: 'aggro' | 'control' | 'midrange' | 'burst' | 'disruption' | 'tempo' | 'sustain' | 'combo';
  plan: string;
  winCondition: string;
  strengths: string[];
  weaknesses: string[];
  counters: string[];
}

export const ARCHETYPES: ArchetypeProfile[] = [
  {
    id: 'archetype-aggro', name: 'Pressão KOF 12', faction: 'kof-12', strategy: 'aggro',
    plan: 'Abre rápido, aplica Marca e Exaustão para negar a resposta e fecha com KO antes que o oponente estabilize.',
    winCondition: '4 Pontos de Vitória por KO sequencial (agentes de 1–2 PV são presas fáceis).',
    strengths: ['dano cedo consistente', 'Exaustão nega o contra-ataque', 'finisher 5E (Impacto KOF)'],
    weaknesses: ['recursos limitados a partir do turno 5', 'sucumbe a cura em equipe'],
    counters: ['Asgard (cura/mitigação)', 'Weigon (sustain)']
  },
  {
    id: 'archetype-control', name: 'Muralha Asgard', faction: 'asgard', strategy: 'control',
    plan: 'Estabiliza com Tenacidade/curas, nega o plano do oponente e vence por inevitabilidade de valor.',
    winCondition: 'Sobreviver à pressão e fechar com Bastião (finisher 4E) após o oponente ficar sem recursos.',
    strengths: ['cura em equipe', 'mitigação em camadas', 'finisher que também cura'],
    weaknesses: ['dano baixo por turno', 'lento contra combo/burst'],
    counters: ['Morning Star (economia superior)', 'Tubarões (burst rápido)']
  },
  {
    id: 'archetype-midrange', name: 'Comando Morning Star', faction: 'morning-star', strategy: 'midrange',
    plan: 'Gera valor incremental (draw, busca, purificação) e troca recursos favoravelmente até dominar o meio-jogo.',
    winCondition: 'Vantagem de cartas/energia convertida em pressão sustentada no late game.',
    strengths: ['consistência', 'flexibilidade de resposta', 'recupera do descarte'],
    weaknesses: ['sem dano explosivo', 'perde para aggro muito rápido'],
    counters: ['KOF (pressão)', 'Rainbow Six (negação de energia)']
  },
  {
    id: 'archetype-burst', name: 'Tubarões XYZ', faction: 'bastard-gran-tubaroes-xyz', strategy: 'burst',
    plan: 'Prepara uma janela (Marca/Isca) e converte tudo em um turno explosivo de troca.',
    winCondition: 'Finisher 4E (Colisão Tubarão) ou Frenesi em janela de KO.',
    strengths: ['dano explosivo', 'troca violenta de recursos', 'finisher ignora Resistência'],
    weaknesses: ['overcommit punível', 'recursos exauridos após o burst'],
    counters: ['Rainbow Six (silêncio/dreno)', 'Asgard (absorve o burst)']
  },
  {
    id: 'archetype-disruption', name: 'Blackout R6', faction: 'rainbow-six', strategy: 'disruption',
    plan: 'Nega o plano inimigo: drena Energia, silencia habilidades, atordoa e controla o posicionamento.',
    winCondition: 'Estragar a curva do oponente e fechar com Protocolo Blackout (finisher 5E de lockdown).',
    strengths: ['energy denial', 'negação de habilidades', 'finisher com lockdown duplo'],
    weaknesses: ['dano direto baixo', 'dependente de manter o controle'],
    counters: ['Morning Star (resiliência de recursos)', 'KOF (mata antes da negação importar)']
  },
  {
    id: 'archetype-tempo', name: 'Precisão Platinum', faction: 'platinum', strategy: 'tempo',
    plan: 'Controla o ritmo: ganha tempo com imobilização, prepara o board e acelera no momento certo.',
    winCondition: 'Tiro Decisivo (finisher 4E, ignora Resistência) após setup de energia/posição.',
    strengths: ['ignora Resistência', 'controle de ritmo', 'aceleração de Energia'],
    weaknesses: ['setup lento', 'poucos agentes na linha'],
    counters: ['Tubarões (burst antecipa o setup)', 'Rainbow Six (nega a aceleração)']
  },
  {
    id: 'archetype-sustain', name: 'Âncora Weigon', faction: 'weigon', strategy: 'sustain',
    plan: 'Âncora resistente: cura contínua, regeneração e inevitabilidade — sobrevive até o oponente quebrar.',
    winCondition: 'Âncora Final (finisher 5E que também cura 60) em inevitabilidade de longo prazo.',
    strengths: ['sustain extremo', 'regeneração em equipe', 'finisher defensivo-ofensivo'],
    weaknesses: ['dano acumulado baixo', 'lento — vulnerável a combo setup'],
    counters: ['Salvatore (combo de Marca)', 'KOF (rush antes da cura estabilizar)']
  },
  {
    id: 'archetype-combo', name: 'Caçada Salvatore', faction: 'salvatore', strategy: 'combo',
    plan: 'Marca a presa, acumula valor condicional e desfere um golpe inevitável quando a janela abre.',
    winCondition: 'Emboscada (50 em alvo Marcado) ou Caçada Final (finisher 4E +20 em Marca).',
    strengths: ['dano condicional alto', 'draw condicional', 'finisher que pune Marca'],
    weaknesses: ['dependente de manter a Marca', 'vulnerável a purificação'],
    counters: ['Asgard (purga a Marca)', 'Morning Star (purificação)']
  }
];

/** Preenche um baralho até 60 cartas com Energia JET básica. */
export function complete(cards: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...cards };
  const total = Object.values(out).reduce((s, n) => s + n, 0);
  if (total < 60) out['jres-energia'] = (out['jres-energia'] ?? 0) + (60 - total);
  if (total > 60) throw new Error(`deck com ${total} cartas (>60)`);
  return out;
}

export const ARCHETYPE_DECKS: DeckDef[] = [
  {
    id: 'archetype-aggro', name: 'Pressão KOF 12', description: 'Aggro: Marca + Exaustão e finisher 5E (Impacto KOF).',
    cards: complete({
      'agent-ran-yuki-base': 4, 'agent-xixim-base': 4, 'agent-shirakami-niku-base': 4, 'agent-jenny-base': 3,
      'jsyn-kof-furia': 2, 'jsyn-kof-ritmo': 2, 'jsyn-kof-troca-relampago': 2,
      'jact-primeiro-sangue': 2, 'jact-pressao-total': 2, 'jact-marca-quente': 2, 'jact-varredura': 2,
      // 2.1: o motor de "dano quase grátis" é o que levou este deck a 68%.
      // Redução de custo tem piso/teto na engine, e aqui ele também é mais raro:
      // 1× impulso + 1× catalisador (eram 2+2) e 1× lâmina a menos. O campo de
      // pressão sai de 3 para 2 cópias — a terceira era compra morta com o campo
      // já de pé. O restante do plano (marca + exaustão + 15 corpos) é intacto.
      'jeq-lamina-rubra': 2, 'jeq-impulso-kof': 1, 'jeq-ultimato-kof': 1,
      'jres-catalisador': 1, 'jfd-pressao-kof': 2
    })
  },
  {
    id: 'archetype-control', name: 'Muralha Asgard', description: 'Controle: cura + Tenacidade e finisher 4E (Muralha Final).',
    cards: complete({
      'agent-tarruh-base': 4, 'agent-alice-westland-base': 4, 'agent-tayna-lannister-muller-base': 4,
      'jsyn-asgard-baluarte': 2, 'jsyn-asgard-reconforto': 2, 'jsyn-asgard-muralha-gelo': 2,
      'jact-muralha': 3, 'jact-bencao': 2, 'jact-purga': 2, 'jact-escudo': 2, 'jact-sentinela': 3,
      'jeq-casco': 2, 'jeq-bastiao-asgard': 1, 'jfd-santuario-asgard': 2, 'jfd-bastiao-asgard': 1,
      'jres-condensador': 2
    })
  },
  {
    id: 'archetype-midrange', name: 'Comando Morning Star', description: 'Midrange: economia de cartas/recursos e finisher 5E (Comando Total).',
    cards: complete({
      'agent-ryan-smith-base': 4, 'agent-mik-kashnov-base': 4, 'agent-saki-base': 4, 'agent-henry-base': 3,
      'jsyn-ms-moral': 2, 'jsyn-ms-logistica': 2, 'jsyn-ms-rede': 2,
      'jact-planejamento': 3, 'jact-engenharia': 2, 'jact-lideranca': 2, 'jact-reciclagem': 2, 'jact-contingencia': 2,
      'jeq-visao': 2, 'jeq-comunicador': 2, 'jeq-comando-ms': 1, 'jfd-mercado-ms': 2
    })
  },
  {
    id: 'archetype-burst', name: 'Tubarões XYZ', description: 'Burst: janela explosiva e finisher 4E (Colisão Tubarão).',
    cards: complete({
      // 2.1: com 2 identidades (8 corpos) o deck morria em qualquer corrida —
      // `noActiveLoses` não dá tempo de resolver. Saki entra como terceiro corpo
      // barato (1E/20) para sustentar a janela de burst.
      'agent-kaio-base': 4, 'agent-ruby-base': 4, 'agent-saki-base': 4,
      'jsyn-tub-frenesi': 2, 'jsyn-tub-isca': 2, 'jsyn-tub-cacada-em-grupo': 2,
      'jact-ruptura': 3, 'jact-allin': 2, 'jact-dentes': 3, 'jact-troca-violenta': 2,
      'jeq-cristal': 3, 'jeq-colisao-tubarao': 2, 'jfd-mare-vermelha': 2, 'jfd-zona-de-troca': 1,
      'jres-overclock': 2
    })
  },
  {
    id: 'archetype-disruption', name: 'Blackout R6', description: 'Disrupção: negação de Energia/habilidades e finisher 5E (Blackout Total).',
    cards: complete({
      // 2.1: 8 corpos e HP 110 nos dois agentes = o deck perdia o race antes de
      // negar qualquer coisa. Tayna (Asgard, 110, 1E/10 + 2E/20) é o terceiro
      // corpo que segura a linha enquanto o blackout acumula. Não é buff de
      // carta: é densidade de corpos para o plano já existir.
      'agent-wei-fang-base': 4, 'agent-wei-wang-base': 4, 'agent-tayna-lannister-muller-base': 4,
      'jsyn-r6-interceptacao': 2, 'jsyn-r6-cerco': 2, 'jsyn-r6-supressao': 2,
      'jact-blackout': 3, 'jact-sabotagem': 3, 'jact-interdicao': 2, 'jact-zona-de-combate': 2, 'jact-nevoa': 2,
      'jeq-gerador': 2, 'jeq-reflexo-r6': 2, 'jeq-protocolo-r6': 1, 'jfd-zona-silenciosa': 2, 'jfd-blackout-geral': 1,
      'jres-dreno': 2
    })
  },
  {
    id: 'archetype-tempo', name: 'Precisão Platinum', description: 'Tempo: controle de ritmo e finisher 4E (Tiro Decisivo).',
    cards: complete({
      // 2.1: DECK MATEMATICAMENTE INVIÁVEL ANTES — 1 identidade × 4 cópias =
      // 4 agentes em campo com `noActiveLoses` ligado. Xixim dá o corpo rápido
      // (1E/20) e Henry o corpo de 130 PV com bônus de reserva, que é exatamente
      // o jogo de "ritmo" do Platinum. O plano (setup + Tiro Decisivo 4E que
      // ignora Resistência) continua o mesmo.
      'agent-baek-seo-jin-base': 4, 'agent-xixim-base': 4, 'agent-henry-base': 4,
      'jsyn-plat-mira': 2, 'jsyn-plat-plano': 2, 'jsyn-plat-execucao': 2,
      'jact-precisao': 3, 'jact-preparacao': 2, 'jact-gambito': 3, 'jact-antecipacao': 3, 'jact-contragolpe': 2,
      'jeq-luneta': 2, 'jeq-precisao-plat': 2, 'jfd-relogio': 2, 'jfd-zona-controlada': 2,
      'jres-rele': 2
    })
  },
  {
    id: 'archetype-sustain', name: 'Âncora Weigon', description: 'Sustain: regeneração em equipe e finisher 5E (Âncora Final).',
    cards: complete({
      // 2.1: 7 corpos → 12 (Tarruh a 4 + Alice Westland, que cura 20/turno).
      // Para não virar "partida infinita", a Regeneração cai de 3 para 2 cópias
      // e a Fonte de 2 para 1: o ganho de sobrevivência vem dos corpos, não de
      // mais cura empilhada — os turnos médios são conferidos pelo meta-sim.
      'agent-olivia-mih-base': 4, 'agent-tarruh-base': 4, 'agent-alice-westland-base': 4,
      'jsyn-weigon-mare': 2, 'jsyn-weigon-esta': 2, 'jsyn-weigon-respiro': 2,
      'jact-regeneracao': 2, 'jact-ancora': 2, 'jact-resiliencia': 2, 'jact-fortaleza': 3,
      'jeq-mochila': 2, 'jeq-essencia': 2, 'jeq-ancora-weigon': 2, 'jfd-fonte': 1, 'jfd-ancoradouro': 2,
      'jres-estabilizador': 2
    })
  },
  {
    id: 'archetype-combo', name: 'Caçada Salvatore', description: 'Combo: Marca + valor condicional e finisher 4E (Caçada Final).',
    cards: complete({
      // 2.1: terceira identidade (Ran Yuki) para chegar a 12 corpos, e as duas
      // cópias de Marca Quente entram porque o payoff do deck LÊ "Marcado" — sem
      // aplicador extra de Marca o combo dependia de comprar a peça única.
      'agent-hashika-gloves-base': 4, 'agent-ruby-base': 4, 'agent-ran-yuki-base': 4,
      'jsyn-salv-rastro': 2, 'jsyn-salv-emboscada': 2, 'jsyn-salv-espreita': 2,
      'jact-cacada': 3, 'jact-cadeia': 3, 'jact-climax': 2, 'jact-marca-quente': 2, 'jact-preparacao': 2,
      'jeq-luva-rapida': 2, 'jeq-cacada-salv': 2, 'jeq-cristal': 2, 'jfd-territorio-de-caca': 2,
      'jres-dreno': 2
    })
  }
];

export function archetypeDeck(id: string): DeckDef | undefined {
  return ARCHETYPE_DECKS.find((d) => d.id === id);
}
