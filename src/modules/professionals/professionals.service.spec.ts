import { NotFoundException } from '@nestjs/common';
import { ProfessionalsService } from './professionals.service';
describe('ProfessionalsService tenant isolation', () => {
  it('filters reads by id and spaId and hides cross-tenant records', async () => {
    const prisma = {
      professional: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProfessionalsService(prisma as never);
    await expect(service.get('spa-a', 'record-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.professional.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_spaId: { id: 'record-b', spaId: 'spa-a' } },
      }),
    );
  });
});
