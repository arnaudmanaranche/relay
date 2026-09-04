import { SectionHead } from '../components/Section';
import { categories } from '../content/landscape';

export function Landscape() {
  return (
    <section id="landscape">
      <div className="section-inner wide">
        <SectionHead idx="05" kicker="The layer nobody is selling you" title="Where Relay fits">
          There is no shortage of ways to get an agent writing code. Almost all of them optimise the same thing:
          getting from your prompt to a diff faster. Relay is not another one of those. It is the process wrapped
          around whichever one you already picked.
        </SectionHead>
        <div className="cat-list">
          {categories.map((c) => (
            <div className={'cat-row' + (c.self ? ' self' : '')} key={c.name}>
              <div className="cat-name">
                {c.name}
                <span>{c.sub}</span>
              </div>
              <div>
                <div className="chips">
                  {c.tools.map((t) => (
                    <span className="chip" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
                <p dangerouslySetInnerHTML={{ __html: c.text }} />
              </div>
            </div>
          ))}
        </div>
        <p className="arrow-note">
          Named tools are examples of each category, not competitors Relay replaces. It runs on top of them. Relay
          drives your agent through the pipeline; the agent still writes every line of code.
        </p>
        <p className="arrow-note">
          A great deal is being shipped in this space right now, a lot of it written by the same agents it points at,
          and most of it hard to tell apart from the outside. One question separates them: <b>what does it refuse to
          let the model decide?</b> Relay&rsquo;s whole answer is on this page. Seven roles it cannot skip, one
          approval it cannot give itself, and a handful of checks it cannot talk its way past. If a tool has no answer
          to that question, it is selling you speed, which is a different thing and often the right one.
        </p>
      </div>
    </section>
  );
}
