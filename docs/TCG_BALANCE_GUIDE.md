# JET TCG — Guia de Balanceamento

Referência interna para criar cartas novas com números consistentes (evita
balanceamento arbitrário). O alvo é **identidade percebida em partida**, não
simetria perfeita.

## Orçamento interno (v0 — CORE SET Alpha)

Premissas: partida alvo de **8–14 turnos**, alvo de **4 Pontos de Vitória**,
baralho 60, 1 Energia JET conectada por turno, 1 recuo/turno, ataque encerra o
turno, agente não ataca no turno em que entra.

| Recurso | Valor de referência |
|---|---|
| 1 ponto de vida | 1 |
| 1 ponto de dano direto | 1 |
| 1 Energia JET de aceleração (uma vez) | ~15 |
| Comprar 1 carta | ~12 |
| Curar 10 | ~6 (menos que dano: não avança o plano de jogo) |
| Aplicar status forte (stun/silêncio, 1 turno) | ~20 |
| Status fraco (veneno 10/turno) | ~8 por marcador |
| Troca gratuita de Ativo | ~15 |
| Reduzir custo de ataque em 1 | ~15 |
| Descartar Energia inimiga | ~15 |
| +1 PV de valor de vitória (victoryValue) | ~30 de "força total" |

**HP base de Agente curado:** 90–130 (Duelist/Breaker no piso; Guardian/
Commander no teto). **Dano de ataque:** custo 1 ⇒ 10–20; custo 2 ⇒ 30–40;
custo 3+ ⇒ 50–70 com efeito condicional ou adicional.

`victoryValue`: agentes comuns 1; agentes centrais do deck 2; agente
"boss"/lendário 3. Não ligado à raridade (raridade ≠ poder — Parte 10).

## Regras de ouro

1. **Raridade representa disponibilidade/complexidade/tratamento visual —
   nunca números maiores.** Uma carta lendária deve ter um *design* diferente,
   não a mesma carta +50%.
2. **Holo é cosmético.** Zero impacto em stats (testado:
   `invariants.test.ts > 24. holo não modifica stats`).
3. **Edições são side grades.** Uma edição especial troca estratégia (outra
   habilidade, outro custo, outro tradeoff) — nunca "a mesma carta mais
   forte".
4. **O diferencial vem de mecânicas, não de números.** Evite
   "Agente A: 50 / B: 60 / C: 70". Cada agente deve jogar diferente.
5. **Nada de pay-to-win:** a cópia 4ª de uma carta rara não pode valer mais
   que a curva; limites por `identityId` impedem empilhar variantes.

## Conversão de papéis (identidade competitiva → mecânica TCG)

| Papel (Jet Tactics) | Tradução para o TCG |
|---|---|
| **Support** | Energia JET para aliados, compra, cura, troca de Ativo, fortalecer a Reserva, reduzir custos, proteção |
| **Breaker** | Dano alto, quebra de escudos, descarte de Energia, punição de feridos, potencial de nocaute |
| **Controller** | Limitar ações, aplicar status, aumentar custos, trocar o Ativo inimigo, manipular mão/campo |
| **Guardian** | Reduzir dano, proteger aliados, curar, impedir troca, escudos |
| **Duelist** | Alto dano individual, recompensar confronto 1v1, mais forte contra o Ativo isolado, ataques condicionais |
| **Commander** | Sinergia de equipe, bônus à Reserva, coordenação de atacantes |

Passiva → Ability passiva/aura; Skill → ataque barato ou habilidade ativável
de custo baixo; Signature → ataque caro/estratégico. Nenhum dos três é
Suprema por padrão — Suprema só com indicação oficial da fonte.

## Curva de deck starter

- 14–18 Energias JET (mín. 12 se houver aceleração).
- 10–14 Agentes (3–5 Base "líder" + apoio).
- 16–22 Técnicas.
- 4–8 Equipamentos, 0–4 Campos.
- Curva de custo de ataque: ≥60% dos ataques com custo ≤2.

## Checklist de nova carta

1. Qual papel ela representa? (a mecânica principal corresponde?)
2. Custo × efeito dentro da tabela acima (±15%)?
3. Funciona sem interação com cartas específicas? (deve)
4. Rompe conservação de cartas? (não pode — salvo token `generated: true`)
5. Raridade/holo mudam números? (não)
6. Testes cobrindo o comportamento declarado? (obrigatório)
