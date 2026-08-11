import type { Currency, Operation } from "./types";

export type ExchangeRates = Record<Currency, number>;

export interface ExchangeRateSnapshot {
  rates: ExchangeRates;
  date: string;
  fallback: boolean;
}

export const CURRENCIES: Currency[] = ["USD", "RUB", "VND"];

export const FALLBACK_EXCHANGE_RATES: ExchangeRates = {
  USD: 1,
  RUB: 80,
  VND: 26100,
};

const RATE_URLS = [
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
  "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
];

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const rateBetween = (
  from: Currency,
  to: Currency,
  rates: ExchangeRates,
) => rates[to] / rates[from];

export const convertCurrency = (
  amount: number,
  from: Currency,
  to: Currency,
  rates: ExchangeRates,
) => amount * rateBetween(from, to, rates);

export const rebaseOperations = (
  operations: Operation[],
  baseCurrency: Currency,
  rates: ExchangeRates,
) =>
  operations.map((operation) => {
    const rate = rateBetween(operation.currency, baseCurrency, rates);
    return {
      ...operation,
      rate,
      baseAmount: Math.round(operation.amount * rate * 10_000) / 10_000,
    };
  });

export const inferOperationBaseCurrency = (
  operations: Operation[],
  rates: ExchangeRates,
): Currency | null => {
  const usable = operations.filter(
    (operation) => operation.amount > 0 && operation.rate > 0,
  );
  if (!usable.length) return null;

  const scores = CURRENCIES.map((candidate) => {
    const errors = usable
      .map((operation) => {
        const expected = rateBetween(operation.currency, candidate, rates);
        return Math.abs(Math.log(operation.rate / expected));
      })
      .sort((a, b) => a - b);
    return {
      currency: candidate,
      score: errors[Math.floor(errors.length / 2)],
    };
  }).sort((a, b) => a.score - b.score);

  return scores[0].score < 0.7 ? scores[0].currency : null;
};

export async function fetchExchangeRates(): Promise<ExchangeRateSnapshot> {
  for (const url of RATE_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        date?: unknown;
        usd?: Record<string, unknown>;
      };
      const rub = payload.usd?.rub;
      const vnd = payload.usd?.vnd;
      if (!isPositiveNumber(rub) || !isPositiveNumber(vnd)) continue;
      return {
        rates: { USD: 1, RUB: rub, VND: vnd },
        date:
          typeof payload.date === "string"
            ? payload.date
            : new Date().toISOString().slice(0, 10),
        fallback: false,
      };
    } catch {
      // Пробуем резервный источник ниже.
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    rates: FALLBACK_EXCHANGE_RATES,
    date: "резервный курс",
    fallback: true,
  };
}
