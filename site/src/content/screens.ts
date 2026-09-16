/** Real captures of Relay Studio, taken at 2x against a throwaway fixture
 *  rather than live repos. Dimensions are the file's own, so the frame
 *  reserves its space before the image decodes. */
export interface Screen {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const base = import.meta.env.BASE_URL;

export const screens: Record<string, Screen> = {
  roles: {
    src: `${base}screens/studio-roles.webp`,
    alt: "Studio's Roles tab: the nine pipeline roles down the left, the Dev role's prompt open with a live markdown preview beside it, then the skills attached to that role, its per-file-type patterns, and its model, token ceiling and effort.",
    width: 1880,
    height: 1737,
  },
  skills: {
    src: `${base}screens/studio-skills.webp`,
    alt: "Studio's Skills tab: a project skill open for editing, with the library beside it listing project skills and the read-only templates Relay ships, and a form to import one from a public GitHub repo.",
    width: 1880,
    height: 967,
  },
  pipeline: {
    src: `${base}screens/studio-pipeline.webp`,
    alt: 'Studio\'s Pipeline tab: counts of running, needing attention and merged, then each repository with its runs (one failed review, one waiting at the design gate, one blocked on questions, one running), and its recently merged features.',
    width: 1880,
    height: 888,
  },
  designGate: {
    src: `${base}screens/studio-design-gate.webp`,
    alt: 'A run opened at the design gate: the role timeline with the verdict, model and cost of each role against the feature total, the technical plan rendered underneath, and an Approve button.',
    width: 1880,
    height: 1306,
  },
};
