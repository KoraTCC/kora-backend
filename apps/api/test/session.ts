import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uniqueIp } from './app.js';

export const ORIGIN = 'http://localhost:5173';

let counter = 0;

/** Cria uma conta nova e devolve o header Cookie da sessão dela. */
export async function newSession(app: INestApplication): Promise<string> {
  counter += 1;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', uniqueIp())
    .send({
      name: `Loja ${counter}`,
      email: `loja-${counter}-${Date.now()}@example.com`,
      password: 'cavalo bateria grampo correto',
    })
    .expect(201);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

/** Cliente HTTP autenticado com a sessão informada. */
export function as(app: INestApplication, cookie: string) {
  const server = app.getHttpServer();
  const withAuth = (req: request.Test) =>
    req
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', uniqueIp())
      .set('Cookie', cookie);
  return {
    get: (path: string) => withAuth(request(server).get(path)),
    post: (path: string, body?: object) =>
      withAuth(request(server).post(path)).send(body),
    patch: (path: string, body?: object) =>
      withAuth(request(server).patch(path)).send(body),
    delete: (path: string) => withAuth(request(server).delete(path)),
  };
}
