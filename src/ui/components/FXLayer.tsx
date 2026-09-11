import React from 'react';
import { useMatch } from '../matchStore';
import { useMultiplayer } from '../../multiplayer/store';
import type { Cue } from '../../game/controller';

/**
 * Floating damage numbers, particles and shakes — purely visual echoes of
 * already-resolved engine events.
 */
/**
 * Camada de efeitos. Lê as duas fontes possíveis de cues (partida local/IA e
 * partida online) e as trata de forma idêntica — o feedback visual é o mesmo
 * nos dois modos.
 */
export const FXLayer: React.FC = () => {
  const matchCues = useMatch((s) => s.cues);
  const onlineCues = useMultiplayer((s) => s.onlineCues);
  const dropMatch = useMatch((s) => s.dropCue);
  const dropOnline = useMultiplayer((s) => s.dropCue);

  const cues = React.useMemo(
    () => [
      ...matchCues.map((c) => ({ cue: c, drop: dropMatch })),
      ...onlineCues.map((c) => ({ cue: c, drop: dropOnline }))
    ].slice(-24),
    [matchCues, onlineCues, dropMatch, dropOnline]
  );

  React.useEffect(() => {
    if (cues.length === 0) return;
    const timers = cues.map(({ cue, drop }) => setTimeout(() => drop(cue.id), 1600));
    return () => timers.forEach(clearTimeout);
  }, [cues]);

  return (
    <div className="fx-layer" aria-hidden>
      {cues.map(({ cue: c }) => {
        const el = c.uid ? document.querySelector(`[data-uid="${c.uid}"]`) : null;
        const rect = el?.getBoundingClientRect();
        const style: React.CSSProperties = rect
          ? { left: rect.left + rect.width / 2, top: rect.top + rect.height * 0.3 }
          : { left: window.innerWidth / 2, top: window.innerHeight * 0.35 };
        if (c.kind === 'shake') {
          return (
            <span key={c.id} className={`fx-shake-host ${c.big ? 'big' : ''}`}>
              <Shakeem />
            </span>
          );
        }
        if (c.kind === 'attack') {
          return <span key={c.id} className="fx-slash" style={style} />;
        }
        if (c.kind === 'ko') {
          return (
            <React.Fragment key={c.id}>
              <span className="fx-float ko" style={style}>{c.text}</span>
              <Burst style={style} />
            </React.Fragment>
          );
        }
        const cls = c.kind === 'damage' ? (c.big ? 'fx-float dmg big' : 'fx-float dmg') : c.kind === 'heal' ? 'fx-float heal' : c.kind === 'upgrade' ? 'fx-float upgrade' : 'fx-float info';
        return (
          <span key={c.id} className={cls} style={style}>
            {c.text}
          </span>
        );
      })}
    </div>
  );
};

const Shakeem: React.FC = () => {
  React.useEffect(() => {
    document.body.classList.add('shake');
    const t = setTimeout(() => document.body.classList.remove('shake'), 450);
    return () => clearTimeout(t);
  }, []);
  return null;
};

const Burst: React.FC<{ style: React.CSSProperties }> = ({ style }) => {
  const parts = Array.from({ length: 10 }, (_, i) => i);
  return (
    <span className="fx-burst" style={style}>
      {parts.map((i) => (
        <i key={i} style={{ ['--ang' as any]: `${i * 36}deg` }} />
      ))}
    </span>
  );
};
