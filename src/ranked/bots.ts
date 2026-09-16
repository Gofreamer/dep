/**
 * BOTS DA LIGA — elenco de adversários IA da Liga Ranqueada JET.
 *
 * Regras de fair-play (a IA nunca trapaceia):
 *  - o bot escolhe o ARQUÉTIPO antes de ver qualquer informação privada
 *    (mão/deck do humano) — nunca há contra-pick;
 *  - o perfil de IA só modula PESOS de avaliação sobre o estado PÚBLICO;
 *  - o bot joga com o MESMO engine e as MESMAS regras do humano (custos,
 *    Energia, sorte de coinFlip via seed determinística).
 *
 * StellaPrime (agressiva, #1 inicial, dificuldade 90%) e Luna underdog
 * (controle, #2 inicial, dificuldade 86%) são os âncoras do topo — mas NENHUM
 * bot tem posição travada: um humano pode ultrapassá-los e tomar o #1.
 */

import type { AiProfile } from '../engine/ai/profile';
import { LUNA_PROFILE, PROFILE_LEVELS, STELLA_PROFILE } from '../engine/ai/profile';

export interface BotDef {
  id: string;
  name: string;
  /** id do arquétipo (ARCHETYPE_DECKS) que o bot joga sempre. */
  archetypeId: string;
  /** Rating inicial (Elo). Determina a posição inicial no ladder. */
  initialRating: number;
  /** Dificuldade declarada (0-100) — usada na UI e para derivar o perfil. */
  difficulty: number;
  /** Personalidade/texto de sabor exibido no matchmaking. */
  blurb: string;
  /** Perfil de IA (weights públicos). */
  profile: AiProfile;
}

/** Deriva um perfil de IA a partir da dificuldade declarada (0-100). */
export function profileForDifficulty(difficulty: number): AiProfile {
  if (difficulty >= 90) return PROFILE_LEVELS.elite;
  if (difficulty >= 78) return PROFILE_LEVELS.hard;
  if (difficulty >= 50) return PROFILE_LEVELS.normal;
  return PROFILE_LEVELS.easy;
}

