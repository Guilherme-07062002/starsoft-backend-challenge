import { PartialType } from "@nestjs/mapped-types";
import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsNotEmpty, IsNumber, IsString, Min } from "class-validator";

export class CreateSessionDto {
  @ApiProperty({ example: 'movie-123', description: 'ID do filme' })
  @IsNotEmpty({ message: 'É necessário informar o ID do filme.' })
  @IsString({ message: 'O ID do filme deve ser uma string.' })
  movieId: string;

  @ApiProperty({ example: 'Sala IMAX', description: 'Nome da sala' })
  @IsNotEmpty({ message: 'É necessário informar o nome da sala.' })
  @IsString({ message: 'O nome da sala deve ser uma string.' })
  room: string;

  @ApiProperty({ example: '2023-12-25T20:00:00Z', description: 'Data e hora ISO' })
  @IsNotEmpty({ message: 'É necessário informar a data e hora de início.' })
  @IsDateString({}, { message: 'A data e hora devem estar no formato ISO 8601.' })
  startsAt: string;

  @ApiProperty({ example: 25.50, description: 'Preço do ingresso' })
  @IsNotEmpty({ message: 'É necessário informar o preço do ingresso.' })
  @IsNumber({}, { message: 'O preço do ingresso deve ser um número.' })
  @Min(1, { message: 'O preço do ingresso deve ser no mínimo 1.' })
  price: number;
}

export class UpdateSessionDto extends PartialType(CreateSessionDto) {}