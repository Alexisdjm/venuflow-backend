import { UserRole } from '../generated/prisma/enums';
export interface AuthUser {
  sub: string;
  spaId: string | null;
  role: UserRole;
  email: string;
}
