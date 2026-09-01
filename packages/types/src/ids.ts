import { randomBytes } from 'crypto';

export function createRequestId(): string {
  return `q_${randomBytes(12).toString('hex')}`;
}

export function createConversationId(): string {
  return `conv_${randomBytes(12).toString('hex')}`;
}
