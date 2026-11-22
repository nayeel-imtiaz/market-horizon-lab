import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import CsvBacktest from './components/CsvBacktest';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const HORIZONS = { 1: 'Next session', 10: '10 sessions', 21: 'About 1 month', 63: 'About 3 months' };
const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const signed = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

function ForecastResults({ result }) {
  const [selectedHorizon, setSelectedHorizon] = useState(1);
  const available = result.horizons.filter((horizon) => !horizon.reason);
  const evaluation = available.find((horizon) => horizon.sessions === selectedHorizon) || available[0];

  return (
    <section aria-label="Forecast results">
      <div className="market-heading">
        <div>
          <h2>{result.symbol} closing-price forecasts</h2>
          <p>{result.source} · {result.history_count} sessions from {result.start_date} to {result.as_of}</p>
          {result.history_limited && <p>{result.symbol} began trading within the selected window. Using available history.</p>}
        </div>
        <div className="latest-close">
          <span>Last completed close</span>
          <strong>{usd.format(result.last_close)}</strong>
        </div>
      </div>
      <div className="horizon-grid">
        {result.horizons.map((horizon) => (
          <article className="panel horizon-card" key={horizon.sessions}>
            <h3>{HORIZONS[horizon.sessions]}</h3>
            <p>{horizon.target_date} · {horizon.sessions} {horizon.sessions === 1 ? 'session' : 'sessions'}</p>
            {horizon.reason ? <p>{horizon.reason}</p> : (
              <>
                <strong className="forecast-price">{usd.format(horizon.forecast_close)}</strong>
                <span>{signed.format(horizon.forecast_change_pct)}% from last close</span>
                <dl className="comparison">
                  <div><dt>Model MAE</dt><dd>{horizon.model_mae_pp.toFixed(2)} pp</dd></div>
                  <div><dt>Baseline MAE</dt><dd>{horizon.baseline_mae_pp.toFixed(2)} pp</dd></div>
                </dl>
                <p className="evaluation">
                  {horizon.model_mae_pp < horizon.baseline_mae_pp ? 'Model had lower error' :
                    horizon.model_mae_pp > horizon.baseline_mae_pp ? 'Baseline had lower error' : 'Errors tied'}
                  {' · '}{horizon.evaluation_count} backtest origins
                </p>
              </>
            )}
          </article>
        ))}
      </div>
      <p>MAE is the average absolute return error in percentage points (pp). The baseline carries forward the last close.</p>
      <section className="panel">
        <h3>Price history and forecast targets</h3>
        <div className="chart">
          <Line aria-label="Adjusted closing-price history and selected forecast targets" data={{
            datasets: [
              {
                label: 'Adjusted history',
                data: result.history_dates.map((date, index) => ({ x: Date.parse(date), y: result.history_close[index] })),
                borderColor: '#0f766e',
                backgroundColor: '#0f766e',
                pointRadius: 0,
                borderWidth: 2,
              },
              {
                label: 'Forecast targets',
                data: available.map((horizon) => ({ x: Date.parse(horizon.target_date), y: horizon.forecast_close })),
                showLine: false,
                pointRadius: 6,
                backgroundColor: '#b45309',
              },
            ],
          }} options={{
            maintainAspectRatio: false,
            plugins: { tooltip: { callbacks: { title: ([item]) => new Date(item.parsed.x).toISOString().slice(0, 10) } } },
            scales: {
              x: { type: 'linear', ticks: { maxTicksLimit: 8, maxRotation: 0, callback: (value) => dateLabel.format(value) } },
              y: { title: { display: true, text: 'USD' } },
            },
          }} />
        </div>
      </section>
      {evaluation && (
        <section className="panel">
          <h3>Walk-forward backtest</h3>
          <label className="backtest-selector">Horizon
            <select value={evaluation.sessions} onChange={(event) => setSelectedHorizon(Number(event.target.value))}>
              {available.map((horizon) => <option key={horizon.sessions} value={horizon.sessions}>{HORIZONS[horizon.sessions]}</option>)}
            </select>
          </label>
          <p>{evaluation.evaluation_count} forecasts made from {evaluation.origin_dates[0]} to {evaluation.origin_dates.at(-1)}. The chart uses target dates.</p>
          <div className="chart">
            <Line aria-label="Walk-forward realized and predicted returns" data={{
              labels: evaluation.target_dates,
              datasets: [
                { label: 'Realized return', data: evaluation.realized_pct, borderColor: '#172554', pointRadius: 0 },
                { label: 'Model return', data: evaluation.predicted_pct, borderColor: '#0f766e', pointRadius: 0 },
                { label: 'Last-close baseline', data: evaluation.target_dates.map(() => 0), borderColor: '#b45309', borderDash: [5, 4], pointRadius: 0 },
              ],
            }} options={{
              maintainAspectRatio: false,
              scales: {
                x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
                y: { title: { display: true, text: 'Cumulative return (%)' } },
              },
            }} />
          </div>
        </section>
      )}
      <p>Forecasts use historical prices. Backtest outcomes can overlap at longer horizons, and future errors may differ.</p>
    </section>
  );
}

export default function App() {
  const [symbol, setSymbol] = useState('SOXL');
  const [groups, setGroups] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [lookback, setLookback] = useState('1y');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadCatalog(signal) {
    setCatalogError('');
    try {
      const response = await fetch(`${API}/market-symbols`, { signal });
      if (!response.ok) throw new Error('Catalog request failed.');
      setGroups(await response.json());
    } catch (failure) {
      if (failure.name !== 'AbortError') setCatalogError('Ticker list unavailable. Check that the API is running.');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal);
    return () => controller.abort();
  }, []);

  async function runForecast(event) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const response = await fetch(`${API}/market-forecast?lookback=${lookback}&symbol=${encodeURIComponent(symbol)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'The forecast request failed.');
      }
      setResult(data);
    } catch (failure) {
      setError(failure instanceof TypeError ? 'Could not connect to the API. Check that the backend is running.' : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <h1>Market Horizon Lab</h1>
        <p>Forecast closing prices up to 63 trading sessions ahead and compare model accuracy with a last-close baseline.</p>
      </header>
      <form className="panel controls" onSubmit={runForecast} aria-label="Market forecast settings">
        <label>Ticker
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={busy || !groups}>
            {groups ? Object.entries(groups).map(([group, members]) => (
              <optgroup label={group} key={group}>
                {Object.entries(members).map(([ticker, name]) => <option key={ticker} value={ticker}>{ticker} — {name}</option>)}
              </optgroup>
            )) : <option value="SOXL">SOXL</option>}
          </select>
        </label>
        <label>History
          <select value={lookback} onChange={(event) => setLookback(event.target.value)} disabled={busy}>
            <option value="3m">3 months</option>
            <option value="6m">6 months</option>
            <option value="1y">1 year</option>
            <option value="5y">5 years</option>
          </select>
        </label>
        <button disabled={busy}>Run {symbol} forecast</button>
      </form>
      {catalogError && <p role="alert">{catalogError} <button className="secondary" onClick={() => loadCatalog()}>Retry ticker list</button></p>}
      {busy && <p role="status">Fetching daily prices and running backtests…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <ForecastResults result={result} />}
      <details className="panel">
        <summary>CSV backtest and synthetic demo</summary>
        <CsvBacktest />
      </details>
    </main>
  );
}
