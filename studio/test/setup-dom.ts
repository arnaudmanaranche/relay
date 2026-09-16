// node:test has no DOM, so one is installed globally before any component is
// imported. Imported for side effects by every *.dom.test.tsx file; call
// `closeDom()` from an `after()` hook, or jsdom's timers and the window keep
// the test process alive until the runner kills it.
import globalJsdom from 'global-jsdom';

const cleanup = globalJsdom(undefined, { url: 'http://localhost/' });

// @testing-library/react reads this to pick the non-concurrent act() path and
// to stop warning about updates outside act.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function closeDom(): void {
  cleanup();
}
