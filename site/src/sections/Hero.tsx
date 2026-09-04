import { CopyButton } from '../components/CopyButton';
import { RoleGlyph } from '../lib/glyphs';
import { IsoCube } from '../lib/iso';

const INSTALL = '/plugin marketplace add arnaudmanaranche/relay';

/** Colour is state, everywhere on the page. */
const STATES: [string, string][] = [
  ['plain', 'scoped'],
  ['charcoal', 'being built'],
  ['sage', 'passed'],
  ['accent', 'waiting on you'],
  ['halt', 'failed'],
  ['slate', 'remembered'],
];

export function Hero() {
  return (
    <section id="overview">
      <div className="hero">
        <div className="kicker">
          <span className="dot" />
          <span>Relay &middot; open source, MIT</span>
        </div>
        <h1>A gated pipeline for the features your agent writes.</h1>
        <p className="lede">
          Seven roles (brief, clarify, plan, build, review, verify, learn), each one producing a real document you can
          read, and none of them able to move the feature forward until a check says it may.{' '}
          <strong>Built for solo builders who ship with an agent and have no team to catch what it got wrong.</strong>
        </p>
        <div className="install">
          <code>
            <span className="prompt">$ </span>
            {INSTALL}
          </code>
          <CopyButton text={INSTALL} />
        </div>
        <p className="install-note">
          In Claude Code. Using Codex, OpenCode, or Cline instead?{' '}
          <a href="https://github.com/arnaudmanaranche/relay#install">Same pipeline, plain Markdown skills.</a>
        </p>
        <div className="hero-actions">
          <a className="btn primary" href="#walkthrough">
            See how it works <span className="arrow">&#8594;</span>
          </a>
          <a className="btn" href="https://github.com/arnaudmanaranche/relay">
            GitHub
          </a>
        </div>
        <div className="hero-scene">
          <div className="hero-art">
            <RoleGlyph glyphKey="hero" width={300} animate />
          </div>
          <div className="cube-legend">
            {STATES.map(([key, label]) => (
              <span className="item" key={key}>
                <IsoCube colorKey={key} u={7} />
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="badge-row">
          <span className="badge">
            <b>7</b> gated roles
          </span>
          <span className="badge">one approval, in the middle</span>
          <span className="badge">model-agnostic</span>
          <span className="badge">stack-agnostic</span>
          <span className="badge">runs in a git worktree</span>
        </div>
      </div>
    </section>
  );
}
