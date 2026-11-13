/** Shared entry point for online-booking policy; no hostname authorization. */
export function includesPublicBooking(
  spa: { plan?: string | null } | null | undefined,
) {
  return spa?.plan === 'PLUS';
}

export function acceptsPublicBookings<
  T extends { status: string; plan?: string | null },
>(spa: T | null | undefined): spa is T {
  return spa?.status === 'ACTIVE' && includesPublicBooking(spa);
}

export function publicServiceEligibility(
  service: {
    isActive: boolean;
    durationType: string;
    durationMinutes: number | null;
    priceType: string;
  },
  hasActiveProfessional = true,
) {
  const reason = !service.isActive
    ? 'INACTIVE'
    : service.durationType !== 'FIXED'
      ? 'VARIABLE_DURATION'
      : !service.durationMinutes || service.durationMinutes <= 0
        ? 'INVALID_DURATION'
        : service.priceType !== 'FIXED'
          ? 'VARIABLE_PRICE'
          : !hasActiveProfessional
            ? 'NO_ACTIVE_PROFESSIONAL'
            : null;
  const messages = {
    INACTIVE: 'Servicio desactivado.',
    VARIABLE_DURATION: 'La duración requiere evaluación en el spa.',
    INVALID_DURATION: 'El servicio no tiene una duración válida.',
    VARIABLE_PRICE: 'El precio requiere evaluación en el spa.',
    NO_ACTIVE_PROFESSIONAL:
      'No hay profesionales habilitados para este servicio.',
  };
  return {
    onlineBookable: reason === null,
    unavailableReason: reason,
    unavailableMessage: reason ? messages[reason] : null,
  };
}
