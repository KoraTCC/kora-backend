import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type JobStatus = 'pending' | 'done' | 'failed';

/** O que cabe em `jsonb`: o payload precisa sobreviver a JSON.stringify. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JobPayload = { [key: string]: JsonValue };

/**
 * Fila de trabalho em segundo plano. A API grava (na mesma transação da
 * mudança que gerou o trabalho) e o `apps/worker` executa, com retentativa.
 */
@Entity({ name: 'jobs' })
@Index(['status', 'runAt'])
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Qual handler do worker executa (ex.: `send_email`). */
  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: JobPayload;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: JobStatus;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 6 })
  maxAttempts: number;

  /** Não roda antes disso (agendamento e backoff). */
  @Column({ name: 'run_at', type: 'timestamptz', default: () => 'now()' })
  runAt: Date;

  /** Reserva de um worker. Vencida = o worker morreu, outro pode pegar. */
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
