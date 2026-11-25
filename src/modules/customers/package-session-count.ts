import { BadRequestException } from '@nestjs/common';

export const PACKAGE_SESSION_MIN = 4;
export const PACKAGE_SESSION_MAX = 15;

export function assertPackageSessionCount(sessionCount: number) {
  if (
    !Number.isInteger(sessionCount) ||
    sessionCount < PACKAGE_SESSION_MIN ||
    sessionCount > PACKAGE_SESSION_MAX
  ) {
    throw new BadRequestException(
      `El plan puede tener entre ${PACKAGE_SESSION_MIN} y ${PACKAGE_SESSION_MAX} sesiones.`,
    );
  }
}
