import type { ReactNode } from 'react';

export function Kicker({ idx, children }: { idx?: string; children: ReactNode }) {
  return (
    <div className="kicker">
      {idx ? <span className="idx">{idx}</span> : <span className="dot" />}
      <span>{children}</span>
    </div>
  );
}

export function SectionHead({
  idx,
  kicker,
  title,
  children,
}: {
  idx?: string;
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      <Kicker idx={idx}>{kicker}</Kicker>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
