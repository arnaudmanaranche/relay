import { SectionHead } from '../components/Section';
import { Screenshot } from '../components/Screenshot';
import { screens } from '../content/screens';

export function Studio() {
  return (
    <section id="studio">
      <div className="section-inner wide">
        <SectionHead idx="03" kicker="Relay Studio" title="The part of the pipeline you are supposed to touch">
          Most of Relay is deliberately out of reach: what a role may write, what it must return, whether the run
          continues. Three things are yours, and they are the three that decide what you get. What each role is told.
          What standards it has to hold to. And the one plan you have to approve. <code>/relay:studio</code> opens all
          three in one place, pointed at the project you ran it from.
        </SectionHead>

        <Screenshot shot={screens.pipeline} eager>
          Every Relay repo in one list, each run under the project that owns it, sorted{' '}
          <b>failed → waiting → running</b>. The three numbers along the top are the only summary you need: what is
          moving, what needs you, what shipped.
        </Screenshot>

        <dl className="app-facts">
          <div className="app-fact">
            <dt>Runs</dt>
            <dd>Anywhere. It is a local web app, not a Mac app, and it reads the project you launch it from.</dd>
          </div>
          <div className="app-fact">
            <dt>Watches</dt>
            <dd>Every repo you list, polled every 5 seconds.</dd>
          </div>
          <div className="app-fact">
            <dt>Writes</dt>
            <dd>Role prompts, project skills, and the role entries in <code>.relay/agents.json</code>.</dd>
          </div>
          <div className="app-fact">
            <dt>Needs</dt>
            <dd>Nothing running. It reads the files the pipeline already writes.</dd>
          </div>
        </dl>

        <div className="studio-beats">
          <div className="studio-beat">
            <div className="beat-copy">
              <h4>Read the plan, approve it, done</h4>
              <p>
                The design gate is the one place Relay stops and waits. Open the run and the plan is right there,
                rendered: the files it intends to touch, the order it will touch them in, the flow diagram, and what
                it already knows it cannot test. Approve, and the pipeline picks up where it left off.
              </p>
              <p>
                Above the plan, what each role cost and what the feature has spent against its ceiling. If a run is
                worth stopping, you can see that before you spend anything more on it.
              </p>
              <div className="beat-meta">
                <span>design gate · the one deliberate pause</span>
                <span>approve, answer, retry, or stop, from here</span>
              </div>
            </div>

            <Screenshot shot={screens.designGate}>
              The design gate for <b>checkout-express</b>: four roles done for $1.42 of a $6.00 budget, the plan
              underneath, and the button that lets the rest of the run happen.
            </Screenshot>
          </div>

          <div className="studio-beat">
            <div className="beat-copy">
              <h4>Change what a role is told</h4>
              <p>
                A role is a prompt, a model, a token ceiling, and an effort level. All four are editable here, and the
                next run picks the change up with no further step. Attach a standard to a role and it is injected into
                every call that role makes: not only Dev, so Review can be held to the same conventions it is meant to
                be checking.
              </p>
              <p>
                Every value is checked against the rules the pipeline itself validates the registry with, so a save
                Studio accepts cannot be the reason the next run refuses to start.
              </p>
              <div className="beat-meta">
                <span>writes .relay/agents.json</span>
                <span>drag a skill onto a role to attach it</span>
              </div>
            </div>

            <Screenshot shot={screens.roles}>
              The <b>dev</b> role: its prompt with a live preview, the <code>code-style</code> skill attached, a{' '}
              <code>*.tsx</code> pattern mapped to the project&rsquo;s UI standards, and the model it runs on.
            </Screenshot>
          </div>

          <div className="studio-beat">
            <div className="beat-copy">
              <h4>Write the standards down once</h4>
              <p>
                A skill is a markdown file the agent reads on every relevant call. Relay ships a couple as templates,
                read-only: copy one into the project and it becomes yours to rewrite, because the point is your
                conventions, not a starter set of opinions.
              </p>
              <p>
                You can also pull one from any public repo that follows the plugin-manifest convention. There is no
                registry and no service behind this; it reads that repo&rsquo;s own manifest.
              </p>
              <div className="beat-meta">
                <span>project skills live in .relay/skills/</span>
                <span>templates are copied, never referenced in place</span>
              </div>
            </div>

            <Screenshot shot={screens.skills}>
              A project skill open for editing, with the library beside it: what this project has, and what Relay
              ships as a starting point.
            </Screenshot>
          </div>
        </div>

        <p className="arrow-note">
          Studio is optional: the pipeline runs from your terminal and never needs it. It is a dev-only tool, it has no
          build and no deploy, and it edits files in the project you point it at. There is also a native macOS app in
          the repo, now superseded by this.
        </p>
      </div>
    </section>
  );
}
