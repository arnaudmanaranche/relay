# Design

<!-- impeccable:design -->

## Surface

`docs/index.html` — the public Relay documentation/ecosystem site (Read mode: a developer arrives with a question — "what is this, is it for me, how does it work, how do I run it" — and must leave able to answer all four and install it).

## Direction contract

**THESIS:** Relay turns a single AI coding session into a physical assembly line of seven enforced checkpoints — shown as a literal ascending stack of isometric blocks, one per role — refusing the generic gradient-arrow flowchart every dev-tool site ships for "our process."

**OWN-WORLD:** Cream/paper ground (`#f7f5f2`), near-black ink (`#171512`), flat isometric blocks in three accent families — sage (`#9fb49a`/`#7e9678`, start/scope), charcoal (`#26241f`/`#171512`, the one role that writes code), slate-blue (`#8ea7b8`/`#6d8898`, learn/close the loop) — against plain cream/white blocks for the remaining roles. Coral (`#d85f2f`) stays the single interactive accent (active states, links, CTAs), never a block color. Type: Archivo (UI/display), Source Serif (headings), IBM Plex Mono (kickers, code, small labels) — all already self-hosted via base64 `@font-face`, preserved as a confirmed brand asset. Flat surfaces, 1px hairline borders, no gradients, no shadows beyond the isometric cubes' own three-face shading.

**STORY:** A visitor sees the seven gated roles as physical blocks before reading a word, understands Relay replaces "prompt in, diff out" with a real team's discipline, sees the ecosystem (skill/plugin install, the pipeline engine, the menubar app) as one coherent system rather than three products, then walks the actual pipeline station by station.

