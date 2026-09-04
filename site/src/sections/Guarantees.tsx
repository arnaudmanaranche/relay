import { SectionHead } from '../components/Section';
import { guarantees } from '../content/guarantees';
import { IsoCube } from '../lib/iso';

export function Guarantees() {
  return (
    <section id="guarantees">
      <div className="section-inner wide">
        <SectionHead idx="04" kicker="What is actually enforced" title="Guardrails you don't have to trust the model about">
          A prompt that says &ldquo;don&rsquo;t touch files outside the feature&rdquo; is a suggestion. Each of these is
          a check the run has to pass, and none of them waits on the model to cooperate.
        </SectionHead>
        <div className="grid-cards">
          {guarantees.map((g) => (
            <div className="card" key={g.title}>
              <div className="cube">
                <IsoCube colorKey={g.cube} u={9} />
              </div>
              <h4>{g.title}</h4>
              <p>{g.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
