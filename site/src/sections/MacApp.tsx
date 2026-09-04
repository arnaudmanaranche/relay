import { SectionHead } from '../components/Section';
import { Screenshot } from '../components/Screenshot';
import { screens } from '../content/screens';

export function MacApp() {
  return (
    <section id="app">
      <div className="section-inner wide">
        <SectionHead idx="03" kicker="Relay for Mac" title="The run that is waiting on you comes and finds you">
          Relay stops exactly once per feature: at the design gate, with a plan it wants you to read. A pipeline that
          pauses in a terminal you closed two hours ago has not stopped for you. It has just stopped. So Relay ships a
          small Mac app that watches every repo you point it at, and puts that moment where you will see it.
        </SectionHead>

        <Screenshot shot={screens.dashboardLight} eager>
          Every Relay repo in one list, each run under the project that owns it, sorted{' '}
          <b>failed → waiting → running</b>. The three numbers along the top are the only summary you need: what is
          moving, what needs you, what shipped.
        </Screenshot>

        <dl className="app-facts">
          <div className="app-fact">
            <dt>Watches</dt>
            <dd>Every repo you list, polled every 5 seconds.</dd>
          </div>
          <div className="app-fact">
            <dt>Shows</dt>
            <dd>Why a run stopped, what it has cost so far, and the command that resumes it.</dd>
          </div>
          <div className="app-fact">
            <dt>Opens</dt>
            <dd>The worktree in Finder, the branch in your editor, the artifacts folder.</dd>
          </div>
          <div className="app-fact">
            <dt>Needs</dt>
            <dd>Nothing running. It reads the files the pipeline already writes.</dd>
          </div>
        </dl>

        <div className="app-beats">
          <div className="app-beat">
            <div className="beat-copy">
              <h4>Read the plan, approve it, done</h4>
              <p>
                Open the run waiting at the design gate and the plan is right there, rendered: the files it intends to
                touch, the order it will touch them in, the flow diagram, and what it already knows it cannot test.
                Approve, and the pipeline picks up where it left off.
              </p>
              <p>
                Above the plan, what the feature has cost so far and which role produced what. If a run is worth
                stopping, you can see that before you have spent anything more on it.
              </p>
              <div className="beat-meta">
                <span>design gate · the one deliberate pause</span>
                <span>approve, retry, or stop, from here</span>
              </div>
            </div>
            <Screenshot shot={screens.designGate}>
              The design gate for <b>checkout-express</b>: four roles done for $1.42 of a $6.00 budget, the plan
              underneath, and the button that lets the rest of the run happen.
            </Screenshot>
          </div>
        </div>

        <p className="arrow-note">
          The app is optional: the pipeline runs from your terminal and never needs it. It is macOS-only, and it lives
          in <code>relay-dashboard/</code> in the repo.
        </p>
      </div>
    </section>
  );
}
