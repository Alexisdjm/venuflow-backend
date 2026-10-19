import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PaginationDto } from '../../common/dto/pagination.dto';
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  async list(spaId: string, q: PaginationDto) {
    const where = { spaId };
    const skip = (q.page - 1) * q.limit;
    const select = {
      id: true,
      spaId: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: q.limit,
        select,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, meta: { page: q.page, limit: q.limit, total } };
  }
}
