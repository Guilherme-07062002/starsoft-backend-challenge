import { PartialType } from "@nestjs/mapped-types";
import { ApiProperty } from "@nestjs/swagger";
import { ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class CreateReservationDto {
    @ApiProperty({ description: 'Lista de IDs dos assentos a serem reservados', example: ['uuid-seat-1', 'uuid-seat-2'] })
    @IsNotEmpty({ message: 'É necessário informar os assentos a serem reservados' })
    @IsArray({ message: 'seatIds deve ser um array de IDs' })
    @ArrayMinSize(1, { message: 'Deve haver ao menos um assento na reserva' })
    @ArrayUnique({ message: 'É necessário informar assentos diferentes para a reserva' })
    @IsUUID('4', { each: true, message: 'Cada ID do assento deve ser um UUID válido' })
    seatIds: string[];

    @ApiProperty({ description: 'ID do usuário (simulando autenticação)', example: 'uuid-user-1' })
    @IsNotEmpty({ message: 'É necessário fornecer o ID do usuário' })
    @IsString({ message: 'O ID do usuário deve ser uma string' })
    userId: string;
}

export class UpdateReservationDto extends PartialType(CreateReservationDto) {}