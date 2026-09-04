/** Real captures of the Relay app, taken at 2x. Dimensions are the file's own,
 *  so the frame can reserve its space before the image decodes. */
export interface Screen {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const base = import.meta.env.BASE_URL;

export const screens: Record<string, Screen> = {
  dashboardLight: {
    src: `${base}screens/dashboard-light.webp`,
    alt: 'The Relay app listing two repositories. Acme Web has a run that failed review and one waiting on design approval; Acme API has one blocked on questions and one running. Each repo shows its recently merged features underneath.',
    width: 1880,
    height: 1276,
  },
  designGate: {
    src: `${base}screens/run-design-gate.webp`,
    alt: 'A run opened at the design gate: the role timeline with cost per role against the feature budget, the technical plan rendered underneath with its file list, order of operations and Mermaid flow, and an Approve design button at the bottom.',
    width: 1880,
    height: 1610,
  },
};
