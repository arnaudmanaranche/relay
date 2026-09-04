import type { ReactNode } from 'react';
import type { Screen } from '../content/screens';

/** Real captures of the app, at 2x. Width and height come from the manifest so
 *  the frame reserves its space before the image decodes. */
export function Screenshot({ shot, eager, children }: { shot: Screen; eager?: boolean; children?: ReactNode }) {
  return (
    <figure className="shot">
      <div className="frame">
        <img
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      </div>
      {children ? <figcaption>{children}</figcaption> : null}
    </figure>
  );
}
