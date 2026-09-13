import React from 'react';
import { useApp, metaStore } from '../appStore';
import { useMatch } from '../matchStore';
import { MatchController, TUTORIAL_STEPS as TUTORIAL_STEPS_ } from '../../game/controller';
import type { CardInstance, Command, PlayerId } from '../../engine/types';
import { charDef, defOf } from '../../engine/queries';
import { registry } from '../../engine/registry';
import type { MatchState } from '../../engine/types';
import { TERMINOLOGY as T } from '../../data/terminology';
import { BoardCard, ZonePile, findInst } from '../components/BoardCard';
import { CardMini } from '../components/CardView';
import { preloadCardArt } from '../../data/jet/art';
import { InspectModal, ChoicePanel } from '../components/Modals';
import { FXLayer } from '../components/FXLayer';
import { DebugPanel } from '../components/DebugPanel';


export const MatchScreen: React.FC = () => {
  const cfg = useApp((s) => s.matchConfig);
  const go = useApp((s) => s.go);
  const showToast = useApp((s) => s.showToast);
  const finishMatch = useApp((s) => s.finishMatch);
  const [controller, setController] = React.useState<MatchController | null>(null);
  const version = useMatch((s) => s.version);
  const stateRef = useMatch((s) => s.stateRef);
  const pending = useMatch((s) => s.pending);
  const legal = useMatch((s) => s.legal);
  const pushCue = useMatch((s) => s.pushCue);
  const sync = useMatch((s) => s.sync);
  const reset = useMatch((s) => s.reset);
  const setTutorial = useMatch((s) => s.setTutorial);
  const targetingFrom = useMatch((s) => s.targetingFrom);
  const setTargeting = useMatch((s) => s.setTargeting);
  const setInspect = useMatch((s) => s.setInspect);
  const tutorial = useMatch((s) => s.tutorial);
  const boardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!cfg) { go('menu'); return; }
    const ctl = new MatchController(cfg);
    ctl.onCue = (c) => pushCue(c);
    ctl.onInvalid = (code) => showToast(T.errorTexts[code] ?? code);
    setController(ctl);
    reset();
    // Gancho dev-only (instrumentação p/ E2E de stress e depuração manual):
    // expõe engine+controller quando o Modo desenvolvedor está ativo.
    if (metaStore.state.settings.devMode) {
      (window as unknown as Record<string, unknown>).__jetDev = {
        engine: ctl.engine,
        controller: ctl,
        sync: () => {
          const eng = ctl.engine;
          sync(eng.version, eng.state, eng.legalActions(0), eng.getPending());
        },
        debug: (op: string, payload: Record<string, unknown> = {}) => {
          ctl.engine.debugCommand(op, { player: 0, ...payload });
          const eng = ctl.engine;
          sync(eng.version, eng.state, eng.legalActions(0), eng.getPending());
        },
      };
    }
    ctl.start(() => {
      const eng = ctl.engine;
      sync(eng.version, eng.state, eng.legalActions(0), eng.getPending());
      if (ctl.tutorialActive) {
        const step = TUTORIAL_STEPS_[ctl.tutorialStep];
        setTutorial({ active: true, step: ctl.tutorialStep, title: step?.title ?? 'Tutorial', text: step?.text ?? '' });
      }
    });
    // Pré-carrega (best-effort, sem bloquear a partida) SOMENTE as artes dos
    // dois decks desta partida — nunca o catálogo inteiro.
    try {
      const st = ctl.engine.state;
      const instances = [...st.players[0].deck, ...st.players[0].hand, ...st.players[1].deck, ...st.players[1].hand];
      const defs = instances.flatMap((c) => {
        try { return [defOf(c)]; } catch { return []; }
      });
      const w = window as unknown as { requestIdleCallback?: (cb: () => void) => void };
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => preloadCardArt(defs));
      else setTimeout(() => preloadCardArt(defs), 0);
    } catch {
      // Preload nunca pode impedir a partida de iniciar.
    }
    return () => {
      ctl.stop();
      delete (window as unknown as Record<string, unknown>).__jetDev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.playerDeckId, cfg?.opponentDeckId, cfg?.seed]);

  // outcome → results screen (ranqueada navega via onFinish no controlador)
  React.useEffect(() => {
    if (controller?.outcome && stateRef) {
      if (cfg?.ranked) return; // a tela ranqueada decide a navegação
      const t = setTimeout(() => finishMatch(controller.outcome!.winner === 0 ? 'win' : 'loss'), 1400);
      return () => clearTimeout(t);
    }
  }, [controller?.outcome, stateRef, finishMatch, cfg?.ranked]);

  if (!controller || !stateRef || !legal) {
    return <div className="screen match-screen"><div className="loading">Preparando a arena…</div></div>;
  }
  const st = controller.engine.state;

  // ----- targeting context --------------------------------------------------
  const pendingReq = pending;
  const targetCandidates = new Set<string>(pendingReq?.candidates ?? []);
  let attachTargets = new Set<string>();
  if (targetingFrom) {
    const card = stateRef.players[0].hand.find((c) => c.uid === targetingFrom);
    if (card?.kind === 'EQUIPMENT') attachTargets = new Set(legal.playableEquipment.find((e) => e.uid === targetingFrom)?.targets ?? []);
    else if (card?.kind === 'RESOURCE') attachTargets = new Set([...stateRef.players[0].bench.map((c) => c.uid), ...(stateRef.players[0].active ? [stateRef.players[0].active.uid] : [])]);
    else if (card?.kind === 'CHARACTER') attachTargets = new Set(legal.upgradable.filter((u) => u.to === targetingFrom).map((u) => u.from));
  }
  const targetMode = pendingReq ? 'pending' : targetingFrom ? 'attach' : null;

  const highlightUids = new Set<string>([...targetCandidates, ...attachTargets]);

  // ----- handlers -----------------------------------------------------------
  const clickHandCard = (card: CardInstance) => {
    if (targetMode === 'attach') { setTargeting(null); return; }
    // Escolha pendente sobre cartas da mão (ex.: descartar/comprar escolhas) —
    // antes estes candidatos NÃO eram selecionáveis pela UI (soft-lock real).
    if (targetMode === 'pending' && highlightUids.has(card.uid)) {
      controller.resolveChoice([card.uid]);
      return;
    }
    const info = legal.hand[card.uid];
    if (!info?.playable) {
      if (info?.reason) showToast(T.errorTexts[info.reason] ?? info.reason);
      setInspect(card.uid);
      return;
    }
    switch (card.kind) {
      case 'CHARACTER': {
        const ups = legal.upgradable.filter((u) => u.to === card.uid);
        if (ups.length > 0) {
          // escolher: evoluir (se 1 alvo, direto) ou reserva
          if (ups.length === 1) {
            controller.send({ type: 'UPGRADE', player: 0, uid: card.uid, targetUid: ups[0].from });
            return;
          }
        }
        controller.send({ type: 'DEPLOY_CHARACTER', player: 0, uid: card.uid });
        break;
      }
      case 'RESOURCE':
        setTargeting(card.uid);
        break;
      case 'EQUIPMENT':
        setTargeting(card.uid);
        break;
      case 'ACTION':
        controller.send({ type: 'PLAY_ACTION', player: 0, uid: card.uid });
        break;
      case 'FIELD':
        controller.send({ type: 'PLAY_FIELD', player: 0, uid: card.uid });
        break;
    }
  };

  const clickBoardChar = (inst: CardInstance, owner: PlayerId) => {
    const uid = inst.uid;
    if (targetMode === 'pending' && highlightUids.has(uid)) {
      controller.resolveChoice([uid]);
      setTargeting(null);
      return;
    }
    if (targetMode === 'attach' && owner === 0 && highlightUids.has(uid)) {
      const card = stateRef.players[0].hand.find((c) => c.uid === targetingFrom)!;
      if (card.kind === 'RESOURCE') controller.send({ type: 'ATTACH_RESOURCE', player: 0, uid: card.uid, targetUid: uid });
      else if (card.kind === 'EQUIPMENT') controller.send({ type: 'PLAY_EQUIPMENT', player: 0, uid: card.uid, targetUid: uid });
      else if (card.kind === 'CHARACTER') controller.send({ type: 'UPGRADE', player: 0, uid: card.uid, targetUid: uid });
      setTargeting(null);
      return;
    }
    if (owner !== 0) { setInspect(uid); return; }
    // own char: context actions
    const ups = targetingFrom ? [] : legal.upgradable.filter((u) => u.from === uid);
    if (targetingFrom) {
      const card = stateRef.players[0].hand.find((c) => c.uid === targetingFrom);
      if (card?.kind === 'CHARACTER' && ups.some((u) => u.to === targetingFrom)) {
        controller.send({ type: 'UPGRADE', player: 0, uid: targetingFrom, targetUid: uid });
        setTargeting(null);
        return;
      }
    }
    // If a resource/equipment is awaiting a target, this click already handled above.
    // Otherwise show inspect with actions.
    setInspect(uid);
    void ups;
  };

  const attack = (attackId: string) => controller.send({ type: 'ATTACK', player: 0, attackId });
  const useAbility = (charUid: string, abilityId: string) => controller.send({ type: 'USE_ABILITY', player: 0, charUid, abilityId });
  const endTurn = () => controller.send({ type: 'END_TURN', player: 0 });
  const retreat = (benchUid: string) => controller.send({ type: 'RETREAT', player: 0, benchUid });

  // ----- setup phase ---------------------------------------------------------
  const setupMode = st.phase === 'setup';
  const mySetupActive = setupMode && !st.players[0].setupDone;
  const setupTargets = new Set(mySetupActive ? [...legal.setupActive] : []);

  const clickInSetup = (inst: CardInstance) => {
    if (setupTargets.has(inst.uid)) {
      if (!st.players[0].active) controller.send({ type: 'SETUP_SET_ACTIVE', player: 0, uid: inst.uid });
      else controller.send({ type: 'SETUP_BENCH', player: 0, uid: inst.uid });
      return;
    }
    // Carta que não pode ser posicionada agora: inspecionar (antes o clique
    // simplesmente não fazia nada — a carta parecia "morta").
    setInspect(inst.uid);
  };

  const renderChar = (inst: CardInstance | null, owner: PlayerId, isActive: boolean) => {
    if (!inst) return <div className={`slot empty ${isActive ? 'active-slot' : ''}`}>{isActive ? T.activeZoneName : ''}</div>;
    const targeting = highlightUids.has(inst.uid) || setupTargets.has(inst.uid);
    return (
      <BoardCard
        state={st}
        inst={inst}
        isActive={isActive}
        legal={owner === 0 ? legal : null}
        targeting={targeting}
        compact={!isActive}
        onClick={() => (setupMode ? clickInSetup(inst) : clickBoardChar(inst, owner))}
      />
    );
  };

  const me = st.players[0];
  const opp = st.players[1];
  const vpTarget = st.config.victory.targetPoints;
  const myTurn = st.activePlayer === 0 && !setupMode;
  const active = me.active;
  const attackList = active ? legal.attacks : [];
  const abilities = active ? legal.abilities.filter((a) => a.charUid === active.uid) : [];
  const benchAbilities = legal.abilities.filter((a) => a.charUid !== active?.uid && a.playable);
  const retreatReady = legal.canRetreat && legal.retreatTargets.length > 0;

  return (
    <div className="screen match-screen" ref={boardRef} data-testid="match-screen">
      {/* painel do oponente */}
      <div className="opp-bar" data-testid="opp-bar">
        <ZonePile label={T.deckZoneName} count={opp.deck.length} kind="deck" />
        <div className="opp-info">
          <span className="player-name">{opp.name} <small className="ai-tag">IA</small></span>
          <div className="vp-track">{vpTrack(opp.victoryPoints, vpTarget, 'opp')}</div>
        </div>
        <div className="opp-hand-backs" data-testid="opp-hand">
          {Array.from({ length: Math.min(opp.hand.length, 8) }).map((_, i) => <span key={i} className="hand-back" />)}
          <span className="hand-count">×{opp.hand.length}</span>
        </div>
        <ZonePile label={T.discardZoneName} count={opp.discard.length} kind="discard" onClick={() => setInspect(opp.discard[opp.discard.length - 1]?.uid ?? null)} />
      </div>

      {/* campo inimigo */}
      <div className="field-row">
        <div className="bench-row opp-bench">
          {opp.bench.map((c) => <React.Fragment key={c.uid}>{renderChar(c, 1, false)}</React.Fragment>)}
          {Array.from({ length: Math.max(0, st.config.board.benchSize - opp.bench.length) }).map((_, i) => <div key={i} className="slot empty mini-slot" />)}
        </div>
      </div>
      <div className="field-row active-row">
        <div className="active-zone opp-active">{renderChar(opp.active, 1, true)}</div>
        <div className="center-strip">
          <FieldSlot state={st} onInspect={setInspect} />
          <TurnBanner st={st} myTurn={myTurn} setup={setupMode} />
        </div>
        <div className="active-zone my-active">{renderChar(me.active, 0, true)}</div>
      </div>

      {/* meu banco */}
      <div className="field-row">
        <div className="bench-row my-bench">
          {me.bench.map((c) => <React.Fragment key={c.uid}>{renderChar(c, 0, false)}</React.Fragment>)}
          {Array.from({ length: Math.max(0, st.config.board.benchSize - me.bench.length) }).map((_, i) => <div key={i} className="slot empty mini-slot" />)}
        </div>
      </div>

      {/* painel do jogador */}
      <div className="my-bar" data-testid="my-bar">
        <ZonePile label={T.deckZoneName} count={me.deck.length} kind="deck" />
        <div className="my-info">
          <span className="player-name">{me.name}</span>
          <div className="vp-track">{vpTrack(me.victoryPoints, vpTarget, 'me')}</div>
        </div>
        <div className="command-dock">
          {!setupMode && (
            <>
              {attackList.map((atk) => {
                const def = active ? (charDef(active).attacks.find((a) => a.id === atk.attackId) ?? null) : null;
                if (!def) return null;
                return (
                  <button key={atk.attackId} className={`dock-btn attack-btn ${atk.playable ? 'playable' : ''}`} disabled={!atk.playable}
                    title={atk.playable ? def.text ?? def.name : T.errorTexts[atk.reason ?? 'cannot_attack']}
                    onClick={() => attack(atk.attackId)}
                    data-testid={`attack-${atk.attackId}`}>
                    ⚔ {def.name} <b>{def.damage ?? ''}</b>
                  </button>
                );
              })}
              {abilities.map((ab) => {
                const abDef = active ? charDef(active).abilities.find((x) => x.id === ab.abilityId) : null;
                if (!abDef) return null;
                return (
                  <button key={ab.abilityId} className={`dock-btn ability-btn ${ab.playable ? 'playable' : ''}`} disabled={!ab.playable}
                    title={abDef.text ?? abDef.name} onClick={() => useAbility(ab.charUid, ab.abilityId)}>
                    ✧ {abDef.name}
                  </button>
                );
              })}
              {benchAbilities.map((ab) => {
                const host = findInst(st, ab.charUid);
                const abDef = host ? charDef(host).abilities.find((x) => x.id === ab.abilityId) : null;
                if (!abDef) return null;
                return (
                  <button key={ab.charUid + ab.abilityId} className={`dock-btn ability-btn bench ${ab.playable ? 'playable' : ''}`} disabled={!ab.playable}
                    title={`${abDef.text ?? ''} (${host ? charDef(host).name : ''})`} onClick={() => useAbility(ab.charUid, ab.abilityId)}>
                    ✧ {abDef.name} <small>({host ? charDef(host).name : ''})</small>
                  </button>
                );
              })}
              {retreatReady && (
                <button className="dock-btn retreat-btn playable"
                  data-testid="retreat"
                  title="Pague o custo de recuo e troque o ativo"
                  onClick={() => {
                    const target = legal.retreatTargets[0];
                    // recuo simples: escolhe o primeiro da reserva; para escolher, use o painel do personagem
                    retreat(target);
                  }}>
                  ⇄ {T.retreatName}
                </button>
              )}
              <button className={`dock-btn endturn-btn ${myTurn ? 'playable' : ''}`} disabled={!myTurn} onClick={endTurn} data-testid="end-turn">
                Encerrar Turno
              </button>
            </>
          )}
          {setupMode && st.players[0].active && !st.players[0].setupDone && (
            <button className="dock-btn endturn-btn playable" onClick={() => controller.send({ type: 'SETUP_DONE', player: 0 })} data-testid="setup-done">Pronto</button>
          )}
        </div>
        <ZonePile label={T.discardZoneName} count={me.discard.length} kind="discard" onClick={() => setInspect(me.discard[me.discard.length - 1]?.uid ?? null)} />
      </div>

      {/* mão */}
      <div className="hand" data-testid="hand">
        {me.hand.map((card) => {
          const info = legal.hand[card.uid];
          return (
            <CardMini
              key={card.uid}
              def={defOf(card)}
              playable={setupMode ? legal.setupActive.includes(card.uid) || legal.setupBench.includes(card.uid) : info?.playable}
              dim={setupMode ? !(legal.setupActive.includes(card.uid) || legal.setupBench.includes(card.uid)) : !info?.playable}
              onClick={() => (setupMode ? clickInSetup(card) : clickHandCard(card))}
              onInspect={() => setInspect(card.uid)}
            />
          );
        })}
      </div>

      {/* banner de alvo */}
      {targetMode === 'attach' && (
        <div className="target-banner">
          {stateRef.players[0].hand.find((c) => c.uid === targetingFrom)?.kind === 'CHARACTER' ? '🎯 Escolha quem evoluir' : '🎯 Escolha um personagem seu'}
          <button className="cancel-target" onClick={() => setTargeting(null)}>Cancelar</button>
        </div>
      )}
      {/* painel de escolha pendente (anti-soft-lock: TODA escolha é resolvível) */}
      <ChoicePanel onResolve={(sel) => controller.resolveChoice(sel)} />

      {/* tutorial */}
      {tutorial?.active && (
        <div className="tutorial-banner" data-testid="tutorial-banner" role="status">
          <b>{tutorial.title}</b>
          <span>{tutorial.text}</span>
          <button className="skip-tutorial" onClick={() => { controller.tutorialActive = false; setTutorial(null); }}>Pular tutorial</button>
        </div>
      )}

      {/* HUD */}
      <div className="match-hud">
        <button className="hud-btn" onClick={() => useMatch.getState().setPaused(true)} data-testid="hud-pause" aria-label="Pausar">⏸</button>
        <button className="hud-btn" onClick={() => useMatch.getState().toggleLog()} title="Registro">📜</button>
        {metaStore.state.settings.devMode && <button className="hud-btn" onClick={() => useMatch.getState().toggleDebug()} title="Debug">🛠</button>}
      </div>
      <LogDrawer st={st} />
      <PauseOverlay
        onResume={() => useMatch.getState().setPaused(false)}
        onRestart={() => { reset(); go('deckSelect'); }}
        onMenu={() => { reset(); go('menu'); }}
      />
      <InspectModal />
      <FXLayer />
      {metaStore.state.settings.devMode && controller && <DebugPanel controller={controller} />}
    </div>
  );
};

