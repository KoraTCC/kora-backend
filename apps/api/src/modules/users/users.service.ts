import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, type EntityManager, type Repository } from 'typeorm';
import { User } from './user.entity.js';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async create(
    data: { name: string; email: string; passwordHash: string },
    manager?: EntityManager,
  ): Promise<User> {
    const repo = manager?.getRepository(User) ?? this.users;
    try {
      return await repo.save(
        repo.create({ ...data, passwordChangedAt: new Date() }),
      );
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          'Não foi possível criar a conta com este e-mail.',
        );
      }
      throw error;
    }
  }
}
