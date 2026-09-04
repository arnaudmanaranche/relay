export interface Category {
  self?: boolean;
  name: string;
  sub: string;
  tools: string[];
  /** May contain inline <em>, rendered as HTML. */
  text: string;
}

export const categories: Category[] = [
  {
    name: 'Coding agents & CLIs',
    sub: 'the layer Relay drives',
    tools: ['Claude Code', 'Cursor', 'Codex CLI', 'Cline', 'Aider', 'OpenHands', 'Goose', 'Amp'],
    text: 'Make an agent good at reading your repo and writing code in it. Relay does not replace this layer; it is the layer Relay points at. Whichever one you already use still writes every line.',
  },
  {
    name: 'Autonomous SWE agents',
    sub: 'issue in, PR out',
    tools: ['Devin', 'Factory', 'Sweep'],
    text: 'Take a ticket and hand back a pull request with minimal supervision. Excellent when you already trust the output. Trusting the output is the specific problem Relay exists to solve.',
  },
  {
    name: 'Spec-driven toolkits',
    sub: 'write the spec first',
    tools: ['GitHub Spec Kit', 'AWS Kiro', 'OpenSpec'],
    text: 'Front-load a written spec so the agent starts from something better than a one-line prompt. Relay agrees with the premise, then keeps gating <em>after</em> the spec: through an approved plan, a review against it, and a QA verdict.',
  },
  {
    name: 'Agent frameworks & SDKs',
    sub: 'build your own agent system',
    tools: ['Mastra', 'LangGraph', 'CrewAI', 'AutoGen', 'MetaGPT', 'BMad-Method'],
    text: 'Libraries you build <em>with</em>: agents, tools, workflow graphs, memory, evals, a way to deploy the result. Relay is not one of these and you do not build on it. It is one pipeline, seven roles already chosen, pointed at the coding agent you already run. And where a framework hands you a role as a persona the model plays, here a role is a checkpoint: what it may write, what it must return, and what happens next are all decided outside the model.',
  },
  {
    name: 'AI code review',
    sub: 'after the diff exists',
    tools: ['CodeRabbit', 'Greptile', 'Ellipsis'],
    text: 'Review the diff once it is already a pull request. Relay reviews it against a plan you approved before the code existed, and can halt the run before a PR is ever opened.',
  },
  {
    self: true,
    name: 'Relay',
    sub: 'the process, not the agent',
    tools: ['runs on Claude Code', 'Codex', 'OpenCode', 'Cline'],
    text: 'A fixed seven-role pipeline wrapped around the agent you already picked, with a human approval gate in the middle and a real check at every handoff. Model-agnostic and stack-agnostic by design: a Claude Code plugin, or plain Markdown skills for Codex, OpenCode, and Cline.',
  },
];
