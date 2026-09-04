import { useEffect, useRef, useState } from 'react';
import { RoleGlyph } from '../lib/glyphs';
import { META, branch, stages, type Stage, type Verdict } from '../content/stages';

/** What the rail does about a verdict. The outcome is decided by the pipeline,
 *  not the panel, so the line above is where it has to show up. */
function railNote(stage: Stage, outcome: Verdict) {
  const idx = stages.indexOf(stage);
  if (idx < 0) return null;
  if (outcome.type === 'halt') {
    return (
      <>
        <b>Run stops here.</b> Nothing downstream executes, and no pull request is opened.
      </>
    );
  }
  if (outcome.type === 'pause') {
    return (
      <>
        <b>Run waits here</b> until you resume it. The rest of the line is untouched.
      </>
    );
  }
  if (outcome.type === 'retry') {
    const back = outcome.back ? stages.find((s) => s.key === outcome.back)! : stage;
    return (
      <>
        <b>Back to {back.label}</b> for one retry. If it fails again the run halts instead of merging.
      </>
    );
  }
  const next = stages[idx + 1];
  return next ? (
    <>
      <b>Hands off to {next.label}.</b> The artifact is committed and the next role reads it.
    </>
  ) : (
    <>
      <b>Feature complete.</b> The PR is open and project memory has been updated.
    </>
  );
}

function railNodeClass(i: number, current: number, onBranch: boolean, outcome: Verdict) {
  const idx = onBranch ? -1 : current;
  const cls = ['rail-node'];
  if (!onBranch && i === current) cls.push('active');
  if (!onBranch && i < current) cls.push('done');
  if (idx >= 0) {
    if ((outcome.type === 'halt' || outcome.type === 'pause' || outcome.type === 'retry') && i > idx) cls.push('dimmed');
    if (outcome.type === 'halt' && i === idx) cls.push('halt-here');
    if (outcome.type === 'retry') {
      const backIdx = outcome.back ? stages.findIndex((s) => s.key === outcome.back) : idx;
      if (i === backIdx) cls.push('retry-target');
    }
  }
  return cls.join(' ');
}

