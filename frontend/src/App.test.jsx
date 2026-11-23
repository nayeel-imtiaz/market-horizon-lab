import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import { requestApi } from './api';

jest.mock('./api');
jest.mock('react-chartjs-2', () => ({ Line: () => <div /> }));

const catalog = { 'Leveraged products': { SOXL: 'Semiconductors', MUU: 'Micron' } };
const forecast = {
  symbol: 'SOXL', lookback: '1y', source: 'Yahoo Finance', history_count: 2,
  start_date: '2026-11-19', as_of: '2026-11-20', last_close: 30,
  history_dates: ['2026-11-19', '2026-11-20'], history_close: [29, 30], horizons: [],
};
const synthetic = {
  model: 'ann', dates: ['2026-11-20'], Y_test: [30], Y_pred: [31], baseline: [29],
  mse: 1, mae: 1, baseline_mae: 1, r2: null, 'train loss': [2], 'validation loss': [3],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  requestApi.mockReset();
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  });
});

test('shows connection progress and retries the ticker list after a failure', async () => {
  const first = deferred();
  requestApi.mockReturnValueOnce(first.promise).mockResolvedValueOnce(catalog);
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('Connecting to forecasting service');
  expect(screen.getByRole('button', { name: 'Run SOXL forecast' })).toBeDisabled();
  await act(async () => first.reject(new Error('Service unavailable.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry ticker list' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Ticker' })).toBeEnabled());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('keeps prior results labeled and retries the original failed selection', async () => {
  const next = deferred();
  requestApi.mockResolvedValueOnce(catalog).mockResolvedValueOnce(forecast)
    .mockReturnValueOnce(next.promise).mockResolvedValueOnce({ ...forecast, symbol: 'MUU', lookback: '5y' });
  render(<App />);
  await screen.findByRole('option', { name: 'MUU — Micron' });
  fireEvent.click(screen.getByRole('button', { name: 'Run SOXL forecast' }));
  await screen.findByRole('heading', { name: 'SOXL closing-price forecasts' });

  fireEvent.change(screen.getByRole('combobox', { name: 'Ticker' }), { target: { value: 'MUU' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'History' }), { target: { value: '5y' } });
  expect(screen.getByText(/last completed forecast for SOXL · 1 year/)).toBeInTheDocument();
  expect(requestApi).toHaveBeenCalledTimes(2);

  const submit = screen.getByRole('button', { name: 'Run MUU forecast' });
  fireEvent.click(submit);
  expect(submit).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'History' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Market forecast settings' }));
  expect(requestApi).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('status')).toHaveTextContent(/MUU · 5 years/);
  expect(screen.getByRole('heading', { name: 'SOXL closing-price forecasts' })).toBeVisible();

  await act(async () => next.reject(new Error('Try again shortly.')));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('MUU · 5 years forecast failed');
  fireEvent.change(screen.getByRole('combobox', { name: 'History' }), { target: { value: '6m' } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry forecast' }));
  expect(requestApi).toHaveBeenLastCalledWith('/market-forecast?lookback=5y&symbol=MUU', expect.anything());
  await screen.findByRole('heading', { name: 'MUU closing-price forecasts' });
  expect(screen.getByText(/last completed forecast for MUU · 5 years/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'History' }), { target: { value: '5y' } });
  expect(screen.queryByText(/last completed forecast/)).not.toBeInTheDocument();
});

test('advanced tools start collapsed and label synthetic results after retry', async () => {
  const pending = deferred();
  requestApi.mockResolvedValueOnce(catalog).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(synthetic);
  render(<App />);
  await screen.findByRole('option', { name: 'MUU — Micron' });
  const summary = screen.getByText('Advanced Tools: CSV Backtesting & Synthetic Data');
  expect(screen.getByRole('button', { name: 'Run synthetic demo' })).not.toBeVisible();
  fireEvent.click(summary);
  const demo = screen.getByRole('button', { name: 'Run synthetic demo' });
  fireEvent.click(demo);
  expect(demo).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Running backtest for synthetic data');
  await act(async () => pending.reject(new Error('Service unavailable.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Backtest for synthetic data failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry backtest' }));
  expect(await screen.findByText(/Synthetic data · Generated prices/)).toBeInTheDocument();
});

test('submits the selected CSV and labels the uploaded results', async () => {
  requestApi.mockResolvedValueOnce(catalog).mockResolvedValueOnce(synthetic);
  render(<App />);
  await screen.findByRole('option', { name: 'MUU — Micron' });
  fireEvent.click(screen.getByText('Advanced Tools: CSV Backtesting & Synthetic Data'));
  const run = screen.getByRole('button', { name: 'Run backtest' });
  expect(run).toBeDisabled();
  const file = new File(['Date,Close\n2026-11-20,30'], 'prices.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Historical prices'), { target: { files: [file] } });
  fireEvent.click(run);
  const [path, options] = requestApi.mock.calls[1];
  expect(path).toBe('/upload-csv');
  expect(options.method).toBe('POST');
  expect(options.body.get('file')).toBe(file);
  expect(options.body.get('model')).toBe('ann');
  expect(await screen.findByText(/Uploaded CSV · prices.csv/)).toBeInTheDocument();
});
