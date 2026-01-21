import { Controller, Get, Param } from '@nestjs/common';
import { SalesService } from './sales.service';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Sales (Vendas)')
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('history/:userId')
  @ApiOperation({ summary: 'Obtém o histórico de compras de um usuário' })
  @ApiParam({ name: 'userId', description: 'ID do usuário' })
  @ApiResponse({ status: 200, description: 'Histórico de compras do usuário.' })
  async getUserHistory(@Param('userId') userId: string) {
    return await this.salesService.findUserHistory(userId);
  }
}
