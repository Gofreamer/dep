import type { DeckDef } from '../deckUtils';

/**
 * DECKS DE TUTORIAL JET — usados exclusivamente pelo fluxo guiado
 * (botão "Tutorial"). Compostos SOMENTE com cartas registradas pelo pack JET
 * (roster curado + auxiliares neutros). Nada aqui depende do fixture NEXO.
 *
 * deck-jet-tutorial-aluno: mão preparada pelo controller ensina —
 *   1) escolher Jenny como Ativa; 2) reservar Xixim; 3) confirmar setup;
 *   4) conectar Energia JET; 5) jogar Leitura de Combate; 6) equipar a
 *   Manopla Reforçada; 7) encerrar turno; 8) atacar; 9) ver derrota de
 *   Agente; 10) Pontos de Vitória.
 * deck-jet-tutorial-instrutor: deck curto do instrutor (IA easy) com agentes
 *   frágis para o aluno derrotar e aprender o ciclo de PV → PV de vitória.
 */
export const JET_TUTORIAL_DECKS: DeckDef[] = [
  {
    id: 'deck-jet-tutorial-aluno',
    name: 'Tutorial — Aluno',
    description: 'Baralho guiado do tutorial: Jenny, Xixim, energias e suporte.',
    cards: {
      'agent-jenny-base': 3, 'agent-xixim-base': 3, 'agent-ran-yuki-base': 2,
      'jres-energia': 26, 'jres-bateria': 2, 'jres-nucleo': 2,
      'jact-leitura': 3, 'jact-purificacao': 2, 'jact-recarga': 2, 'jact-foco-ofensivo': 2, 'jact-abre-espaco': 2, 'jact-corte-energia': 1,
      'jeq-manopla': 3, 'jeq-placa': 2,
      'jfd-arena': 2, 'jfd-ovacao': 2, 'jfd-zona-neutra': 1
    }
  },
  {
    id: 'deck-jet-tutorial-instrutor',
    name: 'Tutorial — Instrutor',
    description: 'Baralho do instrutor: Agentes frágis para aprender o ciclo de combate.',
    cards: {
      'agent-ruby-base': 2, 'agent-alice-westland-base': 2, 'agent-hashika-gloves-base': 2,
      'jres-energia': 25, 'jres-bateria': 2, 'jres-rele': 2, 'jres-descarga': 2,
      'jact-leitura': 3, 'jact-marcacao': 2, 'jact-corte-energia': 2, 'jact-rally': 2, 'jact-purificacao': 2,
      'jeq-propulsor': 3, 'jeq-ampulheta': 2, 'jeq-placa': 2,
      'jfd-arena': 3, 'jfd-ovacao': 1, 'jfd-zona-neutra': 1
    }
  }
];

/** Deck de tutorial por id (lookup usado pelo controller). */
export function jetTutorialDeck(id: string): DeckDef | undefined {
  return JET_TUTORIAL_DECKS.find((d) => d.id === id);
}
