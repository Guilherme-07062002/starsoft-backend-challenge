import { Injectable } from '@nestjs/common';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dtos';

@Injectable()
export class ReservationsService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  create(createReservationDto: CreateReservationDto) {
    return 'This action adds a new reservation';
  }

  findAll() {
    return `This action returns all reservations`;
  }

  findOne(id: number) {
    return `This action returns a #${id} reservation`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(id: number, updateReservationDto: UpdateReservationDto) {
    return `This action updates a #${id} reservation`;
  }

  remove(id: number) {
    return `This action removes a #${id} reservation`;
  }
}
