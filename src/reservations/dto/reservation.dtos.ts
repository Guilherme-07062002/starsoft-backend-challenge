import { PartialType } from "@nestjs/mapped-types";
import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class CreateReservationDto {
    @ApiProperty({ description: 'ID do assento que se quer reservar' })
    @IsNotEmpty({ message: 'É necessário fornecer o ID do assento' })
    @IsString({ message: 'O ID do assento deve ser uma string' })
    @IsUUID('4', { message: 'O ID do assento deve ser um UUID válido' })
    seatId: string;

    @ApiProperty({ description: 'ID do usuário (simulando autenticação)' })
    @IsNotEmpty({ message: 'É necessário fornecer o ID do usuário' })
    @IsString({ message: 'O ID do usuário deve ser uma string' })
    userId: string;
}

export class UpdateReservationDto extends PartialType(CreateReservationDto) {}