import { PartialType } from "@nestjs/mapped-types";

export class CreateReservationDto {}

export class UpdateReservationDto extends PartialType(CreateReservationDto) {}