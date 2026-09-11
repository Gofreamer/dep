import React from 'react';
import { useApp, metaStore } from '../appStore';
import { validateDeck, deckStats } from '../../data/deckUtils';
import { JET_STARTER_DECKS } from '../../data/jet/starterDecks';
import { DEFAULT_CONFIG, type CardDef } from '../../engine/types';
import { TERMINOLOGY as T } from '../../data/terminology';
import { registry } from '../../engine/registry';
import { CardArt } from '../components/CardArt';

export const DeckSelectScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const startMatch = useApp((s) => s.startMatch);
  const openBuilder = useApp((s) => s.openBuilder);
  const [, force] = React.useState(0);
  const [selected, setSelected] = React.useState(metaStore.state.activeDeckId);
  const [oppDeck, setOppDeck] = React.useState<string>(() => metaStore.listDecks()[1]?.id ?? metaStore.listDecks()[0]?.id ?? '');
  const [difficulty, setDifficulty] = React.useState(metaStore.state.settings.difficulty);
  const [seedText, setSeedText] = React.useState('');

  const decks = metaStore.listDecks();

  // Prévia dos agentes do baralho selecionado (artes oficiais quando houver).
  const previewAgents = React.useMemo((): CardDef[] => {
    const selectedDeck = decks.find((d) => d.id === selected);
    if (!selectedDeck) return [];
    const seen = new Set<string>();
    const out: CardDef[] = [];
    for (const id of Object.keys(selectedDeck.cards)) {
      const def = registry.tryCard(id);
      if (!def || def.kind !== 'CHARACTER') continue;
      const key = def.identityId ?? def.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(def);
      if (out.length >= 8) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const play = () => {
    if (!selected) return;
    metaStore.setActiveDeck(selected);
    metaStore.state.settings.difficulty = difficulty;
    metaStore.save();
    const seed = seedText.trim() ? [...seedText].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) : Math.floor(Math.random() * 1e9);
    startMatch({ playerDeckId: selected, opponentDeckId: oppDeck, difficulty, seed });
  };

  return (
    <div className="screen deckselect-screen" data-testid="deck-select-screen">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => go('menu')} data-testid="deck-back">← Voltar</button>
        <h2>Escolha seu baralho</h2>
        <button className="btn" onClick={() => openBuilder(selected || null)}>✎ Editar</button>
      </header>

      <div className="deck-cards">
        {decks.map((d) => {
          const v = validateDeck(d.cards, DEFAULT_CONFIG.deckRules);
          const stats = deckStats(d.cards);
          return (
            <button key={d.id} className={`deck-option ${selected === d.id ? 'selected' : ''}`} onClick={() => setSelected(d.id)} data-testid={`deck-option-${d.id}`} aria-pressed={selected === d.id}>
              <b className="do-name">{d.name}</b>
              <small className="do-desc">{JET_STARTER_DECKS.find((s0) => s0.id === d.id)?.description ?? `Baralho personalizado — ${Object.keys(d.cards).length} tipos de carta`}</small>
              <div className="do-stats">
                <span>{stats.total} cartas</span>
                <span>{stats.byKind.CHARACTER ?? 0} {T.characterPlural.toLowerCase()}</span>
                <span>{stats.byKind.RESOURCE ?? 0} {T.resourcePlural.toLowerCase()}</span>
                <span>{stats.byKind.ACTION ?? 0} {T.actionCardPlural.toLowerCase()}</span>
              </div>
              {!v.valid && <span className="do-invalid">⚠ {v.errors[0]}</span>}
            </button>
          );
        })}
        <button className="deck-option new-deck" onClick={() => openBuilder(null)} data-testid="deck-option-new">
          <b>+ Novo baralho</b>
          <small>Comece do zero no construtor</small>
        </button>
      </div>

      {previewAgents.length > 0 && (
        <div className="deck-preview" aria-label="Agentes do baralho selecionado">
          <span className="deck-preview-label">Agentes:</span>
          {previewAgents.map((def) => (
            <span key={def.id} className="deck-preview-thumb" title={`${def.name}${def.edition ? ` · ${def.edition}` : ''}`}>
              <CardArt def={def} className="art-svg" />
            </span>
          ))}
        </div>
      )}

      <div className="match-setup">
        <label>
          Oponente:
          <select value={oppDeck} onChange={(e) => setOppDeck(e.target.value)} data-testid="deck-opponent" aria-label="Baralho do oponente">
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          Dificuldade:
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as any)} data-testid="deck-difficulty" aria-label="Dificuldade da IA">
            <option value="easy">Fácil</option>
            <option value="normal">Normal</option>
            <option value="hard">Difícil</option>
          </select>
        </label>
        <label>
          Semente (opcional):
          <input value={seedText} placeholder="aleatória" onChange={(e) => setSeedText(e.target.value)} data-testid="deck-seed" aria-label="Semente da partida" />
        </label>
        <button className="btn big primary" disabled={!selected} onClick={play} data-testid="deck-start">Batalhar!</button>
      </div>
      <p className="hint">Alvo: {DEFAULT_CONFIG.victory.targetPoints} {T.victoryPointName}s · {T.characterPlural}: {registry.allCards().filter((c) => c.kind === 'CHARACTER').length} no jogo</p>
    </div>
  );
};
