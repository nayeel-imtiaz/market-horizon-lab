import { useState } from 'react';
import DataVisualization from './DataVisualization';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export default function CsvBacktest() {
  const [model, setModel] = useState('ann');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(useDemo) {
    setBusy(true);
    setError('');
    setResult(null);

    try {
      const form = new FormData();
      if (!useDemo) {
        form.append('file', file);
        form.append('model', model);
      }
      const response = useDemo
        ? await fetch(`${API}/demo?model=${model}`)
        : await fetch(`${API}/upload-csv`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the CSV and model selection.');
      }
      setResult({ ...data, source: useDemo ? 'Synthetic demo' : file.name });
    } catch (failure) {
      setError(failure instanceof TypeError ? 'Could not connect to the API. Check that the backend is running.' : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="CSV backtest">
      <section className="panel controls" aria-label="Backtest settings">
        <label>Model
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>
            <option value="ann">Shallow neural network</option>
            <option value="dnn">Deep neural network</option>
            <option value="perceptron">Linear regressor</option>
          </select>
        </label>
        <label>Historical prices
          <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files[0] || null)} disabled={busy} />
        </label>
        <button type="button" disabled={busy || !file} onClick={() => run(false)}>Run backtest</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => run(true)}>Run synthetic demo</button>
      </section>
      {busy && <p role="status">Training model and evaluating the holdout…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <DataVisualization data={result} />}
    </section>
  );
}
