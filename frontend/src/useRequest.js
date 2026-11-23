import { useCallback, useEffect, useRef, useState } from 'react';

export default function useRequest() {
  const [state, setState] = useState({ result: null, pending: false, error: '', label: '' });
  const active = useRef(null);
  const lastRequest = useRef(null);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  const run = useCallback(async (request, label = '') => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    lastRequest.current = { request, label };
    setState((previous) => ({ ...previous, pending: true, error: '', label }));

    try {
      const result = await request(controller.signal);
      if (!controller.signal.aborted) {
        setState({ result, pending: false, error: '', label });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setState((previous) => ({ ...previous, pending: false, error: error.message }));
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }, []);

  function retry() {
    if (lastRequest.current) {
      const { request, label } = lastRequest.current;
      return run(request, label);
    }
  }

  return { ...state, run, retry };
}
