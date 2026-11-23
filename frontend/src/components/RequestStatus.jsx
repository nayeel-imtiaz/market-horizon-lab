import { useEffect, useState } from 'react';

export default function RequestStatus({ message }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="request-status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <div role="status">
          {message}
          {elapsed >= 8 && <p>The service may be waking up. The first request after idle can take about a minute.</p>}
        </div>
        {elapsed > 0 && <span className="elapsed" aria-hidden="true">{elapsed}s elapsed</span>}
      </div>
    </div>
  );
}
