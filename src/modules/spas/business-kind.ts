export const SPA_KINDS = ['SPA', 'BARBER', 'NAILS', 'HAIR', 'LASHES', 'SOLO', 'PHYSIO'] as const;
export type SpaKindName = (typeof SPA_KINDS)[number];
export const IMPLICIT_CATEGORY_NAME = 'General';

export function businessCapabilities(kind: string | null | undefined) {
  const full = !kind || kind === 'SPA';
  return { visitBundle: full, serviceCategories: full };
}
