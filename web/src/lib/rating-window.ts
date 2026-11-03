/** Which season window has the better probability score. Lower log loss wins, then Brier. */

export type WindowScore = {
  games: number;
  modelBrier: number | null;
  modelLogLoss: number | null;
  marketBrier: number | null;
  marketLogLoss: number | null;
};

export function bestWindowStart(rows: { start: number; backtest: WindowScore | null }[]) {
  const scored = rows.filter(
    (row) => row.backtest && row.backtest.games > 0 && row.backtest.modelLogLoss != null,
  );
  scored.sort((a, b) => {
    const loss = (a.backtest?.modelLogLoss ?? 99) - (b.backtest?.modelLogLoss ?? 99);
    if (Math.abs(loss) > 1e-9) return loss;
    return (a.backtest?.modelBrier ?? 99) - (b.backtest?.modelBrier ?? 99);
  });
  return scored[0]?.start ?? rows[rows.length - 1]?.start ?? 0;
}

export function windowLabel(start: number, current: number) {
  if (start === current) return "Current season only";
  return `${start} → current`;
}
