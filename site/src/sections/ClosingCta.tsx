import { CopyButton } from '../components/CopyButton';

const INSTALL = '/plugin marketplace add arnaudmanaranche/relay';

export function ClosingCta() {
  return (
    <section className="cta">
      <div className="cta-inner">
        <h2>Ship the next one through it.</h2>
        <p>
          One command starts a feature. Two minutes of your attention approves its plan. Everything else happens
          without you: the brief, the review against that plan, the QA verdict, the pull request. And it leaves a
          paper trail either way.
        </p>
        <div className="install">
          <code>
            <span className="prompt">$ </span>
            {INSTALL}
          </code>
          <CopyButton text={INSTALL} />
        </div>
        <div className="hero-actions">
          <a className="btn primary" href="https://github.com/arnaudmanaranche/relay#install">
            Install it <span className="arrow">&#8594;</span>
          </a>
          <a className="btn" href="https://github.com/arnaudmanaranche/relay/blob/main/skills/setup/SKILL.md">
            Setup guide
          </a>
          <a className="btn" href="https://github.com/arnaudmanaranche/relay">
            Read the source
          </a>
        </div>
      </div>
    </section>
  );
}