function vpTrack(vp: number, target: number, side: string): React.ReactNode {
  return Array.from({ length: target }).map((_, i) => (
    <span key={i} className={`vp-pip ${i < vp ? 'earned' : ''} ${side}`} title={`${T.victoryPointName} ${i + 1}/${target}`} />
  ));
}

const TurnBanner: React.FC<{ st: MatchState; myTurn: boolean; setup: boolean }> = ({ st, myTurn, setup }) => (
  <div className="turn-banner" data-testid="turn-banner">
    {setup ? (
      <span>Preparação — escolha seu {T.activeZoneName.toLowerCase()}</span>
    ) : st.phase === 'gameOver' ? (
      <span>Fim de jogo</span>
    ) : myTurn ? (
      <span className="my-turn">Seu turno · Turno {st.turn}</span>
    ) : (
      <span className="opp-turn">Turno de {st.players[st.activePlayer].name}…</span>
    )}
    {st.fields.length > 0 && st.fields.map((f) => (
      <span key={f.uid} className="field-chip" title={defOf(f).text}>🌤 {defOf(f).name}</span>
    ))}
  </div>
);

const FieldSlot: React.FC<{ state: MatchState; onInspect: (uid: string) => void }> = ({ state, onInspect }) => (
  <div className="field-slot">
    {state.fields.length === 0 ? (
      <span className="field-empty">{T.fieldCardName}</span>
    ) : (
      state.fields.map((f: CardInstance) => (
        <button key={f.uid} className="field-card" onClick={() => onInspect(f.uid)}>
          <span className="fc-name">🌤 {defOf(f).name}</span>
        </button>
      ))
    )}
  </div>
);

