import { SPA_CURRENCIES } from '../spas/dto/spa.dto';

export const TRIAL_PLACES = [
  { code: 'VE', label: 'Venezuela', timezone: 'America/Caracas', currency: 'USD' },
  { code: 'CO', label: 'Colombia', timezone: 'America/Bogota', currency: 'COP' },
  { code: 'PE', label: 'Perú', timezone: 'America/Lima', currency: 'PEN' },
  { code: 'PA', label: 'Panamá', timezone: 'America/Panama', currency: 'USD' },
  { code: 'MX', label: 'México', timezone: 'America/Mexico_City', currency: 'MXN' },
  { code: 'US-EAST', label: 'Estados Unidos (este)', timezone: 'America/New_York', currency: 'USD' },
  { code: 'US-CENTRAL', label: 'Estados Unidos (centro)', timezone: 'America/Chicago', currency: 'USD' },
  { code: 'BR', label: 'Brasil', timezone: 'America/Sao_Paulo', currency: 'BRL' },
  { code: 'AR', label: 'Argentina', timezone: 'America/Argentina/Buenos_Aires', currency: 'ARS' },
  { code: 'CL', label: 'Chile', timezone: 'America/Santiago', currency: 'CLP' },
  { code: 'ES', label: 'España', timezone: 'Europe/Madrid', currency: 'EUR' },
] as const;

export type TrialPlaceCode = (typeof TRIAL_PLACES)[number]['code'];
export type TrialCurrency = (typeof SPA_CURRENCIES)[number];

export function trialPlace(code: string) {
  return TRIAL_PLACES.find((place) => place.code === code) ?? null;
}
