import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailableError } from './middleware/errorHandler';

describe('database error classification', () => {
  it.each([
    'MongoNetworkError',
    'MongoNotConnectedError',
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
  ])('recognizes %s as a service-unavailable failure', name => {
    expect(isDatabaseUnavailableError({ name })).toBe(true);
  });

  it('recognizes buffered operations that time out before MongoDB connects', () => {
    expect(isDatabaseUnavailableError({
      name: 'MongooseError',
      message: 'Operation `devices.find()` buffering timed out after 10000ms',
    })).toBe(true);
  });
});
