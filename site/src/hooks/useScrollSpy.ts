import { useEffect, useState } from 'react';

/** Highlights the sidenav link for whichever section owns the reading band.
 *  The band is deliberately narrow (20% to 30% down the viewport) so the active
 *  link changes once per section rather than flickering at every boundary. */
export function useScrollSpy(initial: string) {
  const [active, setActive] = useState(initial);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    document.querySelectorAll('section[id]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  return active;
}