const BOTS: BotDef[] = [
  {
    id: 'bot-stella-prime', name: 'StellaPrime', archetypeId: 'archetype-aggro', initialRating: 2460, difficulty: 90,
    blurb: 'A líder da temporada. Pressão implacável desde o primeiro turno.',
    // fonte ÚNICA: o perfil mora em `src/engine/ai/profile.ts` (a 2.0 tinha
    // STELLA_PROFILE/LUNA_PROFILE definidos e não usados — os bots repetiam
    // pesos parecidos inline, e as duas cópias divergiam em silêncio).
    profile: STELLA_PROFILE
  },
  {
    id: 'bot-luna-underdog', name: 'Luna underdog', archetypeId: 'archetype-control', initialRating: 2390, difficulty: 86,
    blurb: 'A azarã que virou muralha. Controle paciente, cura e inevitabilidade.',
    profile: LUNA_PROFILE
  },
  { id: 'bot-moirai', name: 'Moirai', archetypeId: 'archetype-midrange', initialRating: 2310, difficulty: 82, blurb: 'Economia de recursos e vantagem incremental.', profile: PROFILE_LEVELS.hard },
  { id: 'bot-vex-9', name: 'vex_exe', archetypeId: 'archetype-burst', initialRating: 2240, difficulty: 80, blurb: 'Janela explosiva: prepara e converte tudo num turno.', profile: PROFILE_LEVELS.hard },
  { id: 'bot-noia', name: 'noia_gringa', archetypeId: 'archetype-disruption', initialRating: 2170, difficulty: 78, blurb: 'Nega o plano do oponente antes que ele comece.', profile: PROFILE_LEVELS.hard },
  { id: 'bot-pulso', name: 'CaduNogueira', archetypeId: 'archetype-tempo', initialRating: 2100, difficulty: 74, blurb: 'Controla o ritmo e pune cada erro de posicionamento.', profile: PROFILE_LEVELS.hard },
  { id: 'bot-mare', name: 'MareAlta93', archetypeId: 'archetype-sustain', initialRating: 2030, difficulty: 72, blurb: 'Sustentação: sobrevive até o oponente quebrar.', profile: { ...PROFILE_LEVELS.hard, aggression: 0.45 } },
  { id: 'bot-vidente', name: 'TiaZica', archetypeId: 'archetype-combo', initialRating: 1960, difficulty: 70, blurb: 'Marca a presa e desfere o golpe inevitável.', profile: PROFILE_LEVELS.hard },
  { id: 'bot-chama-neon', name: 'ChamaNeon', archetypeId: 'archetype-aggro', initialRating: 1890, difficulty: 62, blurb: 'Rush puro: velocidade acima de tudo.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-ferro-vivo', name: 'FerroVivoBR', archetypeId: 'archetype-control', initialRating: 1820, difficulty: 60, blurb: 'Muralha paciente que nunca desiste.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-bardo', name: 'bardokiller', archetypeId: 'archetype-midrange', initialRating: 1750, difficulty: 58, blurb: 'Valor em todas as linhas.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-rixa', name: 'RixaDeRua', archetypeId: 'archetype-burst', initialRating: 1680, difficulty: 56, blurb: 'Troca violenta de recursos.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-cifra', name: 'cifra_clara', archetypeId: 'archetype-disruption', initialRating: 1610, difficulty: 54, blurb: 'Silêncio e dreno.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-ciclone', name: 'ciclone_do_bem', archetypeId: 'archetype-tempo', initialRating: 1540, difficulty: 52, blurb: 'Tempo e imobilização.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-ancora', name: 'Ancorinha22', archetypeId: 'archetype-sustain', initialRating: 1470, difficulty: 50, blurb: 'Regeneração lenta e constante.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-espreita', name: 'EspreitaFria', archetypeId: 'archetype-combo', initialRating: 1400, difficulty: 48, blurb: 'Paciência de caçador.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-pantera', name: 'PanteraRosa77', archetypeId: 'archetype-aggro', initialRating: 1330, difficulty: 40, blurb: 'Instinto agressivo.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-serena', name: 'SerenaTranquila', archetypeId: 'archetype-control', initialRating: 1260, difficulty: 38, blurb: 'Calma sob pressão.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-mercador', name: 'MercadorDeIdeias', archetypeId: 'archetype-midrange', initialRating: 1190, difficulty: 36, blurb: 'Negocia cada recurso.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-ondas', name: 'Ondas99', archetypeId: 'archetype-burst', initialRating: 1120, difficulty: 34, blurb: 'Maré de dano.', profile: PROFILE_LEVELS.normal },
  { id: 'bot-estatica', name: 'EstaticaFM', archetypeId: 'archetype-disruption', initialRating: 1050, difficulty: 30, blurb: 'Interferência constante.', profile: PROFILE_LEVELS.easy },
  { id: 'bot-relogio', name: 'RelogioDePonto', archetypeId: 'archetype-tempo', initialRating: 980, difficulty: 28, blurb: 'Cada segundo conta.', profile: PROFILE_LEVELS.easy },
  { id: 'bot-laguna', name: 'LagunaAzul', archetypeId: 'archetype-sustain', initialRating: 910, difficulty: 26, blurb: 'Aguenta firme.', profile: PROFILE_LEVELS.easy },
  { id: 'bot-faro', name: 'FaroFino13', archetypeId: 'archetype-combo', initialRating: 840, difficulty: 24, blurb: 'Segue a pista.', profile: PROFILE_LEVELS.easy }
];

/**
 * Apelido normalizado (o que vale como username no cadastro). `src/ranked/auth`
 * no worker aplica `normalizeUsername` antes de comparar; aqui mantemos a forma
 * canônica para que a reserva funcione mesmo sem o worker (o charset é o mesmo
 * de `isValidUsername`: a-z0-9_-).
 */
export function botUsername(name: string): string {
  // separadores SOMENTEM: 'Luna underdog', 'luna_underdog', 'Luna-Underdog' e
  // 'luna.underdog' são o mesmo handle para quem lê o ladder, e um humano
  // registrando qualquer um deles se passaria pelo bot na tela da liga.
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Nomes de bot reservados: humanos NÃO podem se cadastrar com eles. Inclui o
 * apelido normalizado E o `bot.id` (é por esse id que o perfil do bot vive no
 * banco — uma conta humana com o mesmo nome quebraria a identidade do ladder).
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set(
  BOTS.flatMap((b) => [botUsername(b.name), b.id.toLowerCase()])
);

/** O username (já normalizado) colide com algum bot da liga? */
export function isReservedUsername(username: string): boolean {
  const key = botUsername(username);
  return RESERVED_USERNAMES.has(key) || RESERVED_USERNAMES.has(username.toLowerCase());
}

export const BOT_ROSTER: ReadonlyArray<BotDef> = BOTS;

/**
 * Tamanho do elenco — TODA documentação/UI deve derivar daqui (o README da 2.0
 * dizia "22 bots" com 24 no código).
 */
export const BOT_COUNT = BOTS.length;

export function botById(id: string): BotDef | undefined {
  return BOTS.find((b) => b.id === id);
}

/** Nome amigável exibido (mantém "Luna underdog" e "StellaPrime" exatos). */
export function botDisplayName(bot: BotDef): string {
  return bot.name;
}
