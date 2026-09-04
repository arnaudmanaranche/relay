/** Project status, stated before anything else on the page. It is a notice
 *  rather than a warning: quiet ink on a faint accent wash, one line deep on a
 *  wide screen, and it scrolls away instead of following the reader down. The
 *  long version lives in the FAQ, which the link opens. */
export function Banner() {
  return (
    <div className="banner">
      <div className="banner-inner">
        <span className="banner-tag">Work in progress</span>
        <p>
          Relay is an experiment, published while it is still one. It ships real features on my own projects every
          week, and it still changes shape between releases. Try it, argue with it, fork it; do not standardise a team
          on it yet.
        </p>
      </div>
    </div>
  );
}
