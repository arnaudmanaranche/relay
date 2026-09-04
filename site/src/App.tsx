import { Banner } from './components/Banner';
import { MobileBar, SideNav } from './components/Nav';
import { useScrollSpy } from './hooks/useScrollSpy';
import { ClosingCta } from './sections/ClosingCta';
import { Configuration } from './sections/Configuration';
import { Faq } from './sections/Faq';
import { Fit } from './sections/Fit';
import { Guarantees } from './sections/Guarantees';
import { Hero } from './sections/Hero';
import { Landscape } from './sections/Landscape';
import { MacApp } from './sections/MacApp';
import { Problem } from './sections/Problem';
import { Walkthrough } from './sections/Walkthrough';

export function App() {
  const active = useScrollSpy('overview');
  return (
    <>
      <Banner />
      <MobileBar />
      <div className="shell">
        <SideNav active={active} />
        <div className="content">
          <Hero />
          <Problem />
          <Walkthrough />
          <MacApp />
          <Guarantees />
          <Landscape />
          <Fit />
          <Configuration />
          <Faq />
          <ClosingCta />
          <div className="footer">
            <div className="foot-row">
              <span>Relay, MIT licensed.</span>
              <a href="https://github.com/arnaudmanaranche/relay">github.com/arnaudmanaranche/relay</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
