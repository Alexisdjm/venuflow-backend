import { BadRequestException } from '@nestjs/common';
import { decodePaymentProof } from './payment-proof';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, ...Buffer.alloc(40, 1)]);

describe('payment proof', () => {
  it('accepts a jpeg and skips the file when the method does not ask for one', () => {
    expect(decodePaymentProof(undefined, false)).toBeNull();
    expect(decodePaymentProof({ mime: 'image/jpeg', data: jpeg.toString('base64') }, true)?.mime).toBe('image/jpeg');
  });

  it('rejects a file that is not an image', () => {
    expect(() => decodePaymentProof({ mime: 'image/jpeg', data: Buffer.alloc(40, 1).toString('base64') }, true)).toThrow(BadRequestException);
    expect(() => decodePaymentProof(undefined, true)).toThrow(BadRequestException);
  });
});
