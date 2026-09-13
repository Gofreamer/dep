/**
 * Re-exports de compatibilidade do CORE SET JET.
 *
 * O conteúdo foi reorganizado em módulos por categoria (techniques.ts,
 * equipment.ts, fields.ts, team.ts) para o Core Set 2.0 expandido. Este
 * arquivo preserva os imports antigos (`JET_TECHNIQUES`, `JET_EQUIPMENT`,
 * `JET_FIELDS`) sem quebrar callers existentes.
 */
export { JET_TECHNIQUES } from './techniques';
export { JET_EQUIPMENT } from './equipment';
export { JET_FIELDS } from './fields';
