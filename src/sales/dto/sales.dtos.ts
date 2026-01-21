import { PartialType } from '@nestjs/swagger';

export class CreateSaleDto {}

export class UpdateSaleDto extends PartialType(CreateSaleDto) {}
