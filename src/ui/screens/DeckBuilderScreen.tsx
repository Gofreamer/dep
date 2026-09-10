import React from 'react';
import { useApp, metaStore } from '../appStore';
import { validateDeck, deckStats } from '../../data/decks';
import { allCardsSorted, CardMini } from '../components/CardView';
import { DefInspectModal } from '../components/Modals';
import type { CardDef, CardKind } from '../../engine/types';
import { DEFAULT_CONFIG } from '../../engine/types';
import { TERMINOLOGY as T } from '../../data/terminology';
import { registry } from '../../engine/registry';

const KINDS: (CardKind | 'ALL')[] = ['ALL', 'CHARACTER', 'RESOURCE', 'ACTION', 'EQUIPMENT', 'FIELD'];

export const DeckBuilderScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const editingId = useApp((s) => s.editingDeckId);
  const showToast = useApp((s) => s.showToast);

  const [deckId, setDeckId] = React.useState<string | null>(editingId);
  const [name, setName] = React.useState('');
  const [cards, setCards] = React.useState<Record<string, number>>({});
  const [search, setSearch] = React.useState('');
  const [kind, setKind] = React.useState<CardKind | 'ALL'>('ALL');
  const [faction, setFaction] = React.useState('all');
  const [rarity, setRarity] = React.useState('all');
  const [stage, setStage] = React.useState('all');
  const [tag, setTag] = React.useState('');
  const [inspect, setInspect] = React.useState<CardDef | null>(null);
  const [, force] = React.useState(0);

  React.useEffect(() => {
    if (deckId) {
      const deck = metaStore.getDeck(deckId);
      if (deck) { setName(deck.name); setCards({ ...deck.cards }); return; }
    }
    const fresh = metaStore.createDeck('Novo Baralho');
    setDeckId(fresh.id);
    setName(fresh.name);
    setCards({});
  }, [deckId]);

  const save = () => {
    if (!deckId) return;
    metaStore.updateDeck(deckId, { name: name || 'Sem nome', cards });
    showToast('Baralho salvo!');
  };

  const validation = validateDeck(cards, DEFAULT_CONFIG.deckRules);
  const stats = deckStats(cards);

  const add = (def: CardDef) => {
    const cur = cards[def.id] ?? 0;
    const limit = def.unique ? DEFAULT_CONFIG.deckRules.uniqueMax : DEFAULT_CONFIG.deckRules.maxCopies;
    const exempt = DEFAULT_CONFIG.deckRules.copyLimitExempt?.includes(def.kind);
    const max = exempt ? 12 : limit;
    if (cur >= max) { showToast(def.unique ? 'Carta Única: só 1 cópia.' : `Máximo ${max} cópias.`); return; }
    if (stats.total >= DEFAULT_CONFIG.deckRules.max) { showToast(`Máximo de ${DEFAULT_CONFIG.deckRules.max} cartas.`); return; }
    setCards((c) => ({ ...c, [def.id]: (c[def.id] ?? 0) + 1 }));
  };

  const remove = (def: CardDef) => {
    setCards((c) => {
      const next = { ...c };
      const n = (next[def.id] ?? 0) - 1;
      if (n <= 0) delete next[def.id]; else next[def.id] = n;
      return next;
    });
  };

  const filtered = allCardsSorted().filter((def) => {
    if (kind !== 'ALL' && def.kind !== kind) return false;
    if (faction !== 'all' && def.faction !== faction) return false;
    if (rarity !== 'all' && def.rarity !== rarity) return false;
    if (stage !== 'all' && !(def.kind === 'CHARACTER' && String((def as any).stage) === stage)) return false;
    if (tag && !def.tags.includes(tag)) return false;
    if (search && !def.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const factions = registry.allFactions();

  return (
    <div className="screen builder-screen">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => { save(); go('menu'); }}>← Salvar e voltar</button>
        <input className="deck-name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
        <div className="head-actions">
          <button className="btn" onClick={() => { save(); const c = metaStore.copyDeck(deckId!); if (c) { setDeckId(c.id); setName(c.name); setCards({ ...c.cards }); } }}>Copiar</button>
          <button className="btn danger" onClick={() => { if (deckId && metaStore.listDecks().length > 1) { metaStore.deleteDeck(deckId); go('menu'); } }}>Excluir</button>
          <button className="btn" onClick={() => { save(); if (deckId) metaStore.setActiveDeck(deckId); showToast('Baralho ativo definido!'); }}>Definir como ativo</button>
        </div>
      </header>

      <div className="builder-layout">
        {/* Biblioteca */}
        <section className="library">
          <div className="filters">
            <input placeholder="Buscar pelo nome…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
              {KINDS.map((k) => <option key={k} value={k}>{k === 'ALL' ? 'Todos os tipos' : T.kindNames[k].plural}</option>)}
            </select>
            <select value={faction} onChange={(e) => setFaction(e.target.value)}>
              <option value="all">Todas as facções</option>
              {factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
              <option value="all">Raridades</option>
              <option value="common">Comum</option>
              <option value="uncommon">Incomum</option>
              <option value="rare">Rara</option>
              <option value="epic">Épica</option>
              <option value="legendary">Lendária</option>
            </select>
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="all">Estágios</option>
              {T.stageLabels.map((l, i) => <option key={i} value={i}>{l}</option>)}
            </select>
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Todas as tags</option>
              <option value="supremo">Supremo</option>
              <option value="tanque">Tanque</option>
              <option value="tec">Tec</option>
            </select>
          </div>
          <div className="lib-grid">
            {filtered.map((def) => (
              <div key={def.id} className="lib-cell">
                <CardMini def={def} count={cards[def.id]} onClick={() => add(def)} onInspect={() => setInspect(def)} />
                <span className="lib-add" title="Adicionar">+</span>
              </div>
            ))}
          </div>
        </section>

        {/* Baralho atual */}
        <aside className="deck-panel">
          <div className={`deck-validity ${validation.valid ? 'ok' : 'bad'}`}>
            {validation.valid ? `✓ Válido — ${stats.total}/${DEFAULT_CONFIG.deckRules.max} cartas` : validation.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
          </div>
          <div className="deck-contents">
            {Object.entries(cards).sort((a, b) => {
              const da = registry.card(a[0]); const db = registry.card(b[0]);
              return (da.number ?? 0) - (db.number ?? 0);
            }).map(([id, n]) => {
              const def = registry.card(id);
              return (
                <div key={id} className="deck-line">
                  <CardMini def={def} count={n} onClick={() => remove(def)} onInspect={() => setInspect(def)} />
                </div>
              );
            })}
            {Object.keys(cards).length === 0 && <p className="hint">Clique nas cartas da biblioteca para adicionar.</p>}
          </div>
          <div className="deck-stats">
            <StatRow label="Total" value={stats.total} />
            <StatRow label={T.characterPlural} value={stats.byKind.CHARACTER ?? 0} />
            <StatRow label={T.resourcePlural} value={stats.byKind.RESOURCE ?? 0} />
            <StatRow label={T.actionCardPlural} value={stats.byKind.ACTION ?? 0} />
            <StatRow label={T.equipmentCardPlural} value={stats.byKind.EQUIPMENT ?? 0} />
            <StatRow label={T.fieldCardPlural} value={stats.byKind.FIELD ?? 0} />
            <div className="curve">
              <b>Curva de evolução</b>
              {T.stageLabels.map((l, i) => (
                <div key={i} className="curve-row">
                  <span>{l}</span>
                  <div className="curve-bar"><span style={{ width: `${Math.min(100, ((stats.upgradeCurve[i] ?? 0) / Math.max(1, stats.byKind.CHARACTER ?? 1)) * 140)}%` }} /></div>
                  <em>{stats.upgradeCurve[i] ?? 0}</em>
                </div>
              ))}
            </div>
            <div className="curve">
              <b>{T.resourcePlural} por tipo</b>
              {Object.entries(stats.resourceTypes).map(([rt, n]) => (
                <div key={rt} className="curve-row">
                  <span>{registry.resourceType(rt)?.name ?? rt}</span>
                  <div className="curve-bar"><span style={{ width: `${(n / Math.max(1, stats.byKind.RESOURCE ?? 1)) * 100}%` }} /></div>
                  <em>{n}</em>
                </div>
              ))}
            </div>
            <div className="curve">
              <b>Facções</b>
              {Object.entries(stats.byFaction).map(([f, n]) => (
                <div key={f} className="curve-row">
                  <span>{registry.faction(f)?.name ?? f}</span>
                  <div className="curve-bar"><span style={{ width: `${(n / Math.max(1, stats.total)) * 100}%` }} /></div>
                  <em>{n}</em>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      <DefInspectModal def={inspect} onClose={() => setInspect(null)} />
    </div>
  );
};

const StatRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="stat-row"><span>{label}</span><b>{value}</b></div>
);
