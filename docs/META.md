# JET TCG 2.0 — Meta & Balanceamento

## Como a meta é medida

`scripts/meta-sim.ts` simula um torneio round-robin entre os **8 arquétipos
competitivos** (`src/data/jet/archetypes.ts`) usando o **MatchEngine real** —
cada partida é IA×IA determinística (seed derivada do pareamento + índice), com
a mesma IA de produção (heurística + lookahead, **sem trapaça**).

```bash
npm run meta:sim -- --games 16 --out reports/meta.md   # 8×8×16 = 1024 partidas
npm run meta:sim -- --games 4 --level normal            # IA mais rápida (smoke)
```

O relatório (`reports/meta.md` + `.json`) contém:

- win rate por deck;
- **matriz de matchup** (com alternância de quem começa para anular a vantagem
  de saída);
- turnos médios, dano sofrido, cura, energias conectadas e KOs por deck;
- cartas **mais/menos usadas** e **nunca usadas** (dentro do pool simulado).

## Os 8 arquétipos

| Arquétipo | Estratégia | Plano |
|---|---|---|
| Pressão KOF 12 | aggro | Marca + Exaustão, KO rápido |
| Muralha Asgard | control | cura + Tenacidade, inevitabilidade |
| Comando Morning Star | midrange | economia de cartas/recursos |
| Tubarões XYZ | burst | janela explosiva de troca |
| Blackout R6 | disruption | negação de Energia/habilidades |
| Precisão Platinum | tempo | controle de ritmo + setup |
| Âncora Weigon | sustain | regeneração e cura contínua |
| Caçada Salvatore | combo | Marca + valor condicional |

## Resultados e interpretação

A IA favorece **planos diretos** (dano/cura/draw) em detrimento de planos
**condicionais** (combo, negação, sustain, setup). Por isso, decks de plano
direto tendem a superestimar contra decks de plano condicional numa partida
IA×IA — isso é um **viés do avaliador**, não necessariamente do jogo.

- **Assimetrias de matchup são aceitáveis** (rock-paper-scissors saudável).
- **Dominância universal (>65% contra o field inteiro) é sinal de
  rebalanceamento** — o script avisa (exit code 1, ou `--soft` para CI).

### Alavancas de rebalanceamento (usadas nesta versão)

1. **Densidade de dano grátis** — ações grátis ficaram ABAIXO do tier de 1E
   (dano 10–20, não 20–40), para não esvaziar os ataques pagos.
2. **VP dos agentes** — agentes com `victoryValue` 2 são presas caras; decks
   aggro focam KO de agentes de 1 VP.
3. **Vantagem de saída** — a simulação alterna quem começa, então a matriz é
   simétrica por construção.
4. **Profundidade da IA por perfil** — easy/normal não fazem lookahead; hard/elite
   fazem depth 1–2 com beam.

### Curva de dano (soft)

| Custo | Dano típico |
|---|---|
| grátis (ação) | 10–20 |
| 1E | 15–40 |
| 2E | 40–75 |
| 3E | 70–115 |
| 4E | 105–160 |
| 5E | 150–220 |

Finishers de dano puro: **4E 130–150** (Colisão Tubarão 140, Tiro Decisivo 150,
Caçada Final 130) e **5E 170–200** (Impacto KOF 180). Finishers utilitários
trocam dano por cura/lockdown/draw (Muralha Final, Blackout Total, Âncora Final)
— são finishers de **plano**, não de burst. OHKO direto é limitado (nada acima
de 200 com um único golpe; alvos com Resistência/Tenacidade absorvem o pico).

## Como adicionar/ajustar um arquétipo

1. Edite `src/data/jet/archetypes.ts` (o `complete()` preenche até 60 com
   `jres-energia`).
2. Rode `npm run meta:sim -- --games 4` e leia a matriz.
3. Rebalanceie as cartas em `techniques.ts` / `team.ts` / `equipment.ts`.
4. Repita até não haver dominância universal (ou documente a assimetria).
