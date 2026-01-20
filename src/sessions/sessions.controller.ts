import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { CreateSessionDto, UpdateSessionDto } from './dto/sessions.dtos';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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
  findOne(@Param('id') id: string) {
    return this.sessionsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSessionDto: UpdateSessionDto) {
    return this.sessionsService.update(+id, updateSessionDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sessionsService.remove(+id);
  }
}
