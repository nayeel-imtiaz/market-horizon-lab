import { useState } from 'react';
import DataVisualization from './DataVisualization';
import RequestStatus from './RequestStatus';
import { requestApi } from '../api';
import useRequest from '../useRequest';

export default function CsvBacktest() {
  const [model, setModel] = useState('ann');
  const [file, setFile] = useState(null);
  const backtest = useRequest();
  const { result, pending, error, label } = backtest;

  function run(useDemo) {
    if (!useDemo && !file) return;

    backtest.run(async (signal) => {
      if (useDemo) {
        const data = await requestApi(`/demo?model=${model}`, { signal });
        return { ...data, source: 'Synthetic data · Generated prices' };
      }

      const form = new FormData();
      form.append('file', file);
      form.append('model', model);
      const data = await requestApi('/upload-csv', { method: 'POST', body: form, signal });
      return { ...data, source: `Uploaded CSV · ${file.name}` };
    }, useDemo ? 'synthetic data' : file.name);
  }

  return (
    <section aria-label="CSV backtest">
      <section className="panel controls" aria-label="Backtest settings">
        <label>Model
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={pending}>
            <option value="ann">Shallow neural network</option>
            <option value="dnn">Deep neural network</option>
            <option value="perceptron">Linear regressor</option>
          </select>
        </label>
        <label>Historical prices
          <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files[0] || null)} disabled={pending} />
        </label>
        <button type="button" disabled={pending || !file} onClick={() => run(false)}>Run backtest</button>
        <button type="button" className="secondary" disabled={pending} onClick={() => run(true)}>Run synthetic demo</button>
      </section>
      {pending && <RequestStatus message={`Running backtest for ${label}…`} />}
      {error && (
        <div className="request-error">
          <p role="alert">Backtest for {label} failed. {error}</p>
          <button type="button" className="secondary" onClick={backtest.retry}>Retry backtest</button>
        </div>
      )}
      {result && <DataVisualization data={result} />}
    </section>
  );
}
