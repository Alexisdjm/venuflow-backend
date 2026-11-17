import { ConflictException } from '@nestjs/common';
import { TrialService } from './trial.service';

const dto = {
  spaName: 'Emi Nails',
  slug: 'emi-nails-prueba',
  country: 'VE' as const,
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@gmail.com',
  password: '123456789012',
  phone: '04141234567',
  ownerProvidesService: true,
  services: [{ name: 'Manicure', category: 'Uñas' as const, durationMinutes: 60, price: 20 }],
};

function service(overrides: {
  user?: { id: string } | null;
  phone?: { id: string } | null;
  day?: number;
  week?: number;
}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(overrides.user ?? null) },
    trialSignup: {
      findUnique: jest.fn().mockResolvedValue(overrides.phone ?? null),
      count: jest.fn()
        .mockResolvedValueOnce(overrides.day ?? 0)
        .mockResolvedValueOnce(overrides.week ?? 0),
    },
    spa: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  return new TrialService(prisma as never, { login: jest.fn() } as never, { record: jest.fn() } as never);
}

describe('Trial signup limits', () => {
  it('rejects an email that already has an account', async () => {
    await expect(service({ user: { id: 'user-1' } }).create(dto, '203.0.113.8')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a phone that already started a trial', async () => {
    await expect(service({ phone: { id: 'trial-1' } }).create(dto, '203.0.113.8')).rejects.toThrow('Este teléfono ya tiene una prueba.');
  });

  it('rejects a second trial from the same connection within a day', async () => {
    await expect(service({ day: 1 }).create(dto, '203.0.113.8')).rejects.toThrow('desde esta conexión');
  });
});
