/**
 * Centralized terminology + product configuration.
 *
 * The engine speaks in generic internal concepts (CHARACTER, RESOURCE,
 * UPGRADE…). Everything the player sees comes from this file — adapting the
 * game to another universe (e.g. JET: Agente / Energia JET / Técnica /
 * Despertar…) means editing this map, not the engine.
 */
export interface Terminology {
  title: string;
  subtitle: string;
  characterSingular: string;
  characterPlural: string;
  resourceName: string;
  resourcePlural: string;
  activeZoneName: string;
  benchZoneName: string;
  discardZoneName: string;
  deckZoneName: string;
  handZoneName: string;
  upgradeName: string;
  upgradeVerb: string;
  actionCardName: string;
  actionCardPlural: string;
  equipmentCardName: string;
  equipmentCardPlural: string;
  fieldCardName: string;
  fieldCardPlural: string;
  victoryPointName: string;
  victoryPointAbbrev: string;
  stageLabels: string[];
  kindNames: Record<string, { singular: string; plural: string }>;
  attackName: string;
  attacksName: string;
  abilityName: string;
  abilitiesName: string;
  weaknessName: string;
  resistanceName: string;
  retreatName: string;
  hpName: string;
  statusNames: Record<string, string>;
  errorTexts: Record<string, string>;
}

export const TERMINOLOGY: Terminology = {
  title: 'NEXO',
  subtitle: 'Jogo de Cartas de Batalha',
  characterSingular: 'Personagem',
  characterPlural: 'Personagens',
  resourceName: 'Recurso',
  resourcePlural: 'Recursos',
  activeZoneName: 'Ativo',
  benchZoneName: 'Reserva',
  discardZoneName: 'Descarte',
  deckZoneName: 'Baralho',
  handZoneName: 'Mão',
  upgradeName: 'Evolução',
  upgradeVerb: 'Evoluir',
  actionCardName: 'Ação',
  actionCardPlural: 'Ações',
  equipmentCardName: 'Equipamento',
  equipmentCardPlural: 'Equipamentos',
  fieldCardName: 'Campo',
  fieldCardPlural: 'Campos',
  victoryPointName: 'Ponto de Vitória',
  victoryPointAbbrev: 'PV',
  stageLabels: ['Base', 'Estágio 1', 'Estágio 2'],
  kindNames: {
    CHARACTER: { singular: 'Personagem', plural: 'Personagens' },
    RESOURCE: { singular: 'Recurso', plural: 'Recursos' },
    ACTION: { singular: 'Ação', plural: 'Ações' },
    EQUIPMENT: { singular: 'Equipamento', plural: 'Equipamentos' },
    FIELD: { singular: 'Campo', plural: 'Campos' }
  },
  attackName: 'Ataque',
  attacksName: 'Ataques',
  abilityName: 'Habilidade',
  abilitiesName: 'Habilidades',
  weaknessName: 'Fraqueza',
  resistanceName: 'Resistência',
  retreatName: 'Recuo',
  hpName: 'HP',
  statusNames: {
    poison: 'Veneno',
    burn: 'Queimadura',
    stun: 'Atordoado',
    sleep: 'Dormindo',
    confusion: 'Confuso',
    silence: 'Silenciado',
    shield: 'Escudo',
    regeneration: 'Regeneração'
  },
  errorTexts: {
    not_your_turn: 'Não é o seu turno.',
    game_over: 'A partida já terminou.',
    not_setup: 'Ação válida apenas na preparação.',
    not_main: 'Ação válida apenas na fase principal.',
    bench_full: 'A reserva está cheia.',
    not_a_character: 'Selecione um personagem.',
    not_a_resource: 'Selecione um recurso.',
    not_an_action: 'Selecione uma carta de ação.',
    not_an_equipment: 'Selecione um equipamento.',
    not_a_field: 'Selecione um campo.',
    must_start_with_base: 'A partida começa com personagens Base.',
    no_active: 'Escolha um personagem ativo primeiro.',
    no_valid_target: 'Alvo inválido.',
    not_your_character: 'Esse personagem não é seu.',
    attach_limit: 'Você já conectou o máximo de recursos neste turno.',
    not_enough_resources: 'Recursos insuficientes.',
    no_slots: 'Sem espaço para equipamentos neste personagem.',
    unknown_attack: 'Ataque desconhecido.',
    unknown_ability: 'Habilidade desconhecida.',
    not_activated: 'Essa habilidade não é ativável.',
    ability_zone: 'Essa habilidade só funciona em outra posição.',
    abilities_blocked: 'As habilidades deste personagem estão bloqueadas.',
    already_used_turn: 'Habilidade já usada neste turno.',
    already_used_match: 'Habilidade já usada na partida.',
    condition_not_met: 'Condição não atendida.',
    status_blocks_attack: 'Este personagem não pode atacar agora.',
    cannot_attack: 'Este personagem não pode atacar.',
    just_deployed: 'Personagens não atacam no turno em que entram.',
    first_turn_no_attack: 'O jogador inicial não ataca no primeiro turno.',
    retreat_limit: 'Você já recuou neste turno.',
    cannot_retreat: 'Este personagem não pode recuar.',
    switching_blocked: 'Trocas estão bloqueadas pelo campo.',
    restriction_once_per_turn: 'Carta já usada neste turno.',
    restriction_losing: 'Só pode ser usada enquanto você está perdendo.',
    restriction_faction: 'Requer a presença de uma facção específica.',
    restriction_turn: 'Ainda muito cedo para esta carta.',
    restriction_condition: 'Condição não atendida.',
    choice_pending: 'Resolva a escolha pendente.',
    not_your_choice: 'Não é você quem decide.',
    unknown_command: 'Comando desconhecido.',
    invalid_upgrade: 'Esta carta não se aplica a esse personagem.'
  }
};

/** Product-level rule configuration (centralized — never scattered). */
export const PRODUCT_CONFIG = {
  deckRules: { min: 60, max: 60, maxCopies: 4, uniqueMax: 1, allowMultipleFactions: true },
  victoryTarget: 4,
  aiDifficultyDefault: 'normal' as 'easy' | 'normal' | 'hard'
};
