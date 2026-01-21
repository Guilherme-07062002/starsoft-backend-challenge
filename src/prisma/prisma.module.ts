import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo Prisma que fornece o serviço Prisma para acesso ao banco de dados.
 */
@Global() // Torna o módulo Prisma global, disponível em toda a aplicação
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
