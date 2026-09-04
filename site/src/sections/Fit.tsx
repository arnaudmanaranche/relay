import { SectionHead } from '../components/Section';

const yes = [
  'You ship solo, or with one or two others, and the only reviewer available is you',
  'You use a coding agent daily and have already merged something you did not fully read',
  'Your project has real users, so a silent regression costs you more than the feature was worth',
  'You would rather review a plan for two minutes than a 900-line diff for an hour',
  'You keep re-explaining the same conventions to the same agent every session',
];

const no = [
  'You want one-shot "build my app" autonomy. Relay deliberately stops and waits for you at the design gate',
  'You are prototyping something you will throw away this week; the process costs more than the code is worth',
  'You already have teammates doing PR review and QA. You have this process, in humans',
  'Your work is mostly one-line fixes and dependency bumps',
  'You need it fully unattended end to end; a human approval is structural, not a setting',
  'You need something settled. This is still an experiment, and releases still move things',
];

export function Fit() {
  return (
    <section id="fit">
      <div className="section-inner wide">
        <SectionHead idx="06" kicker="Opinionated on purpose" title="Is Relay for you?">
          Relay trades speed for defensibility. Every gate costs you time and tokens on the way to a feature you can
          actually stand behind. That trade is worth it for some projects and plainly wrong for others.
        </SectionHead>
        <div className="fit">
          <div className="col yes">
            <h4>
              <span className="mark">[+]</span> Built for you if
            </h4>
            <ul>
              {yes.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="col no">
            <h4>
              <span className="mark">[&minus;]</span> Not for you if
            </h4>
            <ul>
              {no.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
