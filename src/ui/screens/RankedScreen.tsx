import React from 'react';
import { useApp, metaStore } from '../appStore';
import { useRanked } from '../../ranked/rankedStore';
import { isRankedConfigured } from '../../ranked/client';
import { ARCHETYPE_DECKS } from '../../data/jet/archetypes';
import { BOT_ROSTER, botById } from '../../ranked/bots';
import { registry } from '../../engine/registry';
import { expandDeck } from '../../data/deckUtils';
import { RANK_BY_ID } from '../../ranked/ranks';
import type { RankId } from '../../ranked/ranks';
import type { RankedProfileView } from '../../ranked/client';

const RANK_ORDER: RankId[] = ['FERRO', 'BRONZE', 'PRATA', 'OURO', 'PLATINA', 'DIAMANTE', 'MESTRE', 'CAMPEAO'];

function rankBadge(rank: RankId, isReiDaLiga: boolean): string {
  if (isReiDaLiga) return '👑 REI DA LIGA';
  return RANK_BY_ID[rank].label;
}

export const RankedScreen: React.FC = () => {
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const startMatch = useApp((s) => s.startMatch);
  const ranked = useRanked();

  React.useEffect(() => {
    void ranked.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [mode, setMode] = React.useState<'login' | 'register'>('login');

  if (!isRankedConfigured()) {
    return (
      <div className="screen ranked-screen" data-testid="ranked-screen">
        <h1 className="menu-logo">Liga Ranqueada</h1>
        <div className="panel">
          <p>A Liga Ranqueada não está configurada (sem <code>VITE_RANKED_API_URL</code>).</p>
          <p className="hint">Jogar vs IA e Multiplayer privado continuam funcionando sem login.</p>
        </div>
        <button className="btn" onClick={() => go('menu')}>Voltar</button>
      </div>
    );
  }

  // ---- não autenticado -----------------------------------------------------
  if (!ranked.token || !ranked.username) {
    return (
      <div className="screen ranked-screen" data-testid="ranked-screen">
        <h1 className="menu-logo">Liga Ranqueada</h1>
        <p className="menu-sub">Conta necessária apenas para Ranqueada, perfil e ranking.</p>
        <form
          className="panel ranked-auth"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              if (mode === 'login') await ranked.login(username, password);
              else await ranked.register(username, password);
            } catch {
              /* erro já em ranked.error */
            }
          }}
        >
          <h2>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h2>
          <label>
            Usuário
            <input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={24} required autoFocus data-testid="ranked-username" />
          </label>
          <label>
            Senha
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required data-testid="ranked-password" />
          </label>
          {ranked.error && <p className="ranked-error">{ranked.error}</p>}
          <button className="btn primary" type="submit" disabled={ranked.busy} data-testid="ranked-submit">
            {ranked.busy ? '…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
          <button type="button" className="btn ghost" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); ranked.clearError(); }}>
            {mode === 'login' ? 'Não tem conta? Criar' : 'Já tem conta? Entrar'}
          </button>
        </form>
        <button className="btn" onClick={() => go('menu')}>Voltar</button>
      </div>
    );
  }

  // ---- autenticado ---------------------------------------------------------
  const me = ranked.profile;
  const meInLadder = ranked.ladder.find((e) => e.username === ranked.username) ?? null;

  const play = async () => {
    const deck = metaStore.state.decks.find((d) => d.id === metaStore.state.activeDeckId);
    if (!deck) {
      showToast('Escolha um baralho válido antes de jogar ranqueada');
      return;
    }
    const cardIds: string[] = [];
    for (const [id, n] of Object.entries(deck.cards)) for (let i = 0; i < n; i++) cardIds.push(id);
    try {
      const start = await ranked.startMatch(cardIds);
      const bot = botById(start.botId);
      const archetype = ARCHETYPE_DECKS.find((d) => d.id === start.botArchetypeId) ?? ARCHETYPE_DECKS[0];
      const botDeck = expandDeck({ id: archetype.id, name: archetype.name, description: '', cards: archetype.cards }).map((id) => registry.card(id));
      startMatch({
        playerDeckId: deck.id,
        opponentDeckId: `bot-${start.botId}`,
        difficulty: 'hard',
        seed: start.seed,
        ranked: {
          botName: start.botName,
          botDeck,
          botProfile: bot?.profile ?? BOT_ROSTER[0].profile,
          onFinish: (commands, humanWon) => {
            // Submete ao servidor (replay) — o servidor decide o resultado.
            void ranked.finishMatch(start.ticket, commands).then(() => {
              go('ranked');
              showToast(humanWon ? 'Vitória enviada para validação' : 'Derrota registrada');
            });
          }
        }
      });
    } catch {
      /* erro já em ranked.error */
    }
  };

  return (
    <div className="screen ranked-screen" data-testid="ranked-screen">
      <h1 className="menu-logo">Liga Ranqueada</h1>
      <div className="ranked-profile panel">
        <div className="ranked-me">
          <b>{ranked.username}</b>
          {meInLadder ? (
            <>
              <span className="ranked-badge">{rankBadge(meInLadder.rank, meInLadder.isReiDaLiga)}</span>
              <span>{meInLadder.rating} pts · #{meInLadder.position}</span>
              <span className="hint">{meInLadder.wins}V / {meInLadder.losses}D</span>
            </>
          ) : (
            <span className="hint">Perfil ainda não ranqueado</span>
          )}
        </div>
        <div className="ranked-actions">
          <button className="btn primary" onClick={() => void play()} disabled={ranked.busy} data-testid="ranked-play">
            {ranked.busy ? 'Buscando…' : '⚔ Buscar oponente'}
          </button>
          <button className="btn ghost" onClick={() => void ranked.logout()}>Sair</button>
        </div>
      </div>

      {ranked.error && <p className="ranked-error">{ranked.error}</p>}

      {ranked.lastResult && (
        <div className="panel ranked-result" data-testid="ranked-result">
          <b>{ranked.lastResult.result === 'win' ? '🏆 Vitória' : 'Derrota'}</b>
          <span>Rating: {ranked.lastResult.ratingAfter} · {rankBadge(ranked.lastResult.rank as RankId, ranked.lastResult.isReiDaLiga)}</span>
          {ranked.lastResult.position !== null && <span>Posição #{ranked.lastResult.position}</span>}
          <button className="btn ghost" onClick={() => ranked.clearLastResult()}>OK</button>
        </div>
      )}

      <div className="ranked-ladder panel" data-testid="ranked-ladder">
        <h2>Top 100</h2>
        <table className="ladder-table">
          <thead>
            <tr><th>#</th><th>Nome</th><th>Rank</th><th>Rating</th><th>V/D</th></tr>
          </thead>
          <tbody>
            {ranked.ladder.map((e) => (
              <LadderRow key={e.username} e={e} me={ranked.username === e.username} />
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn" onClick={() => go('menu')}>Voltar</button>
    </div>
  );
};

const LadderRow: React.FC<{ e: RankedProfileView; me: boolean }> = ({ e, me }) => {
  const top10 = e.position <= 10;
  return (
    <tr className={`${top10 ? 'top10' : ''} ${me ? 'me' : ''}`}>
      <td>{e.position}</td>
      <td>{e.isBot ? '🤖 ' : ''}{e.username}</td>
      <td>{rankBadge(e.rank, e.isReiDaLiga)}</td>
      <td>{e.rating}</td>
      <td>{e.wins}/{e.losses}</td>
    </tr>
  );
};

export { RANK_ORDER };
