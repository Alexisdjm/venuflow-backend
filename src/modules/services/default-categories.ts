export const DEFAULT_SERVICE_CATEGORIES = [
  'Uñas',
  'Cabello',
  'Cejas y pestañas',
  'Depilación',
  'Maquillaje',
] as const;

export function normalizeCategoryName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}