**FIRST VIEWPORT:** Kicker + crossed-out list of what unsupervised AI coding actually looks like (mirrors the pinned reference's struck-through pain list) → headline → isometric staircase of the seven role-blocks, ascending left to right, each labeled, clickable (jumps the walkthrough rail below to that stage) → lede paragraph → two CTAs.

**POSITIONING PASS (Sept 2026):** The surface was re-pitched from "documentation of a pipeline" to **developer-tool landing page for solo builders**, following current dev-tool site conventions: a plain declarative hero (no metaphor or pun), a copyable install one-liner in the hero, an honest proof strip of verifiable numbers (7 roles, 320 tests — never fabricated social proof, since the project has no customers or stars to cite), a landscape section naming real neighbouring tools by category, a for/not-for section, and an objection-handling FAQ before the quick start. Section order (revised after a read-through as the target developer): **problem → how it works → what's enforced → where Relay fits → is it for you → install/run/watch (quick start folded in) → anatomy → configuration → FAQ.**

The earlier order put three screens of positioning (problem, landscape, for-you) before the product appeared, and the hero had no visual at all — a sceptical developer had ~550 words to read before any proof. The demo now lands on the second screen, and the two decision sections (where it fits, is it for you) come after it, when the reader can actually answer them. Two sections were cut: **Dev batching** (an internal post-mortem about a truncation bug — rigour is already proved by the guardrails section; the fact survives in the Dev role text and the `devFileBatchSize` config row) and the standalone **Quick start**, which duplicated the install commands five sections away from "Install · run · watch".

The hero carries one static scene — the feature outlined at the centre with its four pieces in four different states — beside the colour legend. It teaches the state palette in one frame without repeating the interactive walkthrough.

**FORM:** Single-page Read-mode site, sidenav + long-scroll sections (inherited structure). Light-only — no dark-mode variant, no theme toggle. New sections: Motivation (the "why", short, right after hero) and Ecosystem (skill / pipeline / menubar as one system), both using the same block-token visual language at smaller scale. The interactive walkthrough (rail, gate explorer, config groups, safety grid) keeps its JS state machine; rail nodes carry each stage's own illustration.

## The cube is the feature

One shape carries the whole system: **the isometric cube is the feature itself.** It sits in the same place in all eight illustrations, and each stage is something happening *to it* — so clicking along the rail tells one feature's story from written-down to remembered, rather than showing eight unrelated scenes.

Its colour is where that feature has got to. Six states, one legend, used by every illustration and the rail:

| Cube | State |
|---|---|
| plain outline | scoped, not started |
| charcoal | being built |
| sage | passed |
| accent (coral) | waiting on a human |
| halt (red) | failed |
| slate | remembered |

**The set is cumulative.** What a stage builds stays on the deck for the stages after it, drawn at `.gl-past` opacity — it happened, it is no longer the subject. The footprint appears at Scope and never leaves; the pillars and wires appear at Design and are still there under Build, Review and Verify. Each stage therefore shows *the accumulated state plus its own verb*, rather than resetting the scene. `planWires()` draws the shared deck wiring and `splitByDepth()` returns the pillars as `back`/`front` so the feature can be drawn between them (isometric painter's order); `featureShell()` is the outlined volume Scope agreed.

## Verdicts drive the illustration

The gate explorer is not just a text panel: choosing a return value **repaints the scene**, because colour is state. Review → `FAIL` turns the pillars coral (back to Dev), QA → `FAIL` turns them halt-red, QA → `BLOCKED_ENV` deliberately leaves them charcoal — there was no result to read, so painting a verdict on them would be a lie. Architect → `awaiting your approval` turns them coral; Dev Review → `blocked` leaves its layer out of the stack and marked, because a blocked run does not resolve.

Builders take a `variant` (`go` / `retry` / `halt` / `pause`, from the outcome type) and `showOutcome()` re-renders the glyph with it. Two verdicts of the same type currently render identically (Review's `PASS` and `PASS_WITH_NOTES`); distinguishing them would mean passing the verdict itself rather than its type.

**The pillars are the units of work.** The Architect names the pieces this feature needs; those pillars are then what changes state — charcoal as they are built, one coral when Review flags it, sage as each passes Verify, slate once Learn files them. The feature itself stays the outlined volume agreed at Scope: it is the thing being made, not a unit of work. Only Verify and Learn colour the shell too, because by then the verdict applies to the whole feature.

The cube is the noun, the animation is the verb. **Scope** spreads its footprint and defines its volume a layer at a time — the same cube as Build, but hollow and outlined rather than solid, so "agreed" and "built" are the same shape in two states; **Clarify** takes the same scoped cube and slides *one layer* out of the stack, coral while it is out — that part of the brief is unclear — and plain again as it drops back into line, resolved. No question mark, no tick: colour alone carries it, which is the point of having a state palette; **Design** raises four pillars around it one at a time, each wired back to the feature as it lands — the plan has several supports, so they must not arrive together. Note the painter's ordering: in isometric, solids have to be drawn far-to-near (larger `x + y` last) or the front pillar renders behind the feature; **Build** turns each planned pillar charcoal, one after another; **Review** scans each built pillar in turn and marks it; **Verify** lands a real result on each one; **Learn** turns the shipped pillars slate. None of these three touch the feature shell — the verdict is about the work, not the thing being made; **Prune** keeps the same deck and shows memory absorbing the work: the pillars are drawn in the feature's own cell and animated in from where they stood, so they are swallowed by it, and the feature turns slate. The plan wires are gone here: once the work is absorbed there is nothing left for them to connect. It runs on a schedule rather than per feature, but dropping the cumulative set to say so cost more than it explained — the wording in its panel carries that.

Two earlier attempts are worth remembering as anti-patterns: giving each stage its own object (a sheet, a screen, a board) made the objects vary while saying nothing, and the cube — the thing people recognise — appeared in only some of them. Making each stage *six* cubes said "units of work" but told no story. One cube, followed through, does both.

The hero once carried an animated strip of the same seven stages. It was removed: it repeated the walkthrough section verbatim a screen later.

**Vocabulary:** the word is **stage**, never "station", in UI copy, class names and code.

## Building the glyphs

All eight are generated by one toolkit (`P/slab/box/seg/tick` on a shared 2:1 grid, `VIEW` constants) and all sit on the same 3×3 plinth, so they read as one family. Shared pieces: `featureShell()` (the scoped volume), `pillarBox()`/`planWires()`/`splitByDepth()` (the plan), `layerBox()` (one layer of the feature).

**Consistency rules for the set** (these are what make eight separate drawings feel like one system):

- **Two stroke weights, no exceptions.** 1px on every block edge, 1.4px on every drawn line, and 1.6px reserved for check marks. Mixed weights were what made the set feel unsettled; there are now exactly three values across all ~300 stroked elements.
- **Softer ink than page text.** `--gl-ink`, `--gl-pass` and `--gl-accent` are the page colours mixed back toward the background. At glyph scale, full-strength accent and pass green read as warnings rather than diagram marks. Charcoal was lightened off near-black for the same reason.
- **Small marks.** Check marks are deliberately undersized — they confirm, they don't shout.
- **Optically centred, not grid-centred.** `fitGlyph()` measures each composition's real bounds after mount and centres/fits it in the frame. The eight differ a lot in height (a standing sheet versus a flat board), so a shared grid origin left some sitting high and some low. It runs before paint, so nothing jumps.
- **An element's resting state must be its finished state.** These glyphs are also drawn unanimated (in the rail) and the play helper drops `.working` once a run is over, so anything whose CSS resting value is its *starting* value shows up wrong: filled layers went invisible in the rail, and the review sweep parked itself off the board. Draw at the end position and animate in; let the animation supply the empty start. `playGlyph()` additionally guarantees the finished scene after `GLYPH_RUN_MS`, so a suspended animation never leaves an empty cube — missing content, not just missing motion.
- **Every scene must read in its finished state.** Retro's traces originally merged onto the same cell as the memory brick and vanished; they now settle into seats around it.

They animate **only while their station is selected** (`.glyph.working`), and every animation rule — including the `opacity: 0` starting states — lives inside `@media (prefers-reduced-motion: no-preference)`, so reduced-motion users get the completed scene rather than an empty one.

Two authoring rules learned the hard way: emit exactly **one `style` attribute** per SVG element (two silently drops the second, which killed every fill), and give `ellipse`/`circle` an explicit `fill: none` or they render as filled blobs.

## Motion

Tokens live in `:root`: `--ease-out` for entrances (decelerate into place), `--ease-in-out` for travel, `--ease-press` at `--dur-press: 90ms` for touch response. Three rules:

1. **Nothing loops forever.** Every glyph plays its sequence once and settles in the finished state (`animation-fill-mode: both`). A diagram that never stops moving is noise, and the point is to show the work *completing*. Replay is on demand — click the glyph stage, or "Run it again" under the hero.
2. **Motion is never load-bearing.** `IntersectionObserver`, `requestAnimationFrame`, and programmatic smooth scrolling are all suppressed in some contexts (background tabs, embedded frames). Every one of them has a `setTimeout` backstop, so a suppressed animation degrades to the finished state rather than to blank content or a strip parked off-screen. This was found the hard way: the scroll-reveal initially hid content that could never come back.
3. **Every action answers.** Buttons scale on press, the copy button reports success *and* failure honestly, and the rail eases its dimming rather than flicking. Content itself never fades in: scroll-reveal and panel entrance animations were removed on request, and they were also a liability — the first version hid content that could never come back.

## Interaction: the gate explorer

The rail is no longer a passive tab strip. Each station's panel lists the verdicts that role can actually return (PASS / PASS_WITH_NOTES / FAIL, `blocked`, `BLOCKED_ENV`, …) and choosing one plays the real control flow out **on the rail above**: the retry target turns amber, downstream stations dim, a halt marker appears, and a note spells out what happens next. This is deliberate — the site's central claim is that `run-pipeline.sh` decides control flow, not the model, so the consequence has to be visible on the pipeline itself rather than described in a paragraph. Verdict data lives in `META` and must stay traceable to real pipeline behaviour.

The hero staircase stays plain cubes: it is the identity mark, and swapping in eight different shapes there would trade a recognisable signature for noise.

## Tokens (light-only)

```
--bg: #f7f5f2        --bg-raised: #ffffff
--line: #ddd8d0       --line-soft: #eae6de
--text-hi: #171512    --text-lo: #4b463d    --text-muted: #726c5f
--accent: #d85f2f     --pass: #3f7a3f       --retry: #96701f     --halt: #b23d33

--block-sage: #9fb49a     --block-sage-side: #7e9678
--block-charcoal: #2c2a25 --block-charcoal-side: #171512
--block-slate: #8ea7b8    --block-slate-side: #6d8898
--block-plain: #ffffff    --block-plain-side: #e5e0d7

--font-ui: 'Archivo', Arial, Helvetica, sans-serif
--font-serif: 'Source Serif', Georgia, serif
--font-mono: 'Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace
```

## Role → block color mapping (reused everywhere a role appears: hero, rail, anatomy)

PM = sage · Dev Review = plain · Architect = plain · Dev = charcoal · Review = plain · QA = plain · Retro = slate. (Memory Compact branch stage = plain, dashed outline — it's periodic, not a numbered station.)

## What must not change

Role facts, gate types, example artifacts, guardrail list, config keys and backend comparison — all sourced from the repo itself and must stay accurate, not be rewritten for tone.
