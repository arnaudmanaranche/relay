# UI standards

Optional starter for the `dev` role's `typeSkills`/`extraSkills` (see "Dev-only: typeSkills and extraSkills" in `skills/setup/SKILL.md`). Copy this file into `.ai/skills/ui-standards.md` and wire it up for UI file types, e.g.:

```json
"typeSkills": {
  "*.tsx": ".ai/skills/ui-standards.md",
  "*.css": ".ai/skills/ui-standards.md"
}
```

Delete or rewrite any rule below that doesn't fit this project's actual design system — this is a starting point, not a mandate.

## Before writing any layout: commit to tokens and a direction

- Define design tokens (color, radius, spacing, duration/easing) before touching layout. A component that invents its own one-off spacing value or duration is a sign the tokens weren't defined first.
- Commit to one clear aesthetic direction instead of averaging templates. Don't default to "Inter + a purple gradient + rounded corners" — that combination reads as generated, not designed, because it's the path of least resistance for every model asked for "a clean modern UI."
- If the brief calls for a distinctive surface (a landing page, a hero, a marketing page), give it exactly one functional, memorable signature element rather than five competing ones.

## Motion

- Use a deliberate easing curve (a named `cubic-bezier`, defined once as a token) instead of the browser/framework default `ease`.
- Entrances combine opacity + a small upward shift + a blur-clearing effect, not a bare fade.
- Stack multiple faint shadows instead of one heavy drop-shadow — real-world shadows are soft and layered.
- Every interactive element gets a press/tap response (e.g. a slight scale-down), not just a hover state.
- Always honor `prefers-reduced-motion` — motion is a progressive enhancement, never a requirement to perceive the UI correctly.

## Draggable / expandable elements

- Draggable elements need real physics (momentum, friction, soft boundaries at the edges), not an instant snap to the final position.
- Add magnetic snap points with a two-zone system (a pull-in zone and a release zone) rather than one hard threshold.
- Animate height reveals with `grid-template-rows` (or an equivalent that can animate to an intrinsic size), not `max-height` hacks that either clip content or animate a value bigger than the content will ever need.

## Completeness

- Every interactive component needs all of its states designed and implemented — idle, hover, focus, active/pressed, loading, disabled, error, empty — not just the happy path shown in the brief's mockup description.
- A UI review of this file's checklist belongs in Dev's own pass, not deferred to Review — Review checks against the brief's acceptance criteria, not against these standards line by line.
