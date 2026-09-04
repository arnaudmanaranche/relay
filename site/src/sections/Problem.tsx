import { SectionHead } from '../components/Section';

const rules: { strong: string; rest: string }[] = [
  {
    strong: 'Requirements exist in writing before code does.',
    rest: ' PM reads your issue and the repo, then writes acceptance criteria, scope, i18n keys, and analytics events down, so "done" is defined before the agent starts guessing at it.',
  },
  {
    strong: 'You approve the plan, not the diff.',
    rest: ' Architect produces a file-by-file plan and a required diagram, and the run pauses there for you. Reading a plan takes two minutes; reading 900 lines of generated code takes an hour you will not spend.',
  },
  {
    strong: 'The review checks the code against that plan.',
    rest: ' Not vibes, not a second opinion from the same model in the same context. A separate pass, with the brief’s acceptance criteria and the Architect’s own diagram in hand.',
  },
  {
    strong: 'QA reads real results, or admits it cannot.',
    rest: ' Whatever E2E framework your project already runs, QA reads its output and says the environment blocked it rather than inventing a pass when there is nothing to read.',
  },
  {
    strong: 'The next feature remembers this one.',
    rest: ' Retro writes what happened, failed attempts included, into project memory that every role reads from then on. Your conventions stop evaporating between sessions.',
  },
];

export function Problem() {
  return (
    <section id="problem">
      <div className="section-inner">
        <SectionHead idx="01" kicker="You are the whole team" title="Nobody is reviewing your agent's code">
          On a team, five people touch a feature before it merges: someone writes down what it should do, someone plans
          it, someone builds it, someone reviews the diff against that plan, someone verifies it actually works.
          Building solo with an agent, all five collapse into one prompt and one diff you skim at midnight. Relay puts
          the five back, without hiring anyone.
        </SectionHead>
        <div className="rule-list">
          {rules.map((r, i) => (
            <div className="rule" key={r.strong}>
              <span className="num mono">{String(i + 1).padStart(2, '0')}</span>
              <p>
                <strong>{r.strong}</strong>
                {r.rest}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
