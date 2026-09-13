# JET TCG 2.0 — Meta Report

Gerado por `scripts/meta-sim.ts` — 1024 partidas reais IA×IA.

===== REGISTRY REPORT =====
JET CardDefs reais: 155
  Agentes BASE: 18
  Edições (variantes): 10
  Energia: 10
  Técnicas: 48
  Equipamentos: 26
  Campos: 19
  Equipe/sinergia: 24
  Identidades de agente: 18
Fixture/test CardDefs: 0
Outros CardDefs: 0
Total registry em teste: 155

## Meta Simulation — 1024 partidas (8 decks)

### Win rates
| Deck | Win rate | Turnos médios | Dano sofrido | Cura média | Energias | KOs |
|---|---|---|---|---|---|---|
| Pressão KOF 12 | 71.5% | 12.9 | 90 | 4 | 1.6 | 1.0 |
| Muralha Asgard | 60.9% | 23.0 | 135 | 61 | 2.7 | 0.7 |
| Comando Morning Star | 66.4% | 15.6 | 90 | 29 | 3.0 | 0.9 |
| Tubarões XYZ | 50.4% | 9.0 | 86 | 0 | 0.8 | 0.7 |
| Blackout R6 | 31.3% | 19.9 | 154 | 0 | 0.5 | 0.4 |
| Precisão Platinum | 36.3% | 10.7 | 97 | 0 | 1.0 | 0.5 |
| Âncora Weigon | 43.8% | 18.8 | 190 | 77 | 1.2 | 0.6 |
| Caçada Salvatore | 39.5% | 10.5 | 104 | 0 | 1.0 | 0.5 |

### Matchup matrix (linha = perspectiva da coluna de cima)
|  | Pressão KOF 12 | Muralha Asgard | Comando Morning Star | Tubarões XYZ | Blackout R6 | Precisão Platinum | Âncora Weigon | Caçada Salvatore |
|---|---|---|---|---|---|---|---|---|
| Pressão KOF 12 | 31.3% | 62.5% | 50.0% | 68.8% | 87.5% | 100.0% | 68.8% | 81.3% |
| Muralha Asgard | 56.3% | 62.5% | 25.0% | 50.0% | 81.3% | 56.3% | 62.5% | 62.5% |
| Comando Morning Star | 56.3% | 25.0% | 50.0% | 62.5% | 68.8% | 93.8% | 93.8% | 75.0% |
| Tubarões XYZ | 12.5% | 31.3% | 50.0% | 62.5% | 56.3% | 68.8% | 43.8% | 56.3% |
| Blackout R6 | 6.3% | 18.8% | 12.5% | 25.0% | 68.8% | 56.3% | 43.8% | 62.5% |
| Precisão Platinum | 18.8% | 31.3% | 37.5% | 37.5% | 68.8% | 37.5% | 56.3% | 43.8% |
| Âncora Weigon | 25.0% | 12.5% | 12.5% | 43.8% | 75.0% | 75.0% | 43.8% | 43.8% |
| Caçada Salvatore | 0.0% | 37.5% | 25.0% | 25.0% | 87.5% | 62.5% | 18.8% | 56.3% |

### Cartas mais usadas
- Energia JET (jres-energia): 6589×
- Tarruh (agent-tarruh-base): 1972×
- Wei Fang (agent-wei-fang-base): 1072×
- Henry (agent-henry-base): 873×
- Olivia Mih (agent-olivia-mih-base): 867×
- Tayná Lannister Müller (agent-tayna-lannister-muller-base): 854×
- Baek Seo-jin (agent-baek-seo-jin-base): 825×
- Ruby (agent-ruby-base): 755×
- Saki (agent-saki-base): 727×
- Wei Wang (agent-wei-wang-base): 657×
- Shirakami Niku (agent-shirakami-niku-base): 656×
- Xixim (agent-xixim-base): 578×
- Alice Westland (agent-alice-westland-base): 530×
- Hashika Gloves (agent-hashika-gloves-base): 475×
- Kaio (agent-kaio-base): 473×
- Ryan Smith (agent-ryan-smith-base): 413×
- Ran Yuki (agent-ran-yuki-base): 360×
- Mik Kashnov (agent-mik-kashnov-base): 348×
- Jenny (agent-jenny-base): 230×
- Rede de Comando (jsyn-ms-rede): 209×

### Cartas menos usadas
- Overclock (jres-overclock): 24×
- Isca Viva (jsyn-tub-isca): 28×
- Zona de Troca (jfd-zona-de-troca): 29×
- Relé de Transferência (jres-rele): 32×
- Rastro do Caçador (jsyn-salv-rastro): 35×
- Plano Mestre (jsyn-plat-plano): 37×
- Ultimato KOF (jeq-ultimato-kof): 41×
- Frenesi Tubarão (jsyn-tub-frenesi): 42×
- All-In Tubarão (jact-allin): 43×
- Luva de Caçador (jeq-luva-rapida): 46×
- Troca Violenta (jact-troca-violenta): 50×
- Respiro de Combate (jsyn-weigon-respiro): 52×
- Dentes Expostos (jact-dentes): 52×
- Espreita (jsyn-salv-espreita): 53×
- Estabilizador Vital (jres-estabilizador): 55×
- Colisão Tubarão (jeq-colisao-tubarao): 55×
- Bastião de Asgard (jfd-bastiao-asgard): 55×
- Protocolo Blackout (jeq-protocolo-r6): 57×
- Luneta de Precisão (jeq-luneta): 59×
- Maré Vermelha (jfd-mare-vermelha): 59×

### Cartas nunca usadas
- nenhuma

### ⚠️ Dominância universal (>65% contra o field inteiro)
- archetype-aggro: 71.5%
- archetype-midrange: 66.4%

### Nota de balanceamento
A IA usada na simulação (heurística + lookahead determinístico, sem trapaça)
favorece planos de jogo diretos (dano/cura/draw) em detrimento de planos
condicionais (combo, negação, sustain, setup). Decks de plano direto tendem a
superestimar contra decks de plano condicional; assimetrias de matchup são
aceitáveis, dominância universal não — alavancas de rebalance: densidade de
dano grátis, VP dos agentes, vantagem de saída e profundidade da IA por perfil.