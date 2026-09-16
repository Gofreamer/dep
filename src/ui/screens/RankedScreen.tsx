/**
 * TELA DA LIGA RANQUEADA (2.1).
 *
 * Regra de origem dos dados: TEMPO-TEMPORADA, status, pico de rating, melhor
 * posição, highest rank e standings liquidados VÊM DO SERVIDOR
 * (`GET /ranked/season`, `GET /ranked/profile`, `GET /ranked/season/results`).
 * A UI não guarda tabela de ranks nem calcula janela de temporada — a
 * progressão é lida de `RANKS` em `src/ranked/ranks.ts`, a mesma que o engine
 * da liga usa (na 2.0 havia uma cópia local que já estava defasada).
 *
 * Nome de bot: o ladder devolve o id canônico (`bot-stella-prime`) e a tela
 * mostra o apelido (`StellaPrime`) via `botById`.
 */
import React from 'react';
import { useApp, metaStore } from '../appStore';
import { useRanked } from '../../ranked/rankedStore';
import { isRankedConfigured } from '../../ranked/client';
import { ARCHETYPE_DECKS } from '../../data/jet/archetypes';
import { BOT_ROSTER, botById } from '../../ranked/bots';
import { registry } from '../../engine/registry';
import { expandDeck } from '../../data/deckUtils';
import { RANKS, RANK_BY_ID, rankFor } from '../../ranked/ranks';
import type { RankId } from '../../ranked/ranks';
import type { RankedProfileView, RankedSeasonResultRow } from '../../ranked/client';


function rankBadge(rank: RankId, isReiDaLiga: boolean): string {
  if (isReiDaLiga) return '👑 REI DA LIGA';
  return RANK_BY_ID[rank]?.label ?? rank;
}

/** id canônico do ladder → apelido visível para humanos. */
function displayName(username: string): string {
  return botById(username)?.name ?? username;
}

const DAY = 24 * 60 * 60 * 1000;

function dayLabel(ms: number): string {
  const d = Math.ceil(ms / DAY);
  if (d <= 0) return 'hoje';
  return d === 1 ? '1 dia' : `${d} dias`;
}

