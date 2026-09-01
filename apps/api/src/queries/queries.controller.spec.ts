import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { QueriesService } from './queries.service';
import { Orchestrator } from '@llm-query/orchestrator';
import { InMemoryQueryStore } from '@llm-query/queue';
import { InMemoryProxyPool } from '@llm-query/proxy';

describe('QueriesController (e2e)', () => {
  let app: INestApplication;
  let store: InMemoryQueryStore;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    store = new InMemoryQueryStore();
    const proxyPool = new InMemoryProxyPool([
      {
        id: 'local',
        url: 'http://127.0.0.1:8080',
        geo: 'US',
        kind: 'local-test',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    orchestrator = new Orchestrator({
      queryStore: store,
      proxyPool,
      stepRunner: async () => ({
        artifacts: { streamBody: '"Hello!"' },
      }),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(QueriesService)
      .useValue(new QueriesService(orchestrator, store))
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /v1/queries returns 202 with queued status', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/queries')
      .send({ source: 'gemini', prompt: 'hello' })
      .expect(HttpStatus.ACCEPTED);

    expect(res.body).toMatchObject({ status: 'queued' });
    expect(res.body.request_id).toMatch(/^q_/);
  });

  it('POST rejects invalid body with 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/queries')
      .send({ source: 'gemini', prompt: '' })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('POST rejects unsupported source with 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/queries')
      .send({ source: 'claude', prompt: 'hi' })
      .expect(HttpStatus.BAD_REQUEST);
  });

  it('GET /v1/queries/:id returns queued then ok after processing', async () => {
    const post = await request(app.getHttpServer())
      .post('/v1/queries')
      .send({ source: 'gemini', prompt: 'hello' })
      .expect(HttpStatus.ACCEPTED);

    const queued = await request(app.getHttpServer())
      .get(`/v1/queries/${post.body.request_id}`)
      .expect(HttpStatus.OK);
    expect(queued.body.status).toBe('queued');

    await orchestrator.processNextJob('http');

    const done = await request(app.getHttpServer())
      .get(`/v1/queries/${post.body.request_id}`)
      .expect(HttpStatus.OK);
    expect(done.body.status).toBe('ok');
    expect(done.body.response_text).toBe('Hello!');
    expect(done.body.conversation_id).toMatch(/^conv_/);
  });

  it('POST rejects unknown conversation_id with 404', async () => {
    await request(app.getHttpServer())
      .post('/v1/queries')
      .send({
        source: 'gemini',
        prompt: 'hi',
        conversation_id: 'conv_missing',
      })
      .expect(HttpStatus.NOT_FOUND);
  });

  it('GET returns 404 for unknown id', async () => {
    await request(app.getHttpServer())
      .get('/v1/queries/q_doesnotexist')
      .expect(HttpStatus.NOT_FOUND);
  });
});
