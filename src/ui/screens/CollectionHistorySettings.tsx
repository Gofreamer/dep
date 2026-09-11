import React from 'react';
import { useApp, metaStore } from '../appStore';
import { allCardsSorted, CardMini } from '../components/CardView';
import { DefInspectModal } from '../components/Modals';
import type { CardDef, CardKind } from '../../engine/types';
import { TERMINOLOGY as T } from '../../data/terminology';
import { registry } from '../../engine/registry';
import { setSoundEnabled } from '../audio';

export const CollectionScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const [search, setSearch] = React.useState('');
  const [kind, setKind] = React.useState<CardKind | 'ALL'>('ALL');
  const [faction, setFaction] = React.useState('all');
  const [rarity, setRarity] = React.useState('all');
  const [edition, setEdition] = React.useState('all');
  const [onlyHolo, setOnlyHolo] = React.useState(false);
  const [onlyFav, setOnlyFav] = React.useState(false);
  const [groupByIdentity, setGroupByIdentity] = React.useState(true);
  const [inspect, setInspect] = React.useState<CardDef | null>(null);
  const [, force] = React.useState(0);
  const collection = metaStore.state.collection;
  const favorites = metaStore.state.favorites;

  const deckUsage = React.useMemo(() => {
    const usage: Record<string, number> = {};
    for (const deck of metaStore.listDecks()) {
      for (const [id, n] of Object.entries(deck.cards)) usage[id] = (usage[id] ?? 0) + n;
    }
    return usage;
  }, []);

  const toggleFav = (id: string) => {
    const st = metaStore.state;
    st.favorites = st.favorites.includes(id) ? st.favorites.filter((f) => f !== id) : [...st.favorites, id];
    metaStore.save();
    force((x) => x + 1);
  };

  const cards = allCardsSorted().filter((def) => {
    if (kind !== 'ALL' && def.kind !== kind) return false;
    if (faction !== 'all' && def.faction !== faction) return false;
    if (rarity !== 'all' && def.rarity !== rarity) return false;
    if (edition !== 'all' && (def.edition ?? 'BASE') !== edition) return false;
    if (onlyHolo && !def.holo) return false;
    if (onlyFav && !favorites.includes(def.id)) return false;
    if (search && !def.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // agrupamento por identidade: Jenny BASE + Jenny MVP aparecem juntas (Parte 23)
  const identityGroups = React.useMemo(() => {
    const groups = new Map<string, CardDef[]>();
    for (const def of cards) {
      const key = def.kind === 'CHARACTER' ? (def.identityId ?? def.id) : `__${def.kind}:${def.id}`;
      const list = groups.get(key) ?? [];
      list.push(def);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [cards]);

  return (
    <div className="screen collection-screen" data-testid="collection-screen">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => go('menu')}>← Voltar</button>
        <h2>Coleção — {cards.length} cartas</h2>
        <span className="record-badge">{metaStore.state.wins}V / {metaStore.state.losses}D</span>
      </header>
      <div className="filters">
        <input placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="collection-search" aria-label="Buscar carta" />
        <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
          <option value="ALL">Todos os tipos</option>
          {Object.entries(T.kindNames).map(([k, v]) => <option key={k} value={k}>{v.plural}</option>)}
        </select>
        <select value={faction} onChange={(e) => setFaction(e.target.value)}>
          <option value="all">Todas as facções</option>
          {registry.allFactions().map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          <option value="all">Raridades</option>
          <option value="common">Comum</option>
          <option value="uncommon">Incomum</option>
          <option value="rare">Rara</option>
          <option value="epic">Épica</option>
          <option value="legendary">Lendária</option>
        </select>
        <select value={edition} onChange={(e) => setEdition(e.target.value)}>
          <option value="all">Todas as edições</option>
          {[...new Set(allCardsSorted().map((d) => d.edition ?? 'BASE'))].map((ed) => <option key={ed} value={ed}>{ed}</option>)}
        </select>
        <label className="fav-toggle"><input type="checkbox" checked={onlyHolo} onChange={(e) => setOnlyHolo(e.target.checked)} /> ✧ Holo</label>
        <label className="fav-toggle"><input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> ★ Favoritas</label>
        <label className="fav-toggle"><input type="checkbox" checked={groupByIdentity} onChange={(e) => setGroupByIdentity(e.target.checked)} /> Agrupar por agente</label>
      </div>
      <div className="lib-grid collection">
        {(groupByIdentity ? identityGroups.flatMap(([, defs]) => defs) : cards).map((def) => (
          <div key={def.id} className={`lib-cell ${favorites.includes(def.id) ? 'fav' : ''}`}>
            <CardMini def={def} quantity={collection[def.id]} onClick={() => setInspect(def)} />
            <button className={`fav-btn ${favorites.includes(def.id) ? 'on' : ''}`} title="Favoritar" onClick={() => toggleFav(def.id)}>★</button>
            {deckUsage[def.id] ? <span className="usage-chip">{deckUsage[def.id]}× em baralhos</span> : null}
          </div>
        ))}
      </div>
      <DefInspectModal def={inspect} onClose={() => setInspect(null)} />
    </div>
  );
};

export const HistoryScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const decks = metaStore.listDecks();
  const deckName = (id: string) => decks.find((d) => d.id === id)?.name ?? id;
  const history = metaStore.state.history;
  return (
    <div className="screen history-screen" data-testid="history-screen">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => go('menu')}>← Voltar</button>
        <h2>Histórico de partidas</h2>
        <span className="record-badge">{metaStore.state.wins}V / {metaStore.state.losses}D</span>
      </header>
      {history.length === 0 && <p className="hint">Nenhuma partida ainda — vá jogar!</p>}
      <div className="history-list">
        {history.map((m) => (
          <div key={m.id} className={`history-line ${m.result}`}>
            <span className={`result ${m.result}`}>{m.result === 'win' ? 'Vitória' : 'Derrota'}</span>
            <span className="matchup">{deckName(m.playerDeckId)} vs {deckName(m.opponentDeckId)}</span>
            <span className="meta">Turno {m.turns} · {m.victoryPoints[0]}×{m.victoryPoints[1]} {T.victoryPointAbbrev}</span>
            <span className="date">{new Date(m.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SettingsScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const [, force] = React.useState(0);
  const settings = metaStore.state.settings;
  const patch = (p: Partial<typeof settings>) => {
    Object.assign(metaStore.state.settings, p);
    metaStore.save();
    force((x) => x + 1);
  };
  return (
    <div className="screen settings-screen" data-testid="settings-screen">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => go('menu')}>← Voltar</button>
        <h2>Ajustes</h2>
      </header>
      <div className="settings-body">
        <label>Nome do jogador <input value={settings.player1Name} onChange={(e) => patch({ player1Name: e.target.value })} /></label>
        <label>Dificuldade padrão
          <select value={settings.difficulty} onChange={(e) => patch({ difficulty: e.target.value as any })}>
            <option value="easy">Fácil</option>
            <option value="normal">Normal</option>
            <option value="hard">Difícil</option>
          </select>
        </label>
        <label>Velocidade da IA
          <select value={settings.speed} onChange={(e) => patch({ speed: e.target.value as any })}>
            <option value="slow">Lenta</option>
            <option value="normal">Normal</option>
            <option value="fast">Rápida</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.soundEnabled !== false}
            onChange={(e) => { patch({ soundEnabled: e.target.checked }); setSoundEnabled(e.target.checked); }}
            data-testid="settings-sound"
          /> Efeitos sonoros (tons curtos gerados no navegador)
        </label>
        <label className="check"><input type="checkbox" checked={settings.devMode} onChange={(e) => patch({ devMode: e.target.checked })} data-testid="settings-dev" /> Modo desenvolvedor (painel de debug nas partidas)</label>
        <label className="check"><input type="checkbox" checked={settings.tutorialDone} onChange={(e) => patch({ tutorialDone: e.target.checked })} /> Tutorial concluído</label>
        <button className="btn danger" onClick={() => { if (confirm('Apagar TODOS os dados locais (baralhos, histórico)?')) { metaStore.resetAll(); showToast('Dados apagados.'); force((x) => x + 1); } }}>Apagar todos os dados</button>
        <div className="about">
          <b>{T.title} v1</b> — TCG digital com engine genérica orientada a dados: toda a terminologia, facções e cartas vêm de configuração. Partidas contra a IA, tutorial, construtor de baralhos, coleção com artes oficiais e multiplayer privado para dois jogadores.
        </div>
      </div>
    </div>
  );
};

export const ResultsScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const outcome = useApp((s) => s.lastOutcome);
  const cfg = useApp((s) => s.matchConfig);
  const startMatch = useApp((s) => s.startMatch);
  const win = outcome === 'win';
  return (
    <div className={`screen results-screen ${win ? 'win' : 'loss'}`} data-testid="results-screen">
      <div className="results-card">
        <h1>{win ? 'Vitória!' : 'Derrota…'}</h1>
        <p>{win ? 'Você alcançou o alvo de Pontos de Vitória. A liga reconhece sua força!' : 'O oponente levou a melhor. Ajuste o baralho e tente de novo!'}</p>
        <div className="results-actions">
          <button className="btn big primary" onClick={() => cfg && startMatch({ ...cfg, seed: Math.floor(Math.random() * 1e9) })} data-testid="results-rematch">Revanche imediata</button>
          <button className="btn" onClick={() => go('deckSelect')} data-testid="results-change-deck">Trocar baralho</button>
          <button className="btn" onClick={() => go('builder')} data-testid="results-edit-deck">Editar baralho</button>
          <button className="btn ghost" onClick={() => go('menu')} data-testid="results-menu">Menu principal</button>
        </div>
      </div>
    </div>
  );
};
