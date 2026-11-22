const configuredUrl = process.env.REACT_APP_API_URL?.trim();
const API = (configuredUrl || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8000')).replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 90_000;

export async function requestApi(path, { signal, ...options } = {}) {
  if (!API) throw new Error('The public API URL is missing from this build.');

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API}${path}`, { ...options, signal: controller.signal });
    const data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : null;
    if (!response.ok || !data) {
      throw new Error(typeof data?.detail === 'string'
        ? data.detail
        : 'The API is temporarily unavailable. Try again shortly.');
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) {
      throw new Error('The API took too long to respond. It may be starting up. Try again shortly.');
    }
    if (error instanceof TypeError) {
      throw new Error('Could not reach the API. It may be starting up. Try again shortly.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
