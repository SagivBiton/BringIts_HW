import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Body,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QueriesService } from './queries.service';
import { OrchestratorError } from '@llm-query/orchestrator';
import { ErrorCode } from '@llm-query/types';

@Controller('v1/queries')
export class QueriesController {
  constructor(@Inject(QueriesService) private readonly queries: QueriesService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(@Body() body: Record<string, unknown>) {
    try {
      return await this.queries.submit(body);
    } catch (e) {
      if (e instanceof OrchestratorError) {
        if (e.code === ErrorCode.GEO_UNAVAILABLE) {
          throw new UnprocessableEntityException({
            error: {
              code: e.code,
              message: e.message,
              http_status: e.http_status,
            },
          });
        }
        if (e.code === ErrorCode.CONVERSATION_NOT_FOUND) {
          throw new NotFoundException({
            error: {
              code: e.code,
              message: e.message,
              http_status: e.http_status,
            },
          });
        }
        throw new BadRequestException({
          error: {
            code: e.code,
            message: e.message,
            http_status: e.http_status,
          },
        });
      }
      throw e;
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const record = await this.queries.get(id);
    if (!record) {
      throw new NotFoundException({ message: 'Query not found' });
    }
    if (record.status === 'ok' && record.result) {
      return record.result;
    }
    if (record.status === 'error' && record.error) {
      return {
        request_id: record.request_id,
        status: 'error',
        duration_ms: record.duration_ms,
        source: record.source,
        prompt: record.prompt,
        error: record.error,
      };
    }
    return { request_id: record.request_id, status: record.status };
  }
}
