import React from 'react';
import { useMatch } from '../matchStore';
import { findInst } from './BoardCard';
import { defOf } from '../../engine/queries';
import { CardView } from './CardView';

/** Modal de inspeção de carta (clique/toque longo). */
export const InspectModal: React.FC = () => {
  const uid = useMatch((s) => s.inspectUid);
  const setInspect = useMatch((s) => s.setInspect);
  const stateRef = useMatch((s) => s.stateRef);
  const inst = uid && stateRef ? findInst(stateRef, uid) : null;
  // O modal mais acima CONSOME o Escape. Sem isso, o listener de pausa (que
  // também ouve Escape no window) abria o menu de pausa junto: fechava a
  // inspeção e deixava um .modal-backdrop cobrindo a partida — reproduzido em
  // navegador real pelo E2E. Capture + stopPropagation impede a fase de bubble.
  React.useEffect(() => {
    if (!inst) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setInspect(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [inst, setInspect]);
  if (!inst) return null;
  const def = defOf(inst);
  return (
    <div className="modal-backdrop" onClick={() => setInspect(null)}>
      <div className="modal inspect" role="dialog" aria-modal="true" aria-label={`Detalhes de ${def.name}`} onClick={(e) => e.stopPropagation()} data-testid="inspect-modal">
        <button className="close-btn" onClick={() => setInspect(null)} aria-label="Fechar detalhes" data-testid="inspect-close">✕</button>
        <CardView def={def} />
      </div>
    </div>
  );
};

/** Visualizador de definição (construtor/coleção). */
export const DefInspectModal: React.FC<{ def: ReturnType<typeof defOf> | null; onClose: () => void }> = ({ def, onClose }) => {
  // Idem: consome o Escape na fase de capture quando está aberto.
  React.useEffect(() => {
    if (!def) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [def, onClose]);
  if (!def) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal inspect" role="dialog" aria-modal="true" aria-label={`Detalhes de ${def.name}`} onClick={(e) => e.stopPropagation()} data-testid="def-inspect-modal">
        <button className="close-btn" onClick={onClose} aria-label="Fechar detalhes" data-testid="def-inspect-close">✕</button>
        <CardView def={def} />
      </div>
    </div>
  );
};

/**
 * Painel de escolha pendente (anti-soft-lock).
 *
 * Garantia: QUALQUER ChoiceRequest emitido pelo engine é resolvível pela UI.
 * Escolhas de carta da mão/descarte (`kind: 'cards'`) e opções (`kind:
 * 'option'`) não têm representação clicável no tabuleiro — antes podiam
 * deixar a partida travada. Este painel lista todos os candidatos com rótulo
 * (e nome da carta quando disponível) e NÃO bloqueia o tabuleiro: clicar num
 * personagem do board continua funcionando como atalho.
 */
export const ChoicePanel: React.FC<{ onResolve: (selected: string[]) => void }> = ({ onResolve }) => {
  const pending = useMatch((s) => s.pending);
  const stateRef = useMatch((s) => s.stateRef);
  const [selected, setSelected] = React.useState<string[]>([]);

  React.useEffect(() => {
    setSelected([]);
  }, [pending?.prompt, pending?.candidates.join('|')]);

  if (!pending) return null;
  const req = pending;
  const label = (uid: string): string => {
    if (req.labels?.[uid]) return req.labels[uid];
    if (stateRef) {
      const inst = findInst(stateRef, uid);
      if (inst) return defOf(inst).name;
    }
    return uid;
  };
  const multi = req.max > 1;
  const toggle = (uid: string) => {
    setSelected((sel) => {
      if (sel.includes(uid)) return sel.filter((x) => x !== uid);
      const next = [...sel, uid];
      return next.slice(-req.max);
    });
  };
  const canConfirm = selected.length >= req.min || req.optional;
  const confirm = () => onResolve(canConfirm ? selected : []);

  return (
    <div className="choice-panel" data-testid="choice-panel" role="region" aria-label="Escolha pendente">
      <div className="choice-prompt">
        <span>🎯 {req.prompt}</span>
        <span className="choice-hint">
          {multi ? `Escolha ${req.min === req.max ? req.min : `${req.min}–${req.max}`} itens` : 'Escolha uma opção'}
        </span>
      </div>
      <div className="choice-options">
        {req.candidates.map((uid) => (
          <button
            key={uid}
            className={`choice-chip ${selected.includes(uid) ? 'selected' : ''}`}
            data-testid={`choice-${uid}`}
            onClick={() => {
              if (multi) toggle(uid);
              else onResolve([uid]);
            }}
          >
            {label(uid)}
          </button>
        ))}
      </div>
      {multi && (
        <div className="choice-actions">
          {req.optional && <button className="btn" onClick={() => onResolve([])}>Nenhum</button>}
          <button className="btn primary" disabled={!canConfirm} onClick={confirm} data-testid="choice-confirm">
            Confirmar ({selected.length})
          </button>
        </div>
      )}
    </div>
  );
};
