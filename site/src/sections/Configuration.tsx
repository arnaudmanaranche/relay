import { SectionHead } from '../components/Section';
import { backends, configGroups } from '../content/config';

export function Configuration() {
  return (
    <section id="config">
      <div className="section-inner wide">
        <SectionHead idx="07" kicker=".relay/config.json" title="Configuration">
          Generated once by <code>/relay:setup</code>, which detects your stack. Everything below is a plain JSON key
          you can edit afterwards.
        </SectionHead>

        <div className="config-groups">
          {configGroups.map((g) => (
            <div className="config-group" key={g.name}>
              <h4>{g.name}</h4>
              <div className="cfg-wrap">
                <table className="cfg">
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r[0]}>
                        <td>{r[0]}</td>
                        <td>{r[1]}</td>
                        <td>{r[2]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <h3 className="sub-head">Choosing a backend</h3>
        <p className="sub-lede">
          Every role calls whichever backend <code>llm.backend</code> points at. Same checks, same retries, same
          guardrails either way. Bring an API key, or just a Claude subscription.
        </p>
        <div className="compare">
          {backends.map((b) => (
            <div className="col" key={b.name}>
              <h4>{b.name}</h4>
              <span className="sub">{b.sub}</span>
              <ul className="tick-list">
                {b.points.map((p) => (
                  <li key={p} dangerouslySetInnerHTML={{ __html: p }} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
