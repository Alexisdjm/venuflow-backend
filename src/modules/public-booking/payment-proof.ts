import { BadRequestException } from '@nestjs/common';

export const MAX_PROOF_BYTES = 1_500_000;

const kinds = {
  'image/jpeg': (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (bytes: Buffer) =>
    bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
} as const;

export type PaymentProofFile = { mime: keyof typeof kinds; bytes: Buffer };

export function decodePaymentProof(
  input: { mime?: string; data?: string } | undefined,
  required: boolean,
): PaymentProofFile | null {
  if (!input?.data) {
    if (required) throw new BadRequestException('Adjunta la captura del pago');
    return null;
  }
  const mime = input.mime;
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
    throw new BadRequestException('La captura debe ser JPG, PNG o WebP');
  }
  const data = input.data.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (data.length > 2_100_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new BadRequestException('La captura no es válida');
  }
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 32 || bytes.length > MAX_PROOF_BYTES || !kinds[mime](bytes)) {
    throw new BadRequestException('La captura debe ser una imagen de hasta 1.5 MB');
  }
  return { mime, bytes };
}
