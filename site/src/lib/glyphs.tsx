import { useLayoutEffect, useRef, type CSSProperties, type ReactElement } from 'react';

// ========================================================================
// Role glyphs: one isometric workbench per stage.
// All of them are drawn on the same 2:1 grid with the same plinth, so they
// read as one family; the apparatus on top is what makes each role legible.
// ========================================================================
const VIEW = { w: 200, h: 132, cx: 100, cy: 40, tw: 46, th: 23, zh: 26 };

type Pt = [number, number];
type Cell = [number, number, number];

const r2 = (n: number) => Math.round(n * 100) / 100;

function P(x: number, y: number, z: number): Pt {
  return [r2(VIEW.cx + (x - y) * VIEW.tw / 2), r2(VIEW.cy + (x + y) * VIEW.th / 2 - z * VIEW.zh)];
}
const pts = (list: Pt[]) => list.map((p) => `${p[0]},${p[1]}`).join(' ');

/** Screen-space delta of one grid step, for CSS transforms that must travel
 *  along an isometric axis rather than a screen axis. */
function delta(dx: number, dy: number, dz: number): CSSProperties {
  return {
    ['--dx' as string]: `${r2((dx - dy) * VIEW.tw / 2)}px`,
    ['--dy' as string]: `${r2((dx + dy) * VIEW.th / 2 - dz * VIEW.zh)}px`,
  } as CSSProperties;
}
const stagger = (i: number, step = 0.16): CSSProperties => ({ animationDelay: `${r2(i * step)}s` });

function face(k: string, list: Pt[], fill: string, cls?: string, style?: CSSProperties) {
  return <polygon key={k} className={cls} style={{ fill, ...style }} points={pts(list)} />;
}

function slab(k: string, x: number, y: number, z: number, w: number, d: number, key: string, cls?: string, style?: CSSProperties) {
  return face(k, [P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)], `var(--${key}-top)`, cls, style);
}

function box(k: string, x: number, y: number, z: number, w: number, d: number, h: number, key: string, cls?: string, style?: CSSProperties) {
  return (
    <g key={k} className={cls} style={style}>
      {face('l', [P(x, y + d, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x, y + d, z)], `var(--${key}-left)`)}
      {face('r', [P(x + w, y, z + h), P(x + w, y + d, z + h), P(x + w, y + d, z), P(x + w, y, z)], `var(--${key}-right)`)}
      {face('t', [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], `var(--${key}-top)`)}
    </g>
  );
}

function seg(k: string, a: Cell, b: Cell, cls?: string, style?: CSSProperties) {
  const p1 = P(a[0], a[1], a[2]), p2 = P(b[0], b[1], b[2]);
  return <line key={k} className={cls} style={style} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />;
}

const plinth = () => box('plinth', 0, 0, -0.28, 3, 3, 0.28, 'plain', 'gl-plinth');

// ONE cube, eight stages. The cube is the feature itself: it sits in the same
// place in every illustration, and each stage is something happening TO it.
// Its colour is where it has got to (outlined, questioned, built, passed,
// remembered), so clicking through the rail tells that feature's story.
const HERO = { x: 0.85, y: 0.85, w: 1.3, h: 1.0 };

/** The same cube, not yet built: footprint only. */
const featureOutline = () =>
  slab('outline', HERO.x, HERO.y, 0.03, HERO.w, HERO.w, 'plain', 'gl-scope', { strokeDasharray: '3.5 3' });

const LAYERS = 5;
function layerBox(k: string, i: number, key: string, cls?: string, style?: CSSProperties) {
  const hh = HERO.h / LAYERS;
  return box(k, HERO.x, HERO.y, 0.04 + i * hh, HERO.w, HERO.w, hh, key, cls, style);
}

// The set is cumulative: what an earlier stage built stays on the deck for the
// later ones, drawn at .gl-past. The pillars the Architect names are the units
// of work: they are what changes state through Build, Review, Verify and
// Learn, not the feature shell they stand around.
const PILLARS: Pt[] = [[0.02, 0.02], [2.38, 0.02], [0.02, 2.38], [2.38, 2.38]];
const P_SZ = 0.6, P_H = 0.44;

function pillarBox(k: string, i: number, key: string, cls?: string, style?: CSSProperties) {
  const p = PILLARS[i];
  return box(k, p[0], p[1], 0.02, P_SZ, P_SZ, P_H, key, cls, style);
}
const pillarDepth = (i: number) => (PILLARS[i][0] + P_SZ) + (PILLARS[i][1] + P_SZ);

