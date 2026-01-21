import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/sessions.dtos';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

@ApiTags('Sessions (Sessões de Cinema)')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma nova sessão de cinema com assentos pré-gerados.'})
  async create(@Body() createSessionDto: CreateSessionDto) {
    return await this.sessionsService.create(createSessionDto);
  }
  
  @Get()
  @ApiOperation({ summary: 'Lista todas as sessões de cinema com seus respectivos assentos.'})
  async findAll() {
    return await this.sessionsService.findAll();
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'ID da sessão de cinema' })
  @ApiOperation({ summary: 'Obtém os detalhes de uma sessão específica, incluindo assentos disponíveis em tempo real.'})
  async findOne(@Param('id') id: string) {
    return await this.sessionsService.findOne(id);
  }
}
