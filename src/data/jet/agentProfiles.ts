import type { AgentTcgProfile } from '../../integrations/jet/converter';
import { profileKey } from '../../integrations/jet/importer';

/**
 * PERFIS TCG CURADOS dos agentes JET — a camada onde a identidade competitiva
 * do Jet Tactics (passiva/skill/signature/role) é convertida em mecânicas de
 * TCG (Partes 6 e 12 do produto). 100% data-driven: cada entrada registra
 * proveniência e status.
 *
 * ⚠ VAZIO ATÉ A CAPTURA DA FONTE: nenhum agente recebe perfil inventado.
 * Quando o snapshot oficial for importado, cada edição curada ganha aqui um
 * `AgentTcgProfile` com status 'CURATED'; edições oficiais sem perfil ficam
 * `TCG_PROFILE_PENDING` (não jogáveis, visíveis no catálogo como "aguardando
 * adaptação").
 */
export const AGENT_TCG_PROFILES: Record<string, AgentTcgProfile> = {};

/** Helper de autoriação para novos perfis. */
export function defineProfiles(...profiles: AgentTcgProfile[]): Record<string, AgentTcgProfile> {
  const out: Record<string, AgentTcgProfile> = {};
  for (const p of profiles) out[profileKey(p.agentId, p.edition)] = p;
  return out;
}

/**
 * Guia de conversão por papel (Parte 6) — REFERÊNCIA para perfis futuros.
 * Support      → Energia JET p/ aliados, compra, cura, troca de Ativo,
 *                fortalecimento da Reserva, redução de custos, proteção.
 * Breaker      → dano alto, quebra de escudos, descarte de Energia,
 *                punição de feridos, potencial de nocaute.
 * Controller   → limitar ações, aplicar status, aumentar custos, trocar o
 *                Ativo inimigo, manipular mão/campo.
 * Guardian     → reduzir dano, proteger aliados, curar, impedir troca, escudos.
 * Duelist      → alto dano individual, recompensar 1v1, mais forte contra o
 *                Ativo isolado, ataques condicionais.
 * Commander    → sinergia de equipe, bônus à Reserva, coordenação.
 */
export const ROLE_CONVERSION_GUIDE = true;