function planWires(past: boolean, delayFn?: (i: number) => CSSProperties) {
  const corners: Pt[] = [
    [HERO.x, HERO.y], [HERO.x + HERO.w, HERO.y],
    [HERO.x, HERO.y + HERO.w], [HERO.x + HERO.w, HERO.y + HERO.w],
  ];
  return PILLARS.map((p, i) =>
    seg(
      `wire${i}`,
      [corners[i][0], corners[i][1], 0.06],
      [p[0] + P_SZ / 2, p[1] + P_SZ / 2, 0.06],
      'gl-edge' + (past ? ' gl-past' : ''),
      delayFn ? delayFn(i) : undefined,
    ),
  );
}

/** Isometric painter's order: anything nearer the viewer than the feature has
 *  to be drawn after it. */
function splitByDepth(items: { depth: number; el: ReactElement }[]) {
  const heroDepth = (HERO.x + HERO.w) + (HERO.y + HERO.w);
  const back: ReactElement[] = [], front: ReactElement[] = [];
  items.forEach((it) => (it.depth > heroDepth ? front : back).push(it.el));
  return { back, front };
}

/** The feature as Scope left it: an outlined volume, never filled in again. */
function featureShell(prefix = 'shell', key = 'plain', cls = 'gl-defining', style?: CSSProperties) {
  return Array.from({ length: LAYERS }, (_, i) => layerBox(`${prefix}${i}`, i, key, cls, style));
}

/** Pillars split around the feature shell, the pattern five of the stages share:
 *  four pieces on the deck, the outlined feature standing between them. */
function deck(pillars: (i: number) => ReactElement, wiresPast = true, wireDelay?: (i: number) => CSSProperties) {
  const sp = splitByDepth(PILLARS.map((_, i) => ({ depth: pillarDepth(i), el: pillars(i) })));
  return [plinth(), featureOutline(), ...planWires(wiresPast, wireDelay), ...sp.back, ...featureShell(), ...sp.front];
}

export type GlyphKey =
  | 'hero' | 'pm' | 'dev-review' | 'architect' | 'dev' | 'review' | 'qa' | 'retro' | 'memory-compact';

