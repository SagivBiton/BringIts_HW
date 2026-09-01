import { Injectable } from '@nestjs/common';
import { validateQueryCommand } from '@llm-query/types';
import { Orchestrator } from '@llm-query/orchestrator';
import { InMemoryQueryStore, QueryStore } from '@llm-query/queue';
import { BadRequestException } from '@nestjs/common';

@Injectable()
export class QueriesService {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly store: QueryStore,
  ) {}

  async submit(body: Record<string, unknown>) {
    const validated = validateQueryCommand(body);
    if (!validated.ok) {
      throw new BadRequestException({
        error: {
          code: validated.error.code,
          message: validated.error.message,
          http_status: validated.error.http_status,
        },
      });
    }
    return this.orchestrator.submit(validated.value);
  }

  async get(requestId: string) {
    return this.store.get(requestId);
  }
}