export function Walkthrough() {
  const [current, setCurrent] = useState(0);
  const [onBranch, setOnBranch] = useState(false);
  const [verdictIdx, setVerdictIdx] = useState(0);
  // Bumped to force a fresh mount of the detail glyph, which is how its
  // animation is replayed: a CSS animation cannot be restarted in place.
  const [replay, setReplay] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);

  const stage = onBranch ? branch : stages[current];
  const meta = META[stage.key];
  const outcome = meta.verdicts[Math.min(verdictIdx, meta.verdicts.length - 1)];

  function goTo(i: number) {
    setCurrent(Math.max(0, Math.min(stages.length - 1, i)));
    setOnBranch(false);
    setVerdictIdx(0);
    setReplay((r) => r + 1);
  }
  function goToBranch() {
    setOnBranch(true);
    setVerdictIdx(0);
    setReplay((r) => r + 1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const rect = railRef.current?.getBoundingClientRect();
      if (!rect || rect.top > window.innerHeight || rect.bottom < 0) return;
      if (e.key === 'ArrowRight') {
        if (current === stages.length - 1 && !onBranch) goToBranch();
        else goTo(onBranch ? 0 : current + 1);
      }
      if (e.key === 'ArrowLeft') {
        if (onBranch) goTo(stages.length - 1);
        else goTo(current - 1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [current, onBranch]);

  const stageNumber = onBranch ? stages.length + 1 : current + 1;
  const stageTotal = onBranch ? stages.length + 1 : stages.length;

  return (
    <section id="walkthrough">
      <div className="rail-head">
        <div className="section-head">
          <div className="kicker">
            <span className="idx">02</span>
            <span>How it works</span>
          </div>
          <h2>Step through a real run</h2>
          <p>
            One command, <code>/relay:new "Add dark mode toggle"</code>, moves that feature down eight stages, left to
            right, inside its own git worktree. Click a stage or use the arrow keys to see what each role reads,
            writes, and is gated on, with a real excerpt of the file it produced, followed through that same feature
            from brief to PR.
          </p>
        </div>
      </div>

      <div className="rail-wrap">
        <div className="rail-controls">
          <span className="label">
            Stage <span className="mono">{stageNumber} of {stageTotal}</span>
          </span>
          <div className="rail-buttons">
            <button
              aria-label="Previous stage"
              disabled={!onBranch && current === 0}
              onClick={() => (onBranch ? goTo(stages.length - 1) : goTo(current - 1))}
            >
              Prev
            </button>
            <button
              aria-label="Next stage"
              disabled={onBranch}
              onClick={() => (current === stages.length - 1 ? goToBranch() : goTo(current + 1))}
            >
              Next
            </button>
          </div>
        </div>

        <div className="rail" role="tablist" aria-label="Pipeline stages" ref={railRef}>
          {stages.map((s, i) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={!onBranch && i === current}
              className={railNodeClass(i, current, onBranch, outcome)}
              onClick={() => goTo(i)}
            >
              <div className="track" />
              <RoleGlyph glyphKey={s.key} width={64} />
              <span className="no mono">{s.code}</span>
              <span className="label">{s.label}</span>
            </button>
          ))}
        </div>

        <div className="rail-branch">
          <button className={onBranch ? 'active' : undefined} onClick={goToBranch}>
            <RoleGlyph glyphKey={branch.key} width={34} />
            <span>{branch.label} (every N features, not per feature)</span>
          </button>
        </div>

        <p className="rail-note">{railNote(stage, outcome)}</p>

        <div className="detail">
          <span className="stage-tag mono">Stage {stage.code}</span>
          <h3>
            {stage.label}, {stage.short}
          </h3>
          <div className="detail-grid">
            <div>
              <div
                className="glyph-stage"
                title="Replay"
                onClick={() => setReplay((r) => r + 1)}
              >
                <RoleGlyph key={`${stage.key}-${outcome.type}-${replay}`} glyphKey={stage.key} variant={outcome.type} animate />
                <span className="replay-hint">&#8635; replay</span>
              </div>
              <p className="glyph-caption">{meta.caption}</p>
              <div className="detail-block">
                <span className="field-label">Role</span>
                <p className="role-desc">{stage.role}</p>
              </div>
              <div className="detail-block">
                <span className="field-label">Produces</span>
                <code>{stage.produces}</code>
                <p className="produces-desc">{stage.producesDesc}</p>
              </div>
            </div>
            <div>
              <span className="field-label">Gate</span>
              <div className={`gate-line g-${stage.gate.type}`}>
                <span className="gdot" />
                <span className="glabel">{stage.gate.label}</span>
              </div>
              <p className="gate-text">{stage.gate.text}</p>
              <div className="gate-explorer">
                <span className="field-label">If this role returns&hellip;</span>
                <div className="verdict-row">
                  {meta.verdicts.map((v, i) => (
                    <button
                      key={v.v}
                      className={'verdict' + (i === verdictIdx ? ' on' : '')}
                      onClick={() => {
                        setVerdictIdx(i);
                        setReplay((r) => r + 1);
                      }}
                    >
                      {v.v}
                    </button>
                  ))}
                </div>
                <div className={`outcome-panel o-${outcome.type}`}>
                  <div className="oc-head">
                    <span className="oc-dot" />
                    <span className="oc-label">{outcome.label}</span>
                  </div>
                  <p className="oc-text">{outcome.text}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="example-block">
            <span className="field-label">Example output: the same running feature, stage by stage</span>
            <div className="example-files">
              {stage.example.map((f) => (
                <div className="file-preview" key={f.file}>
                  <div className="fp-head">
                    <span className="fp-dot" />
                    <span className="fp-name">{f.file}</span>
                  </div>
                  <pre>{f.content}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