const GLYPH: Record<GlyphKey, (variant?: string) => ReactElement[]> = {
  // HERO, not a stage: one frame that teaches the colour language. The
  // feature outlined at the centre, and the four pieces it needs shown in the
  // four states a run moves through.
  hero: () => {
    const states = ['plain', 'charcoal', 'accent', 'sage'];
    return deck((i) => <g key={`p${i}`}>{pillarBox(`b${i}`, i, states[i], 'gl-drop', stagger(i, 0.16))}</g>);
  },

  // SCOPE. The feature takes shape: its footprint spreads and its volume is
  // defined layer by layer. Empty, not built: this is the brief, not the code.
  pm: () => [
    plinth(),
    slab('spread', HERO.x - 0.14, HERO.y - 0.14, 0.03, HERO.w + 0.28, HERO.w + 0.28, 'plain', 'gl-scope gl-grow', {
      strokeDasharray: '3.5 3',
    }),
    // Outlined, not filled: the shape is agreed, the code does not exist yet.
    ...Array.from({ length: LAYERS }, (_, i) =>
      layerBox(`stack${i}`, i, 'plain', 'gl-stack gl-defining', stagger(i + 1, 0.14)),
    ),
  ],

  // CLARIFY. The scoped feature is complete, but one layer is unclear. It
  // slides out of the stack and turns coral while it is out; once the answer
  // lands it drops back into line and goes plain again. Colour carries the
  // whole meaning here, so there is no question mark and no tick to place.
  'dev-review': (variant) => {
    const pulled = 2, shift = delta(1.2, -0.15, 0);
    const out: ReactElement[] = [plinth(), featureOutline()];
    for (let i = 0; i < LAYERS; i++) {
      const isOut = i === pulled;
      out.push(layerBox(`l${i}`, i, 'plain', 'gl-defining' + (isOut ? ' gl-pulled' : ''), isOut ? shift : undefined));
      if (isOut) {
        // The same layer in coral, faded in only while it is out of the stack.
        out.push(
          layerBox(
            `c${i}`,
            i,
            variant === 'halt' ? 'halt' : 'accent',
            'gl-pulled' + (variant === 'halt' ? ' gl-stuck' : ' gl-unclear'),
            shift,
          ),
        );
      }
    }
    return out;
  },

  // DESIGN. The Architect names the pieces this feature will need: four
  // pillars go up around it, one at a time, each wired back to it.
  architect: (variant) => {
    const key = variant === 'pause' ? 'accent' : variant === 'retry' ? 'halt' : 'plain';
    return deck(
      (i) => <g key={`p${i}`}>{pillarBox(`b${i}`, i, key, 'gl-drop', { animationDelay: `${r2(0.35 + i * 0.4)}s` })}</g>,
      false,
      (i) => ({ animationDelay: `${r2(0.5 + i * 0.4)}s` }),
    );
  },

  // BUILD. Those pieces get built, one after another. The work happens in
  // the pillars the Architect named; the feature itself is still the outline
  // agreed at Scope.
  dev: (variant) =>
    deck((i) => (
      <g key={`p${i}`}>
        {pillarBox(`base${i}`, i, 'plain', 'gl-past')}
        {pillarBox(
          `fill${i}`,
          i,
          variant === 'retry' ? 'accent' : 'charcoal',
          (variant === 'retry' ? '' : 'gl-dark ') + 'gl-fill',
          stagger(i, 0.32),
        )}
      </g>
    )),

  // REVIEW. Each built piece is scanned in turn and comes back marked. The
  // feature shell is not the subject here: the work under review is the
  // pieces Dev built.
  review: (variant) => {
    const mark = variant === 'halt' ? 'halt' : variant === 'go' ? 'sage' : 'accent';
    return deck((i) => (
      <g key={`p${i}`}>
        {pillarBox(`base${i}`, i, 'charcoal', 'gl-dark')}
        {pillarBox(`mark${i}`, i, mark, 'gl-fill', stagger(i, 0.34))}
      </g>
    ));
  },

  // VERIFY. A real result lands on each built piece. Only the pieces change:
  // the verdict is about the work, not the shell around it.
  qa: (variant) => {
    // BLOCKED_ENV means no result to read: the pieces stay as Dev left them
    // rather than being repainted with a verdict they never got.
    const mark = variant === 'halt' ? 'halt' : variant === 'pause' ? null : 'sage';
    return deck((i) => (
      <g key={`p${i}`}>
        {pillarBox(`base${i}`, i, 'charcoal', 'gl-dark')}
        {mark ? pillarBox(`mark${i}`, i, mark, 'gl-fill', stagger(i, 0.3)) : null}
      </g>
    ));
  },

  // LEARN. The shipped pieces turn to memory for the next run to read.
  retro: (variant) => {
    const mark = variant === 'retry' ? 'accent' : 'slate';
    return deck((i) => (
      <g key={`p${i}`}>
        {pillarBox(`base${i}`, i, 'sage')}
        {pillarBox(`mark${i}`, i, mark, 'gl-fill', stagger(i, 0.26))}
      </g>
    ));
  },

  // PRUNE. Memory absorbs the work: the pieces this run built are drawn in
  // the feature's own cell and animated in from where they stood, so they are
  // swallowed by it, and the feature itself turns to memory. Runs on a
  // schedule rather than per feature, but it inherits the same deck.
  'memory-compact': () => {
    // No wires here: once the work is absorbed into memory the plan that
    // connected the pieces has nothing left to connect.
    const target: Pt = [HERO.x + (HERO.w - P_SZ) / 2, HERO.y + (HERO.w - P_SZ) / 2];
    return [
      plinth(),
      featureOutline(),
      ...PILLARS.map((p, i) =>
        box(`absorb${i}`, target[0], target[1], 0.02, P_SZ, P_SZ, P_H, 'slate', 'gl-absorb', {
          ...delta(p[0] - target[0], p[1] - target[1], 0),
          ...stagger(i, 0.18),
        }),
      ),
      ...featureShell(),
      ...featureShell('mem', 'slate', 'gl-fill', { animationDelay: '1.15s' }),
    ];
  },
};

/** Optically centre each glyph in its frame. The compositions differ a lot in
 *  height (a standing sheet against a flat board), so a shared grid origin
 *  leaves some sitting high and some low. Measure, then centre and fit. Runs
 *  before paint (layout effect), so nothing visibly jumps. */
function useFitGlyph() {
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g || typeof g.getBBox !== 'function') return;
    let b: DOMRect;
    try {
      b = g.getBBox();
    } catch {
      return;
    }
    if (!b || !b.width || !b.height) return;
    const padX = 10, padY = 8;
    const scale = Math.min(1, (VIEW.w - padX * 2) / b.width, (VIEW.h - padY * 2) / b.height);
    const tx = (VIEW.w - b.width * scale) / 2 - b.x * scale;
    const ty = (VIEW.h - b.height * scale) / 2 - b.y * scale;
    g.setAttribute('transform', `translate(${r2(tx)},${r2(ty)}) scale(${r2(scale)})`);
  });
  return ref;
}

export function RoleGlyph({
  glyphKey,
  variant,
  width,
  animate,
}: {
  glyphKey: GlyphKey;
  variant?: string;
  /** Omit for a glyph that should fill its container (the detail panel). */
  width?: number;
  animate?: boolean;
}) {
  const ref = useFitGlyph();
  const build = GLYPH[glyphKey] ?? GLYPH.pm;
  const size = width ? { width, height: r2(width * VIEW.h / VIEW.w) } : {};
  return (
    <svg
      className={'glyph' + (animate ? ' working' : '')}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      {...size}
      aria-hidden="true"
    >
      <g className="gl-content" ref={ref}>
        {build(variant)}
      </g>
    </svg>
  );
}
