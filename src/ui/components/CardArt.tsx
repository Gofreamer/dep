import React from 'react';
import type { CardDef } from '../../engine/types';
import { resolveCardArt } from '../../data/jet/art';
import { Artwork } from './Artwork';

/**
 * Arte oficial da carta com fallback procedural.
 *
 * - Resolve via `resolveCardArt(def)` (ÚNICA fonte de verdade — nenhuma regra
 *   de resolução espalhada pelos componentes).
 * - `remote` → `<img>` com lazy loading (ou `eager` para o crítico da
 *   partida: ativo/reserva/mão); `procedural`/falha → `Artwork` atual.
 * - Falha de imagem (404, host fora, URL removida) NUNCA quebra a UI: cai
 *   para o procedural. Sem loop de `onError` (estado `failed` trava em true).
 * - Sem `dangerouslySetInnerHTML`: `alt` é texto puro.
 */
export const CardArt: React.FC<{
  def: CardDef;
  /** Classe do container procedural ou da <img> (dimensionamento). */
  className?: string;
  /** `cover` (padrão, preenche sem distorcer) ou `contain` (arte completa). */
  fit?: 'cover' | 'contain';
  /** `true` só para o crítico da partida (ativo/reserva); listagens usam lazy. */
  eager?: boolean;
}> = ({ def, className, fit = 'cover', eager = false }) => {
  const resolved = React.useMemo(
    () => resolveCardArt(def),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.identityId, def.edition, def.id]
  );
  const [failed, setFailed] = React.useState(false);
  const url = resolved.kind === 'remote' ? resolved.url : null;
  React.useEffect(() => {
    setFailed(false);
  }, [url]);

  if (resolved.kind === 'procedural' || failed || !url) {
    return <Artwork seed={def.art.seed} motif={def.art.motif} faction={def.faction} className={className} />;
  }
  return (
    <img
      src={url}
      alt={`${def.name} — arte oficial`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      className={className ? `${className} card-art-img` : 'card-art-img'}
      style={{ objectFit: fit }}
      onError={() => setFailed(true)}
    />
  );
};
