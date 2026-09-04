import { LogoMark } from '../lib/iso';

export interface NavGroup {
  label: string;
  links: { href: string; label: string }[];
}

export const navGroups: NavGroup[] = [
  {
    label: 'Start here',
    links: [
      { href: '#overview', label: 'Overview' },
      { href: '#problem', label: 'The problem' },
      { href: '#walkthrough', label: 'How it works' },
      { href: '#app', label: 'macOS app' },
    ],
  },
  {
    label: 'Why trust it',
    links: [
      { href: '#guarantees', label: "What's enforced" },
      { href: '#landscape', label: 'Where Relay fits' },
      { href: '#fit', label: 'Is it for you?' },
    ],
  },
  {
    label: 'Reference',
    links: [
      { href: '#config', label: 'Configuration' },
      { href: '#faq', label: 'FAQ' },
    ],
  },
];

export function MobileBar() {
  return (
    <div className="mobilebar">
      <span className="logo">
        <LogoMark u={8} />
      </span>
      <span>Relay</span>
    </div>
  );
}

export function SideNav({ active }: { active: string }) {
  return (
    <aside className="sidenav">
      <div className="brand">
        <span className="logo">
          <LogoMark u={9} />
        </span>
        <span className="name">Relay</span>
      </div>
      <nav>
        {navGroups.map((g) => (
          <div className="navgroup" key={g.label}>
            <span className="navgroup-label">{g.label}</span>
            {g.links.map((l) => (
              <a
                key={l.href}
                className={'navlink' + (active === l.href.slice(1) ? ' active' : '')}
                href={l.href}
              >
                <span className="ring" />
                {l.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
