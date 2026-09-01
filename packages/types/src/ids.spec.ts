import { createRequestId, createConversationId } from '../src/ids';

describe('createRequestId', () => {
  it('returns ids prefixed with q_', () => {
    const id = createRequestId();
    expect(id).toMatch(/^q_[a-z0-9]+$/);
  });

  it('generates unique ids', () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a).not.toBe(b);
  });
});

describe('createConversationId', () => {
  it('returns ids prefixed with conv_', () => {
    expect(createConversationId()).toMatch(/^conv_[a-z0-9]+$/);
  });
});
