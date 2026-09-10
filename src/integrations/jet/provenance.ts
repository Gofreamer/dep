import type { JetProvenance } from './types';

/**
 * Provenance helpers. Every JET card carries where its data came from so any
 * definition can be traced back to the exact source record later.
 */

const REPO = 'RocksXB/jet-tactics.' as const;

export function prov(
  sourceType: JetProvenance['sourceType'],
  sourceId: string,
  opts: { capturedAt?: string; sourceCommit?: string; sourceEdition?: string } = {}
): JetProvenance {
  return {
    sourceRepository: REPO,
    sourceType,
    sourceId,
    capturedAt: opts.capturedAt ?? new Date().toISOString().slice(0, 10),
    sourceCommit: opts.sourceCommit,
    sourceEdition: opts.sourceEdition
  };
}

/**
 * Used when the only available source is this task's prompt text (repo
 * inaccessible). Such records are ALWAYS marked for confirmation against the
 * real repository before being treated as canonical.
 */
export function taskPromptProv(sourceId: string, capturedAt: string): JetProvenance {
  return {
    sourceRepository: REPO,
    sourceType: 'task-prompt-fallback',
    sourceId,
    capturedAt
  };
}
