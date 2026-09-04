import type { ReactElement } from 'react';

export const COLOR_KEYS = ['sage', 'charcoal', 'slate', 'plain', 'accent', 'halt'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** A true 3-face isometric cube (top / right / left), drawn on an isometric
 *  grid of unit u: bounding box is 2u x 2u. Reused at every scale (the hero
 *  line, the pipeline rail, the guarantee cards, the wordmark) so the
 *  block motif reads as one system rather than several icon styles. */
function cubeFaces(u: number) {
  const u2 = u * 2, uh = u * 0.5, u15 = u * 1.5;
  const pts = (arr: [number, number][]) => arr.map(([x, y]) => `${x},${y}`).join(' ');
  return {
    top: pts([[u, 0], [u2, uh], [u, u], [0, uh]]),
    right: pts([[u, u], [u2, uh], [u2, u15], [u, u2]]),
    left: pts([[0, uh], [u, u], [u, u2], [0, u15]]),
  };
}

export function CubeGroup({ colorKey, u, outline }: { colorKey: string; u: number; outline?: boolean }) {
  const key = (COLOR_KEYS as readonly string[]).includes(colorKey) ? colorKey : 'plain';
  const f = cubeFaces(u);
  const fill = (face: string) => (outline ? 'none' : `var(--${key}-${face})`);
  return (
    <>
      <polygon points={f.top} style={{ fill: fill('top') }} />
      <polygon points={f.right} style={{ fill: fill('right') }} />
      <polygon points={f.left} style={{ fill: fill('left') }} />
    </>
  );
}

export function IsoCube({ colorKey, u, outline }: { colorKey: string; u: number; outline?: boolean }) {
  const u2 = u * 2;
  return (
    <svg
      className={'iso-cube' + (outline ? ' outline' : '')}
      width={u2}
      height={u2}
      viewBox={`0 0 ${u2} ${u2}`}
      aria-hidden="true"
    >
      <CubeGroup colorKey={colorKey} u={u} outline={outline} />
    </svg>
  );
}

/** Wordmark glyph: three ascending cubes (sage -> charcoal -> slate), the
 *  pipeline compressed to icon scale. Used in the sidenav brand and mobile bar
 *  in place of a generic logotype dot. */
export function LogoMark({ u = 9 }: { u?: number }): ReactElement {
  const stepX = u * 0.62, stepY = u * 0.4;
  const colors = ['sage', 'charcoal', 'slate'];
  const w = stepX * 2 + u * 2, h = stepY * 2 + u * 2;
  return (
    <svg className="iso-cube logo-mark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {colors.map((c, i) => (
        <g key={c} transform={`translate(${i * stepX},${(colors.length - 1 - i) * stepY})`}>
          <CubeGroup colorKey={c} u={u} />
        </g>
      ))}
    </svg>
  );
}