const SEASON_STATUS_LABEL: Record<string, string> = {
  pending: 'ainda não começou',
  active: 'em andamento',
  grace: 'na graça — resultados ainda contam',
  closed: 'liquidada'
};

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
        <SeasonStrip ranked={ranked} />
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
  const details = ranked.details;

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
      /* erro já em ranked.error (503 = chave da Liga ausente no servidor, 423 = temporada fora da janela) */
    }
  };

  return (
    <div className="screen ranked-screen" data-testid="ranked-screen">
      <h1 className="menu-logo">Liga Ranqueada</h1>

      <SeasonStrip ranked={ranked} />

      <div className="ranked-profile panel">
        <div className="ranked-me">
          <b>{ranked.username}</b>
          {meInLadder ? (
            <>
              <span className="ranked-badge">{rankBadge(meInLadder.rank, meInLadder.isReiDaLiga)}</span>
              <span>{meInLadder.rating} pts · #{meInLadder.position}</span>
              <span className="hint">{meInLadder.wins}V / {meInLadder.losses}D{details?.streak !== undefined ? ` · sequência ${details.streak > 0 ? `+${details.streak}` : details.streak}` : ''}</span>
            </>
          ) : (
            <span className="hint">Perfil ainda não ranqueado</span>
          )}
          {details && (
            <span className="hint ranked-peak" data-testid="ranked-peak">
              pico {details.peakRating} · melhor posição #{details.bestPosition ?? '—'} · {RANK_BY_ID[details.highestRank]?.label ?? details.highestRank}
            </span>
          )}
        </div>
        <div className="ranked-actions">
          <button className="btn primary" onClick={() => void play()} disabled={ranked.busy} data-testid="ranked-play">
            {ranked.busy ? 'Buscando…' : '⚔ Buscar oponente'}
          </button>
          <button className="btn ghost" onClick={() => void ranked.logout()}>Sair</button>
        </div>
      </div>

      <RankProgress rating={details?.rating ?? me?.rating ?? 1000} />

      {ranked.error && <p className="ranked-error">{ranked.error}</p>}

      {ranked.lastResult && (
        <div className="panel ranked-result" data-testid="ranked-result">
          <b>{ranked.lastResult.result === 'win' ? '🏆 Vitória' : 'Derrota'}</b>
          <span>Rating: {ranked.lastResult.ratingAfter} · {rankBadge(ranked.lastResult.rank as RankId, ranked.lastResult.isReiDaLiga)}</span>
          {ranked.lastResult.position !== null && <span>Posição #{ranked.lastResult.position}</span>}
          {ranked.lastResult.peakRating !== null && <span className="hint">pico {ranked.lastResult.peakRating}</span>}
          {ranked.lastResult.bestPosition !== null && <span className="hint">melhor posição #{ranked.lastResult.bestPosition}</span>}
          {ranked.lastResult.alreadyApplied && <span className="hint">esse resultado já tinha sido contabilizado (reenvio do mesmo ticket)</span>}
          <button className="btn ghost" onClick={() => ranked.clearLastResult()}>OK</button>
        </div>
      )}

      {ranked.history.length > 0 && (
        <div className="panel ranked-history" data-testid="ranked-history">
          <h2>Últimas partidas</h2>
          <ul>
            {ranked.history.slice(0, 10).map((h) => {
              const iWon = h.winner.toLowerCase() === ranked.username?.toLowerCase();
              const opp = displayName(h.playerA.toLowerCase() === ranked.username?.toLowerCase() ? h.playerB : h.playerA);
              const mine = h.playerA.toLowerCase() === ranked.username?.toLowerCase() ? h.deltaA : -h.deltaA;
              return (
                <li key={h.rankedMatchId} className={iWon ? 'win' : 'loss'}>
                  {iWon ? 'V' : 'D'} vs {opp} · {mine > 0 ? `+${mine}` : mine} pts
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ranked.standings.length > 0 ? (
        <StandingsTable rows={ranked.standings} seasonId={ranked.standingsSeasonId ?? ''} onClose={() => useRanked.setState({ standings: [], standingsSeasonId: null })} />
      ) : (
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
      )}

      <button className="btn" onClick={() => go('menu')}>Voltar</button>
    </div>
  );
};

/**
 * Cabeçalho da temporada — dados do banco (`/ranked/season`). Mostra janela,
 * status e, quando a temporada foi liquidada, o botão dos standings finais.
 */
const SeasonStrip: React.FC<{ ranked: ReturnType<typeof useRanked.getState> }> = ({ ranked }) => {
  const season = ranked.season;
  if (!season) {
    return (
      <div className="panel ranked-season" data-testid="ranked-season">
        <span className="hint">Temporada indisponível (sem D1 no servidor).</span>
      </div>
    );
  }
  const now = Date.now();
  const left = season.endAt - now;
  return (
    <div className="panel ranked-season" data-testid="ranked-season">
      <b>{season.name}</b>
      <span className={`season-status season-${season.status}`}>{SEASON_STATUS_LABEL[season.status] ?? season.status}</span>
      {season.status === 'pending' && <span className="hint">abre em {dayLabel(season.startAt - now)}</span>}
      {(season.status === 'active' || season.status === 'grace') && <span className="hint">faltam {dayLabel(left)} (graça: {dayLabel(season.graceAfterEnd)})</span>}
      {season.settledAt !== null && <span className="hint">liquidada</span>}
      {(season.status === 'grace' || season.status === 'closed') && (
        <button className="btn ghost" type="button" data-testid="ranked-standings-toggle" onClick={() => void ranked.loadStandings(season.id)}>
          {ranked.standings.length ? 'Ocultar standings' : 'Ver standings finais'}
        </button>
      )}
      {ranked.seasonResult && (
        <span className="hint ranked-season-result" data-testid="ranked-season-result">
          seu resultado na {season.name}: #{ranked.seasonResult.finalPosition} (pico {ranked.seasonResult.peakRating}, melhor #{ranked.seasonResult.bestPosition})
          {ranked.seasonResult.wasLeagueKing ? ' · 👑 REI DA LIGA' : ''}
        </span>
      )}
    </div>
  );
};

/** Progressão de ranks lida de `RANKS` (fonte única). */
const RankProgress: React.FC<{ rating: number }> = ({ rating }) => {
  const current = rankFor(rating).id;
  return (
    <div className="ranked-ranks" data-testid="ranked-ranks">
      {RANKS.map((r) => (
        <span key={r.id} className={`rank-chip${r.id === current ? ' active' : ''}`} title={`${r.label} · a partir de ${r.floor}`}>
          {r.label}
        </span>
      ))}
    </div>
  );
};

const StandingsTable: React.FC<{ rows: RankedSeasonResultRow[]; seasonId: string; onClose: () => void }> = ({ rows, seasonId, onClose }) => (
  <div className="ranked-ladder panel" data-testid="ranked-standings">
    <h2>Standings liquidados · {seasonId}</h2>
    <table className="ladder-table">
      <thead>
        <tr><th>#</th><th>Nome</th><th>Final</th><th>Pico</th><th>Melhor</th><th>Rank</th><th>V/D</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.username} className={r.finalPosition <= 10 ? 'top10' : ''}>
            <td>{r.finalPosition}</td>
            <td>{displayName(r.username)}</td>
            <td>{r.finalRating}</td>
            <td>{r.peakRating}</td>
            <td>#{r.bestPosition}</td>
            <td>{r.wasLeagueKing ? '👑 REI DA LIGA' : RANK_BY_ID[r.highestRank]?.label ?? r.highestRank}</td>
            <td>{r.wins}/{r.losses}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <button className="btn ghost" type="button" onClick={onClose}>Voltar ao ladder</button>
  </div>
);

const LadderRow: React.FC<{ e: RankedProfileView; me: boolean }> = ({ e, me }) => {
  const top10 = e.position <= 10;
  return (
    <tr className={`${top10 ? 'top10' : ''} ${me ? 'me' : ''}`}>
      <td>{e.position}</td>
      <td>{e.isBot ? '🤖 ' : ''}{displayName(e.username)}</td>
      <td>{rankBadge(e.rank, e.isReiDaLiga)}</td>
      <td>{e.rating}</td>
      <td>{e.wins}/{e.losses}</td>
    </tr>
  );
};
