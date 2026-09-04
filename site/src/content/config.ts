export interface ConfigGroup {
  name: string;
  rows: [key: string, what: string, dflt: string][];
}

export const configGroups: ConfigGroup[] = [
  {
    name: 'Core',
    rows: [
      ['project.name', 'Project display name', 'My Project'],
      ['commands.packageManager', 'Package manager', 'npm'],
      ['commands.typecheck', 'Dev quality gate, one retry', 'tsc --noEmit'],
      ['commands.lint', 'Dev quality gate, one retry', 'eslint .'],
      ['commands.test', 'Opt-in, blank skips it entirely', '""'],
    ],
  },
  {
    name: 'Quality and cost',
    rows: [
      ['project.devFileBatchSize', 'Files per Dev call before batching kicks in', '6'],
      ['project.maxTokensPerFeature', 'Ceiling on tokens for one feature, 0 is unlimited', '0'],
      ['project.maxCostUsdPerFeature', 'Ceiling on dollars for one feature, 0 is unlimited', '0'],
      ['review.verifiers', 'Independent Review passes, an adversarial panel', '1'],
    ],
  },
  {
    name: 'Backend',
    rows: [
      ['llm.backend', 'openai-compatible or claude-cli', 'openai-compatible'],
      ['llm.baseUrl', 'Any OpenAI-compatible endpoint', 'OpenRouter'],
      ['llm.maxBudgetUsd', 'Per-call dollar cap, claude-cli only', 'unset'],
    ],
  },
];

export interface Backend {
  name: string;
  sub: string;
  points: string[];
}

export const backends: Backend[] = [
  {
    name: 'openai‑compatible',
    sub: 'the default',
    points: [
      'Needs an API key: <code>OPENROUTER_API_KEY</code>, or one you name yourself',
      'Talks to any OpenAI-compatible chat-completions endpoint',
      'Works with OpenRouter, OpenAI, Azure OpenAI, Groq, Together, Fireworks, or a local Ollama',
      'On OpenRouter, reads back the real dollar cost of every call to feed your per-feature ceiling',
    ],
  },
  {
    name: 'claude‑cli',
    sub: 'subscription only, no key',
    points: [
      'Needs only <code>claude setup-token</code>: a Claude subscription, no API key at all',
      'Drives the <code>claude</code> CLI you already have installed',
      '<code>llm.maxBudgetUsd</code> optionally caps spend per individual call',
      'Always reports the real dollar cost of every call, feeding your per-feature ceiling',
    ],
  },
];
