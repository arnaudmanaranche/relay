import { SectionHead } from '../components/Section';
import { faq } from '../content/faq';

export function Faq() {
  return (
    <section id="faq">
      <div className="section-inner">
        <SectionHead idx="08" kicker="Still deciding" title="Questions you should be asking" />
        <div className="faq">
          {faq.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <div className="answer" dangerouslySetInnerHTML={{ __html: f.a }} />
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
