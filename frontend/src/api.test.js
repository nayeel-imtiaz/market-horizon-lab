import { requestApi } from './api';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

function response(contentType, body, ok = true) {
  return { ok, headers: { get: () => contentType }, json: async () => body };
}

test('requests the route at the configured origin and reads JSON', async () => {
  global.fetch = jest.fn().mockResolvedValue(response('application/json', { status: 'ok' }));
  await expect(requestApi('/health')).resolves.toEqual({ status: 'ok' });
  expect(global.fetch).toHaveBeenCalledWith(
    `${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/health`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test('preserves the backend error message', async () => {
  global.fetch = jest.fn().mockResolvedValue(response('application/json', { detail: 'Try again shortly.' }, false));
  await expect(requestApi('/market-forecast')).rejects.toThrow('Try again shortly.');
});

test('handles a non-JSON cold-start response', async () => {
  global.fetch = jest.fn().mockResolvedValue(response('text/html', null));
  await expect(requestApi('/market-symbols')).rejects.toThrow('temporarily unavailable');
});

test('aborts a slow request and returns a retryable message', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const pending = requestApi('/market-forecast');
  jest.advanceTimersByTime(90_000);
  await expect(pending).rejects.toThrow('took too long');
});