const LogDrawer: React.FC<{ st: MatchState }> = ({ st }) => {
  const show = useMatch((s) => s.showLog);
  if (!show) return null;
  const tail = st.log.slice(-40).reverse();
  return (
    <div className="log-drawer">
      <button className="close-btn" onClick={() => useMatch.getState().toggleLog()}>✕</button>
      {tail.map((ev: any) => <LogLine key={ev.seq} ev={ev} />)}
    </div>
  );
};

const LogLine: React.FC<{ ev: any }> = ({ ev }) => {
  const text = ((): string => {
    const p = ev.payload ?? {};
    switch (ev.type) {
      case 'CARD_DRAWN': return `comprou uma carta`;
      case 'CARD_PLAYED': case 'ACTION_PLAYED': return `jogou ${nameOf(p.defId)}`;
      case 'CHARACTER_DEPLOYED': return `posicionou ${nameOf(p.defId)}`;
      case 'RESOURCE_ATTACHED': return `conectou um recurso`;
      case 'CHARACTER_UPGRADED': return `${nameOf(p.from)} evoluiu para ${nameOf(p.to)}`;
      case 'ATTACK_USED': return `usou ${p.attackId}`;
      case 'DAMAGE_DEALT': return p.preview ? `ataque de ${p.amount}` : `${p.amount} de dano`;
      case 'HEALED': return `curou ${p.amount}`;
      case 'STATUS_APPLIED': return `aplicou ${p.status}`;
      case 'CHARACTER_DEFEATED': return `${nameOf(p.defId)} foi derrotado!`;
      case 'ACTIVE_SWITCHED': return `trocou o ativo`;
      case 'VICTORY_POINTS_CHANGED': return `ganhou ${p.amount} ${T.victoryPointAbbrev}`;
      case 'TURN_STARTED': return `— Turno ${p.turn} —`;
      case 'COIN_FLIPPED': return `moeda: ${p.success ? 'cara' : 'coroa'}`;
      case 'FIELD_PLAYED': return `campo: ${nameOf(p.defId)}`;
      case 'ABILITY_ACTIVATED': return `habilidade: ${p.abilityId}`;
      case 'MATCH_ENDED': return `fim de partida`;
      default: return ev.type;
    }
  })();
  return <div className={`log-line p${ev.player}`}>{text}</div>;
};

function nameOf(defId?: string): string {
  if (!defId) return '';
  try { return registry.tryCard(defId)?.name ?? defId; } catch { return defId; }
}

const PauseOverlay: React.FC<{ onResume: () => void; onRestart: () => void; onMenu: () => void }> = ({ onResume, onRestart, onMenu }) => {
  const paused = useMatch((s) => s.paused);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useMatch.getState().setPaused(!useMatch.getState().paused);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!paused) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal pause" role="dialog" aria-modal="true" aria-label="Pausa" data-testid="pause-modal">
        <h2>Pausa</h2>
        <button className="btn primary" onClick={onResume} data-testid="pause-resume">Continuar</button>
        <button className="btn" onClick={onRestart} data-testid="pause-restart">Reiniciar partida</button>
        <button className="btn" onClick={onMenu} data-testid="pause-menu">Menu principal</button>
        <p className="hint">Esc para fechar · dica: toque em uma carta para inspecionar</p>
      </div>
    </div>
  );
};
