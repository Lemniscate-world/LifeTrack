// src/Confetti.tsx
// Lightweight, dependency-free confetti burst used to celebrate level-ups.
// Pure CSS animation — 50 absolutely-positioned pieces that fall from the top
// of the screen. `message` renders a centered celebration banner on top.
//
// The piece geometry is generated with a deterministic hash (instead of
// Math.random) so the component is pure/idempotent and passes the
// react-hooks/purity lint rule.

import { useMemo } from 'react';

const COLORS = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
const COUNT = 50;

/** Deterministic pseudo-random in [0, 1) derived from an index + seed. */
function hashRand(i: number, seed = 0): number {
  let x = Math.imul(i + 1, 2654435761) ^ Math.imul(seed + 1, 40503);
  x = Math.imul(x ^ (x >>> 16), 2246822507);
  x = Math.imul(x ^ (x >>> 13), 3266489909);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export default function Confetti({ message }: { message?: string }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        id: i,
        left: hashRand(i, 1) * 100,
        delay: hashRand(i, 2) * 0.5,
        duration: 2.4 + hashRand(i, 3) * 1.6,
        color: COLORS[i % COLORS.length],
        size: 6 + hashRand(i, 4) * 7,
        tilt: hashRand(i, 5) * 360,
      })),
    [],
  );

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: Math.max(3, p.size * 0.4),
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.tilt}deg)`,
          }}
        />
      ))}
      {message && <div className="confetti-banner">{message}</div>}
    </div>
  );
}