import type { GlyphKey } from '../lib/glyphs';

export type GateType = 'none' | 'halt' | 'pause' | 'retry' | 'warn' | 'pass';
export type OutcomeType = 'go' | 'retry' | 'halt' | 'pause';

export interface Stage {
  code: string;
  key: GlyphKey;
  label: string;
  short: string;
  role: string;
  produces: string;
  producesDesc: string;
  gate: { type: GateType; label: string; text: string };
  example: { file: string; content: string }[];
}

export interface Verdict {
  v: string;
  type: OutcomeType;
  /** Stage key a retry hands back to, when it is not this stage itself. */
  back?: GlyphKey;
  label: string;
  text: string;
}

export const stages: Stage[] = [
  {
    code: '01', key: 'pm', label: 'PM', short: 'Scope',
    role: "Reads the original issue and the project's directory tree, then writes the requirements down before anyone touches code.",
    produces: 'feature-brief.md',
    producesDesc: 'Problem, goals, numbered acceptance criteria, UX notes, i18n keys, analytics events, scope.',
    gate: { type: 'none', label: 'No gate', text: 'Straight handoff to Dev Review.' },
    example: [{
      file: 'feature-brief.md',
      content:
`# Feature Brief: dark-mode-toggle

## Problem
Users working at night have no way to reduce screen glare inside the
app. Competitor apps ship this; support gets 1-2 tickets/week asking
for it.

## Acceptance criteria
1. A toggle in Settings > Appearance switches light / dark / system.
2. Preference persists across app restarts.
3. Toggle fires the settings_theme_changed analytics event.
4. Every existing screen renders correctly in dark mode.

## Scope
IN: toggle UI, theme persistence, analytics event.
OUT: per-screen custom theming beyond the existing token set.

## i18n
New strings: "Appearance", "Light", "Dark", "System".`,
    }],
  },
  {
    code: '02', key: 'dev-review', label: 'Dev Review', short: 'Clarify',
    role: 'Reads the brief as if about to implement it, and raises anything genuinely ambiguous before real work starts.',
    produces: 'pm-dev-thread.md',
    producesDesc: 'Clarifying questions and PM answers, threaded. Loops up to three times.',
    gate: { type: 'halt', label: 'Halt on blocked', text: 'A verdict of blocked stops the run. The spec is genuinely unclear, not just missing minor detail.' },
    example: [{
      file: 'pm-dev-thread.md',
      content:
`### Thread 1
**Dev Review:** AC 4 says "every existing screen". Does that
include the onboarding flow? It uses a separate navigation stack.
**Status:** Open

**PM:** Yes, onboarding too. Added to scope.
**Status:** Resolved

---
Verdict: clear. Proceeding to Architect.`,
    }],
  },
  {
    code: '03', key: 'architect', label: 'Architect', short: 'Design',
    role: 'Turns the brief into an implementation plan: exact files, order of operations, and a required Mermaid diagram of the actual control and data flow.',
    produces: 'technical-plan.md + repository-context.md',
    producesDesc: 'A file-by-file plan, a mandatory mermaid block, and the relevant existing patterns and conventions.',
    gate: {
      type: 'pause', label: 'Human sign-off',
      text: "Diagram gate first: a missing mermaid block earns one automatic retry, then abort. Design gate second: the run pauses for you to read the plan, and resumes when you approve it. The approval binds to the plan's content, so any later edit forces a fresh review.",
    },
    example: [{
      file: 'technical-plan.md',
      content:
`## Files
- src/hooks/useTheme.ts (new): reads/writes theme preference
- src/components/SettingsAppearance.tsx (modify): add the toggle
- src/theme/ThemeProvider.tsx (modify): resolve light/dark/system

## Flow
\`\`\`mermaid
graph TD
  A[User taps toggle] --> B[useTheme.setTheme]
  B --> C[AsyncStorage.setItem]
  B --> D[ThemeProvider context update]
  D --> E[Screens re-render with new tokens]
\`\`\``,
    }],
  },
  {
    code: '04', key: 'dev', label: 'Dev', short: 'Build',
    role: 'The only role allowed to write source code. Implements the plan file by file, splitting into batches automatically past six impacted files.',
    produces: 'code changes + dev-log.md',
    producesDesc: 'Complete file contents (never diffs) for every touched file, plus a running log of what changed and why.',
    gate: {
      type: 'retry', label: 'One retry',
      text: 'Typecheck, lint, and a scan for placeholders or committed secrets all feed one combined retry. Still failing afterward halts the run.',
    },
    example: [{
      file: 'dev-log.md',
      content:
`- Created src/hooks/useTheme.ts (42 lines)
- Modified src/components/SettingsAppearance.tsx: 3-way toggle
- Modified src/theme/ThemeProvider.tsx: resolves 'system' via
  Appearance.getColorScheme()
- Fired settings_theme_changed on every change
- Persisted via AsyncStorage under the theme:preference key`,
    }],
  },
  {
    code: '05', key: 'review', label: 'Review', short: 'Review',
    role: "Checks the diff against the feature brief's acceptance criteria, and, uniquely, against the Architect's own diagram: does the code actually flow the way the plan said it would?",
    produces: 'review-report.md',
    producesDesc: 'Verdict: PASS, PASS_WITH_NOTES, or FAIL, with findings per item.',
    gate: { type: 'retry', label: 'Retry, then halt', text: 'A FAIL feeds findings back to Dev for one retry. Still FAIL afterward halts before QA and before any PR opens.' },
    example: [{
      file: 'review-report.md',
      content:
`## Verdict: PASS_WITH_NOTES

- AC 1-4: covered.
- Diagram vs diff: matches. useTheme, ThemeProvider, and
  SettingsAppearance are all touched exactly as the Architect drew.
- Note: onboarding stack re-renders on theme change but has no
  dedicated test. Non-blocking, flagged for QA.`,
    }],
  },
  {
    code: '06', key: 'qa', label: 'QA', short: 'Verify',
    role: "Reads real end-to-end results dropped by the project's own CI, framework agnostic: Maestro, Playwright, Cypress, whatever is configured. Never invents a result if none exists.",
    produces: 'qa-report.md',
    producesDesc: 'Verdict: PASS, FAIL, or BLOCKED_ENV when results genuinely are not available.',
    gate: { type: 'halt', label: 'Halt on FAIL', text: 'A FAIL skips PR creation entirely.' },
    example: [{
      file: 'qa-report.md',
      content:
`## Verdict: PASS

E2E (Maestro): toggle switches theme, preference survives an app
restart, onboarding screens render correctly in dark mode.
The note Review flagged is now covered.`,
    }],
  },
  {
    code: '07', key: 'retro', label: 'Retro', short: 'Learn',
    role: 'Reads every artifact this feature produced and compiles what happened, including failed attempts and repair loops.',
    produces: 'retrospective.md + project-memory.md',
    producesDesc: 'A squad retro, plus merged learnings into four fixed cross-feature categories. Proposes a new skill file when a pattern has now repeated three or more times.',
    gate: {
      type: 'warn', label: 'Evidence check (advisory)',
      text: 'Each proposed skill is checked against the features actually cited for it. Fewer than three verifiable prints a warning for you, and never blocks.',
    },
    example: [{
      file: 'retrospective.md',
      content:
`## What went well
Dev Review caught the onboarding-stack ambiguity before Dev started.
It would have shipped inconsistent otherwise.

## Pattern seen a 3rd time
"system" theme resolution via the platform Appearance API, same
shape as notifications and locale. Skill proposal submitted.
(dark-mode-toggle)`,
    }],
  },
];

