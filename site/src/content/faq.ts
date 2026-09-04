export interface FaqItem {
  q: string;
  /** May contain inline <code> and <a>, rendered as HTML. */
  a: string;
}

export const faq: FaqItem[] = [
  {
    q: "Doesn't seven roles cost seven times as much?",
    a: 'More than one call, yes, but not seven times the price of the code itself. Only Dev writes source; the other roles read artifacts and produce short documents, and you can route the cheap roles to a cheap model and keep the expensive one where it earns its keep. Two ceilings, one on tokens and one on dollars, track what a feature has actually cost and refuse further calls once you go over. On the <code>claude-cli</code> backend it runs against a Claude subscription with no API key at all.',
  },
  {
    q: "Isn't this just slower than prompting the agent directly?",
    a: 'Per feature, yes. That is the trade the whole project is built on: you spend more wall-clock before the merge to spend less after it. If the feature you are building is throwaway, prompt the agent directly. Relay is for the work where a silent regression costs you a user.',
  },
  {
    q: 'Do I have to babysit it?',
    a: 'Once, in the middle. The Architect stage pauses for you to read the plan and approve it, and the approval binds to the plan you actually read, so an edited plan needs a fresh one. Everything else runs unattended until it either opens a PR or halts on a failed gate. The <a href="#app">macOS app</a> exists precisely so you do not have to sit and watch for that moment: it shows the plan, and you approve it there.',
  },
  {
    q: 'What if Review or QA is wrong?',
    a: 'They are models, so sometimes they will be. That is why the gates are structural rather than advisory: a <code>FAIL</code> feeds findings back to Dev for one retry and then halts the run instead of quietly merging, and QA reports <code>BLOCKED_ENV</code> rather than inventing a pass when no E2E results exist. You get artifacts explaining every verdict, and a halted run leaves the worktree intact for you to take over by hand.',
  },
  {
    q: 'Does it work with my stack?',
    a: 'Setup detects your stack and writes the commands it found into <code>.relay/config.json</code>. Typecheck, lint, and optionally test are just shell commands you can edit. QA is framework-agnostic: it reads whatever E2E results your CI already produces, Maestro or Playwright or Cypress. There is no language-specific logic in the pipeline itself.',
  },
  {
    q: 'Is my code sent anywhere new?',
    a: 'Only to the model provider you configure, the same one your coding agent already talks to. Relay adds no service of its own: it runs locally, against your repo, in a git worktree, and every commit is stamped with the model that produced it.',
  },
  {
    q: 'How is this different from Mastra, LangGraph, CrewAI, or any other agent framework?',
    a: 'Those are things you build with: agents, tools, workflow graphs, memory, evals, a way to ship the result. They are general on purpose, and what your system ends up guaranteeing is whatever you wire into it. Relay is not a framework and there is nothing to build: it is one fixed pipeline of seven roles, pointed at the coding agent you already run on your own repo. Where a framework hands you a role as a persona the model plays, and the same model usually decides when it is done, here a role is a boundary it cannot reach past: what it may write is granted per role, what it must return has a fixed shape, and whether the run retries, halts, or hands off is decided from the checks rather than from the answer. If you are building an AI product, you want a framework. If you are trying to trust a diff your agent just wrote, you want gates.',
  },
  {
    q: 'How finished is this?',
    a: 'Not very, and it is published that way on purpose. The pipeline runs end to end and ships real features on real projects every week, but it is one person&rsquo;s working tool rather than a product: there is no stability promise, roles and gates still change shape, and a release can move something you were relying on. That is also the honest reason to look at it now, while the parts are still visible and worth arguing about. Issues and forks welcome; a team standardising on it should wait.',
  },
  {
    q: 'Do I need the macOS app?',
    a: 'No. Everything runs from your terminal, and the app is read-only about state it does not own. It is there for the moment a run stops and waits for you: instead of remembering to check, you see it, read the plan, and approve. It watches every Relay repo you point it at, not just the one you have open.',
  },
];
