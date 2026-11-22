import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

const MODEL_NAMES = { ann: 'Shallow neural network', dnn: 'Deep neural network', perceptron: 'Linear regressor' };
const number = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 });

function series(label, data, color, dashed = false) {
  return { label, data, borderColor: color, backgroundColor: color, pointRadius: 0, borderWidth: 2, borderDash: dashed ? [5, 4] : [] };
}

function Chart({ title, labels, datasets, units }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <div className="chart">
        <Line
          aria-label={title}
          data={{ labels, datasets }}
          options={{
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
              y: { title: { display: true, text: units } },
            },
          }}
        />
      </div>
    </section>
  );
}

export default function DataVisualization({ data }) {
  const metrics = [
    ['Model MAE', data.mae],
    ['Baseline MAE', data.baseline_mae],
    ['Model RMSE', Math.sqrt(data.mse)],
    ['Model R²', data.r2],
  ];

  return (
    <section aria-label="Backtest results">
      <h2>Holdout results</h2>
      <p>{data.source} · {MODEL_NAMES[data.model]} · {data.dates.length} sessions</p>
      <dl className="metrics">
        {metrics.map(([label, value]) => (
          <div className="panel" key={label}>
            <dt>{label}</dt>
            <dd>{value === null ? '—' : number.format(value)}</dd>
          </div>
        ))}
      </dl>
      <Chart title="Closing prices" labels={data.dates} units="Price" datasets={[
        series('Actual', data.Y_test, '#172554'),
        series('Model', data.Y_pred, '#0f766e'),
        series('Previous close', data.baseline, '#b45309', true),
      ]} />
      <Chart title="Training and validation error" labels={data['train loss'].map((_, index) => index + 1)}
        units="Mean squared price error" datasets={[
          series('Training', data['train loss'], '#0f766e'),
          series('Validation', data['validation loss'], '#7c3aed'),
        ]} />
    </section>
  );
}
