import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentProofFile } from './payment-proof';

@Injectable()
export class PaymentProofStore {
  constructor(private readonly config: ConfigService) {}

  async save(spaId: string, requestId: string, proof: PaymentProofFile) {
    if (!/^[0-9a-f-]{36}$/i.test(spaId) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
      throw new BadRequestException('No se pudo guardar la captura');
    }
    const ext = proof.mime === 'image/png' ? 'png' : proof.mime === 'image/webp' ? 'webp' : 'jpg';
    const stored = `${spaId}/${requestId}/${randomUUID()}.${ext}`;
    const absolute = this.absolute(stored);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, proof.bytes);
    return stored;
  }

  async remove(stored: string) {
    await rm(this.absolute(stored), { force: true });
  }

  async read(stored: string) {
    try {
      return await readFile(this.absolute(stored));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('No encontramos la captura.');
      }
      throw error;
    }
  }

  private absolute(stored: string) {
    const root = resolve(this.config.get<string>('PAYMENT_PROOF_DIR') || join(process.cwd(), 'storage', 'payment-proofs'));
    const absolute = resolve(root, ...stored.split('/'));
    const fromRoot = relative(root, absolute);
    if (!stored || stored.includes('..') || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new BadRequestException('No se pudo guardar la captura');
    }
    return absolute;
  }
}
