import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import CsvBacktest from './components/CsvBacktest';
import RequestStatus from './components/RequestStatus';
import { requestApi } from './api';
import { categoryTicks, legendOptions, useCompactChart } from './chartLayout';
import useRequest from './useRequest';

const LOOKBACKS = { '3m': '3 months', '6m': '6 months', '1y': '1 year', '5y': '5 years' };
const fetchCatalog = (signal) => requestApi('/market-symbols', { signal });
const HORIZONS = { 1: 'Next session', 10: '10 sessions', 21: 'About 1 month', 63: 'About 3 months' };
const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const signed = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

function ForecastResults({ result }) {
  const [selectedHorizon, setSelectedHorizon] = useState(1);
  const compact = useCompactChart();
  const available = result.horizons.filter((horizon) => !horizon.reason);
  const evaluation = available.find((horizon) => horizon.sessions === selectedHorizon) || available[0];

  return (
    <section aria-label="Forecast results">
      <div className="market-heading">
        <div>
          <h2>{result.symbol} closing-price forecasts</h2>
          <p>{LOOKBACKS[result.lookback]} lookback · {result.source} · {result.history_count} sessions from {result.start_date} to {result.as_of}</p>
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
            plugins: { legend: legendOptions(compact), tooltip: { callbacks: { title: ([item]) => new Date(item.parsed.x).toISOString().slice(0, 10) } } },
            scales: {
              x: { type: 'linear', ticks: { maxTicksLimit: compact ? 4 : 8, maxRotation: 0, callback: (value) => dateLabel.format(value) } },
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
              plugins: { legend: legendOptions(compact) },
              scales: {
                x: { ticks: categoryTicks(compact, true) },
                y: { title: { display: true, text: compact ? 'Return (%)' : 'Cumulative return (%)' } },
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
  const [lookback, setLookback] = useState('1y');
  const catalog = useRequest();
  const forecast = useRequest();
  const loadCatalog = catalog.run;
  const groups = catalog.result;
  const { result, pending } = forecast;
  const selectionChanged = result && (result.symbol !== symbol || result.lookback !== lookback);

  useEffect(() => {
    loadCatalog(fetchCatalog);
  }, [loadCatalog]);

  function runForecast(event) {
    event.preventDefault();
    if (!groups) return;
    const query = new URLSearchParams({ lookback, symbol });
    forecast.run(
      (signal) => requestApi(`/market-forecast?${query}`, { signal }),
      `${symbol} · ${LOOKBACKS[lookback]}`,
    );
  }

  return (
    <main>
      <header>
        <h1>Market Horizon Lab</h1>
        <p>Forecast closing prices up to 63 trading sessions ahead and compare model accuracy with a last-close baseline.</p>
      </header>
      <form className="panel controls forecast-controls" onSubmit={runForecast} aria-label="Market forecast settings">
        <label>Ticker
          <select value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={pending || !groups}>
            {groups ? Object.entries(groups).map(([group, members]) => (
              <optgroup label={group} key={group}>
                {Object.entries(members).map(([ticker, name]) => <option key={ticker} value={ticker}>{ticker} — {name}</option>)}
              </optgroup>
            )) : <option value="SOXL">SOXL</option>}
          </select>
        </label>
        <label>History
          <select value={lookback} onChange={(event) => setLookback(event.target.value)} disabled={pending}>
            {Object.entries(LOOKBACKS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button disabled={pending || !groups}>Run {symbol} forecast</button>
      </form>
      {catalog.pending && <RequestStatus message="Connecting to forecasting service…" />}
      {catalog.error && (
        <div className="request-error">
          <p role="alert">Ticker list unavailable. {catalog.error}</p>
          <button className="secondary" onClick={catalog.retry}>Retry ticker list</button>
        </div>
      )}
      {pending && <RequestStatus message={`Waiting for forecast and backtest for ${forecast.label}…`} />}
      {forecast.error && (
        <div className="request-error">
          <p role="alert">{forecast.label} forecast failed. {forecast.error}</p>
          <button className="secondary" onClick={forecast.retry}>Retry forecast</button>
        </div>
      )}
      {selectionChanged && (
        <p className="selection-note">
          Showing the last completed forecast for {result.symbol} · {LOOKBACKS[result.lookback]}.
          {pending ? ' The requested forecast is pending.' : ` Run ${symbol} forecast to apply your selection.`}
        </p>
      )}
      {result && <ForecastResults key={`${result.symbol}-${result.lookback}`} result={result} />}
      <details className="panel advanced-tools">
        <summary>Advanced Tools: CSV Backtesting &amp; Synthetic Data</summary>
        <p>Upload a CSV of historical closing prices to run a holdout backtest, or try the same workflow with generated prices.</p>
        <CsvBacktest />
      </details>
    </main>
  );
}
