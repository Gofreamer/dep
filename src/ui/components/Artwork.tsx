import React from 'react';
import { registry } from '../../engine/registry';

/**
 * Procedural placeholder artwork — deterministic per seed, themed by faction.
 * Real artwork can replace this later via ArtSpec.artRef without any other change.
 */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFrom(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function factionColor(faction: string): string {
  return registry.faction(faction)?.color ?? '#7dd3fc';
}

export const Artwork: React.FC<{ seed: string; motif: string; faction: string; className?: string }> = ({ seed, motif, faction, className }) => {
  const base = factionColor(faction);
  const r = rngFrom(hashStr(seed));
  const id = React.useMemo(() => `a${hashStr(seed + motif).toString(36)}`, [seed, motif]);
  const c1 = shade(base, 30);
  const c2 = shade(base, -70);
  const rot = Math.floor(r() * 360);
  const pts = 3 + Math.floor(r() * 5);
  const spikes = [];
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const inner = 22 + r() * 10;
    const outer = 52 + r() * 26;
    spikes.push(`${64 + Math.cos(a) * outer},${64 + Math.sin(a) * outer}`);
    spikes.push(`${64 + Math.cos(a + Math.PI / pts) * inner},${64 + Math.sin(a + Math.PI / pts) * inner}`);
  }
  const cx = 40 + r() * 48;
  const cy = 40 + r() * 30;
  const blobs = Array.from({ length: 5 }, () => ({ x: 10 + r() * 108, y: 10 + r() * 108, s: 8 + r() * 30 }));

  const motifGlyph: Record<string, string> = {
    solar: '☀', mare: '≈', flora: '❦', volt: '⚡', umbra: '☾', neutro: '⬡',
    resource: '◆', action: '✦', equipment: '⚙', field: '▲'
  };
  const glyph = motifGlyph[motif] ?? '⬡';

  return (
    <svg viewBox="0 0 128 128" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(c2, 40)} />
          <stop offset="1" stopColor="#0a0d18" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.5" cy="0.45" r="0.65">
          <stop offset="0" stopColor={c1} stopOpacity="0.85" />
          <stop offset="1" stopColor={c1} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="128" height="128" fill={`url(#${id}bg)`} />
      {blobs.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={b.s} fill={i % 2 ? c2 : c1} opacity={0.16 + r() * 0.14} />
      ))}
      <circle cx={cx} cy={cy} r="62" fill={`url(#${id}glow)`} />
      <g transform={`rotate(${rot} 64 64)`}>
        <polygon points={spikes.join(' ')} fill="none" stroke={c1} strokeWidth="2.5" opacity="0.9" />
        <polygon points={spikes.join(' ')} fill={c1} opacity="0.14" />
      </g>
      <circle cx="64" cy="64" r="30" fill="none" stroke={shade(base, 80)} strokeWidth="1.4" opacity="0.7" />
      <circle cx="64" cy="64" r="38" fill="none" stroke={base} strokeWidth="0.8" opacity="0.5" strokeDasharray="3 6" />
      <text x="64" y="78" textAnchor="middle" fontSize="34" fill={shade(base, 110)} opacity="0.95" style={{ fontFamily: 'serif' }}>
        {glyph}
      </text>
      <rect width="128" height="128" fill="transparent" stroke="#000" strokeOpacity="0.35" strokeWidth="6" />
    </svg>
  );
};
