import { Controller, Get, Post, Body, Patch, Param, Delete, Headers, HttpCode } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservations.dtos';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Reservations (Reservas)')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post(':id/pay')
  @HttpCode(200) // Para indicar que é 200 OK, não 201 Created
  @ApiOperation({ summary: 'Confirma o pagamento de uma reserva' })
  @ApiResponse({ status: 200, description: 'Pagamento confirmado e assento vendido.' })
  @ApiResponse({ status: 400, description: 'Reserva expirada.' })
  @ApiParam({ name: 'id', description: 'ID da reserva que será confirmada' })
  async confirmPayment(@Param('id') id: string) {
    return await this.reservationsService.confirmPayment(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma reserva temporária de assento' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Chave de idempotência para retries (mesma chave = mesma resposta).',
  })
  @ApiResponse({ status: 201, description: 'Reserva criada.' })
  @ApiResponse({ status: 409, description: 'Assento já ocupado (Race Condition).' })
  async create(
    @Body() createReservationDto: CreateReservationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return await this.reservationsService.create(createReservationDto, idempotencyKey);
  }

  @Get('history/:userId')
  @ApiOperation({ summary: 'Obtém o histórico de compras de um usuário' })
  @ApiParam({ name: 'userId', description: 'ID do usuário' })
  @ApiResponse({ status: 200, description: 'Histórico de compras do usuário.' })
  async getUserHistory(@Param('userId') userId: string) {
    return await this.reservationsService.findUserHistory(userId);
  }

  @Get()
  @ApiOperation({ summary: 'Lista todas as reservas' })
  async findAll() {
    return await this.reservationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reservationsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateReservationDto: UpdateReservationDto) {
    return this.reservationsService.update(+id, updateReservationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.reservationsService.remove(+id);
  }
}