export const branch: Stage = {
  code: 'Periodic', key: 'memory-compact', label: 'Memory Compact', short: 'Prune',
  role: 'Runs on a schedule, not per feature: every ten shipped features by default.',
  produces: '.relay/project-memory.md (rewritten)',
  producesDesc: 'Deduplicates and drops stale entries so project memory stays four fixed categories, never one section per feature forever.',
  gate: { type: 'none', label: 'No gate', text: 'A housekeeping pass, not a feature-blocking stage.' },
  example: [{
    file: '.relay/project-memory.md',
    content:
`Before: 34 feature-specific entries under "Conventions confirmed",
including (dark-mode-toggle), (push-notifications), (locale-switch).

After: 9 deduplicated, generalized entries. The three above merge
into one: "Resolve platform-level preferences (theme, notifications,
locale) through the Appearance/OS API, never a manual override table."`,
  }],
};

/** What each glyph is showing, and every verdict this stage can actually
 *  return. Choosing one plays the real control flow out on the rail above. */
export const META: Record<GlyphKey, { caption: string; verdicts: Verdict[] }> = {
  hero: { caption: '', verdicts: [] },
  pm: {
    caption: 'the scope spreads, the feature takes shape',
    verdicts: [
      { v: 'brief written', type: 'go', label: 'Hand off to Dev Review', text: 'No gate on this stage. The brief goes straight to Dev Review, which reads it as if about to implement it.' },
    ],
  },
  'dev-review': {
    caption: 'the unclear layer comes out, and goes back resolved',
    verdicts: [
      { v: 'clear', type: 'go', label: 'Proceed to Architect', text: 'Ambiguities were resolved in the thread, up to three rounds. The run continues with a brief both roles agree on.' },
      { v: 'blocked', type: 'halt', label: 'Halt the run', text: 'The spec is genuinely unclear, not just missing minor detail. The run stops and waits for you rather than letting the agent guess and build the wrong thing.' },
    ],
  },
  architect: {
    caption: 'the pieces this feature needs, named one by one',
    verdicts: [
      { v: 'plan + diagram, approved', type: 'go', label: 'Proceed to Dev', text: "You read the plan and approved it. The approval binds to the plan's content, so any later edit forces a fresh review." },
      { v: 'awaiting your approval', type: 'pause', label: 'Paused for a human', text: 'The design gate holds the run here until you approve the plan, from the terminal or from the macOSc app. This is the one point where Relay is deliberately not autonomous.' },
      { v: 'no mermaid diagram', type: 'retry', label: 'One retry, then abort', text: 'The diagram gate is structural: a missing Mermaid block earns one automatic retry, and aborts if it is still missing.' },
    ],
  },
  dev: {
    caption: 'each planned piece gets built, one after another',
    verdicts: [
      { v: 'gates pass', type: 'go', label: 'Proceed to Review', text: 'Typecheck, lint, and the placeholder and secret scans all came back clean. The work is committed, stamped with the model that wrote it.' },
      { v: 'typecheck / lint fails', type: 'retry', label: 'One combined retry', text: 'Typecheck, lint, and the scan for placeholders or committed secrets feed one combined retry. Still failing afterwards halts the run.' },
    ],
  },
  review: {
    caption: 'each built piece scanned in turn, and marked',
    verdicts: [
      { v: 'PASS', type: 'go', label: 'Proceed to QA', text: 'Every acceptance criterion is covered and the code flows the way the Architect drew it.' },
      { v: 'PASS_WITH_NOTES', type: 'go', label: 'Proceed to QA', text: 'Non-blocking findings are written into the report and carried forward for QA to look at.' },
      { v: 'FAIL', type: 'retry', back: 'dev', label: 'Back to Dev, once', text: 'Findings feed back to Dev for exactly one retry. Still FAIL afterwards halts before QA and before any PR is opened.' },
    ],
  },
  qa: {
    caption: 'a real result lands on each built piece',
    verdicts: [
      { v: 'PASS', type: 'go', label: 'Open the PR', text: 'Real end-to-end results back the verdict. Only now does a pull request get created.' },
      { v: 'FAIL', type: 'halt', label: 'No PR is opened', text: 'A failing QA verdict skips PR creation entirely. The worktree is left intact for you to pick up.' },
      { v: 'BLOCKED_ENV', type: 'pause', label: 'Reported, never invented', text: 'There were no E2E results to read. QA says exactly that instead of manufacturing a pass, and the decision comes back to you.' },
    ],
  },
  retro: {
    caption: 'the shipped pieces turn to memory',
    verdicts: [
      { v: 'learnings merged', type: 'go', label: 'Feature complete', text: 'Durable learnings are folded into four fixed categories in project memory, which every role reads on the next feature.' },
      { v: 'thin evidence for a skill', type: 'retry', label: 'Warning only, never blocks', text: 'Each proposed skill is checked against the features actually cited for it. Fewer than three verifiable prints a warning for you, and the run still completes.' },
    ],
  },
  'memory-compact': {
    caption: 'the work is absorbed, and the feature turns to memory',
    verdicts: [
      { v: 'compacted', type: 'go', label: 'Housekeeping done', text: 'Runs every ten shipped features by default. Not a feature-blocking stage.' },
    ],
  },
};
