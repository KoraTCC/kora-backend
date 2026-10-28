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

  /**
   * Soma uma falha de login de forma atômica. Ao chegar em `maxAttempts`,
   * trava a conta até `lockedUntil` e zera o contador. Devolve true se travou.
   */
  async recordFailedLogin(
    id: string,
    maxAttempts: number,
    lockedUntil: Date,
  ): Promise<boolean> {
    const reachesLimit = 'failed_login_count + 1 >= :maxAttempts';
    const result = await this.users
      .createQueryBuilder()
      .update(User)
      .set({
        failedLoginCount: () =>
          `CASE WHEN ${reachesLimit} THEN 0 ELSE failed_login_count + 1 END`,
        lockedUntil: () =>
          `CASE WHEN ${reachesLimit} THEN :lockedUntil ELSE locked_until END`,
      })
      .where('id = :id', { id })
      .setParameters({ maxAttempts, lockedUntil })
      .returning('failed_login_count')
      .execute();
    const rows = result.raw as Array<{ failed_login_count: number }>;
    // O contador só volta a 0 aqui quando a conta acabou de ser travada.
    return rows[0]?.failed_login_count === 0;
  }

  async recordSuccessfulLogin(
    id: string,
    passwordHash?: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager?.getRepository(User) ?? this.users;
    await repo.update(id, {
      failedLoginCount: 0,
      lockedUntil: null,
      ...(passwordHash ? { passwordHash } : {}),
    });
  }

  /**
   * Grava a nova senha. Atualizar `password_changed_at` derruba os access
   * tokens já emitidos (o AccessTokenGuard recusa os mais antigos), e o
   * bloqueio por tentativas é zerado.
   */
  async changePassword(
    id: string,
    passwordHash: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(User).update(id, {
      passwordHash,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    });
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
