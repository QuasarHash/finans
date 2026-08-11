"use client";

import {
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Cloud,
  Copy,
  Download,
  FileJson,
  Filter,
  Flag,
  LayoutDashboard,
  List,
  Menu,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  PiggyBank,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";
import {
  createDemoState,
  createEmptyState,
  LEGACY_DEMO_OPERATION_IDS,
} from "@/lib/demo-data";
import {
  CURRENCIES,
  convertCurrency,
  FALLBACK_EXCHANGE_RATES,
  fetchExchangeRates,
  inferOperationBaseCurrency,
  rateBetween,
  rebaseOperations,
  type ExchangeRateSnapshot,
  type ExchangeRates,
} from "@/lib/exchange-rates";
import {
  clearFamilyCloudRecords,
  deleteCloudRecord,
  loadFamilyFromCloud,
  loadFamilyInviteCode,
  replaceFamilyCloudData,
  saveFamilyToCloud,
} from "@/lib/cloud-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  AppSection,
  Category,
  Currency,
  FamilyState,
  FamilyTask,
  Goal,
  Note,
  Operation,
  Person,
  TaskStatus,
  TransactionType,
} from "@/lib/types";

const STORAGE_KEY = "ivan-alina-family-center-v1";
const NOTE_DRAFT_KEY = `${STORAGE_KEY}-note-draft`;
const TODAY = "2026-08-11";
const CURRENT_MONTH = "2026-08";

const sections: Array<{
  id: AppSection;
  label: string;
  short: string;
  icon: LucideIcon;
}> = [
  {
    id: "dashboard",
    label: "Главная",
    short: "Главная",
    icon: LayoutDashboard,
  },
  { id: "operations", label: "Операции", short: "Операции", icon: WalletCards },
  { id: "budget", label: "Бюджет", short: "Бюджет", icon: PiggyBank },
  { id: "goals", label: "Цели", short: "Цели", icon: Target },
  { id: "plans", label: "Планы", short: "Планы", icon: ClipboardList },
  { id: "notes", label: "Заметки", short: "Заметки", icon: NotebookPen },
  { id: "settings", label: "Настройки", short: "Ещё", icon: Settings },
];

const formatMoney = (value: number, currency: Currency = "USD") =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(value);

const formatCompactMoney = (value: number, currency: Currency = "USD") =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T12:00:00`),
  );

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const categoryName = (categories: Category[], id: string) =>
  categories.find((item) => item.id === id)?.name ?? "Без категории";

const downloadFile = (name: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

type Toast = { id: number; message: string; tone: "success" | "error" };

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "Не удалось выполнить действие";
};

export default function FamilyCenter() {
  const [state, setState] = useState<FamilyState>(() =>
    isSupabaseConfigured ? createEmptyState() : createDemoState(),
  );
  const [section, setSection] = useState<AppSection>("dashboard");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [operationModal, setOperationModal] = useState<
    Operation | "new" | null
  >(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cloudSession, setCloudSession] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [rateSnapshot, setRateSnapshot] = useState<ExchangeRateSnapshot>({
    rates: FALLBACK_EXCHANGE_RATES,
    date: "загрузка",
    fallback: true,
  });
  const [ratesLoading, setRatesLoading] = useState(true);
  const cloudSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const legacyRepairNotice = useRef("");

  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      const id = Date.now();
      setToasts((items) => [...items, { id, message, tone }]);
      window.setTimeout(
        () => setToasts((items) => items.filter((item) => item.id !== id)),
        3200,
      );
    },
    [],
  );

  const refreshRates = useCallback(
    async (showNotice = false) => {
      setRatesLoading(true);
      const snapshot = await fetchExchangeRates();
      setRateSnapshot(snapshot);
      setRatesLoading(false);
      if (showNotice)
        notify(
          snapshot.fallback
            ? "Свежий курс недоступен — используется резервный"
            : "Курсы валют обновлены",
          snapshot.fallback ? "error" : "success",
        );
    },
    [notify],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRates(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshRates]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as FamilyState;
          setState({
            ...parsed,
            operations: isSupabaseConfigured
              ? parsed.operations.filter(
                  (operation) =>
                    !LEGACY_DEMO_OPERATION_IDS.some(
                      (demoId) => demoId === operation.id,
                    ),
                )
              : parsed.operations,
            budgets: parsed.budgets.map((budget) => ({
              ...budget,
              currency: budget.currency ?? "USD",
            })),
          });
        }
        const savedTheme = localStorage.getItem(`${STORAGE_KEY}-theme`);
        if (savedTheme === "light" || savedTheme === "dark")
          setTheme(savedTheme);
      } catch {
        notify("Не удалось прочитать локальные данные", "error");
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [notify]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(`${STORAGE_KEY}-theme`, theme);
  }, [theme]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (cloudSession && cloudReady && isSupabaseConfigured) {
      if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
      cloudSaveTimer.current = setTimeout(() => {
        saveFamilyToCloud(state).catch(() =>
          notify("Локально сохранено, синхронизация не выполнена", "error"),
        );
      }, 1200);
    }
    return () => {
      if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    };
  }, [state, hydrated, cloudSession, cloudReady, notify]);

  useEffect(() => {
    if (!hydrated || ratesLoading) return;
    const timer = window.setTimeout(() => {
      const storedBase = inferOperationBaseCurrency(
        state.operations,
        rateSnapshot.rates,
      );
      const needsLegacyRepair =
        storedBase !== null && storedBase !== state.baseCurrency;
      const needsOperationRebase = state.operations.some((operation) => {
        const expected = rateBetween(
          operation.currency,
          state.baseCurrency,
          rateSnapshot.rates,
        );
        return (
          Math.abs(operation.rate - expected) >
          Math.max(expected * 0.000001, 0.0000000001)
        );
      });
      if (!needsLegacyRepair && !needsOperationRebase) return;

      setState((current) => ({
        ...current,
        operations: rebaseOperations(
          current.operations,
          current.baseCurrency,
          rateSnapshot.rates,
        ),
      }));

      const repairKey = `${storedBase}->${state.baseCurrency}`;
      if (needsLegacyRepair && legacyRepairNotice.current !== repairKey) {
        legacyRepairNotice.current = repairKey;
        notify("Старые операции автоматически пересчитаны");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, ratesLoading, rateSnapshot, state, notify]);

  useEffect(() => {
    const client = supabase;
    if (!client || !hydrated) return;
    let active = true;
    const updateCloudSession = async (userId?: string) => {
      if (!userId) {
        if (active) {
          setCloudSession(false);
          setCloudReady(false);
        }
        return;
      }
      const { data, error } = await client
        .from("family_members")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setCloudSession(false);
        setCloudReady(false);
        return;
      }
      try {
        const cloud = await loadFamilyFromCloud(createEmptyState());
        if (!active) return;
        setState(cloud);
        setCloudSession(true);
        setCloudReady(true);
      } catch (loadError) {
        if (!active) return;
        setCloudSession(false);
        setCloudReady(false);
        notify(getErrorMessage(loadError), "error");
      }
    };
    client.auth
      .getSession()
      .then(({ data }) => updateCloudSession(data.session?.user.id));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void updateCloudSession(session?.user.id);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [hydrated, notify]);

  const handleCloudSession = (value: boolean) => {
    setCloudSession(value);
    setCloudReady(value);
  };

  const updateState = (updater: (current: FamilyState) => FamilyState) =>
    setState((current) => updater(current));

  const handleDelete = async (
    kind: "operation" | "budget" | "goal" | "task" | "note" | "category",
    id: string,
  ) => {
    if (cloudSession)
      deleteCloudRecord(kind, id).catch(() =>
        notify("Удалено локально, но не в облаке", "error"),
      );
  };

  const content = (() => {
    switch (section) {
      case "dashboard":
        return (
          <Dashboard
            state={state}
            exchangeRates={rateSnapshot.rates}
            setSection={setSection}
            onAdd={() => setOperationModal("new")}
          />
        );
      case "operations":
        return (
          <Operations
            state={state}
            setState={updateState}
            onAdd={() => setOperationModal("new")}
            onEdit={setOperationModal}
            onCloudDelete={handleDelete}
            notify={notify}
          />
        );
      case "budget":
        return (
          <BudgetSection
            state={state}
            exchangeRates={rateSnapshot.rates}
            setState={updateState}
            onCloudDelete={handleDelete}
            notify={notify}
          />
        );
      case "goals":
        return (
          <GoalsSection
            state={state}
            exchangeRates={rateSnapshot.rates}
            setState={updateState}
            onCloudDelete={handleDelete}
            notify={notify}
          />
        );
      case "plans":
        return (
          <PlansSection
            state={state}
            setState={updateState}
            onCloudDelete={handleDelete}
            notify={notify}
          />
        );
      case "notes":
        return (
          <NotesSection
            state={state}
            setState={updateState}
            onCloudDelete={handleDelete}
            notify={notify}
          />
        );
      case "settings":
        return (
          <SettingsSection
            state={state}
            setState={updateState}
            exchangeRates={rateSnapshot.rates}
            ratesDate={rateSnapshot.date}
            ratesFallback={rateSnapshot.fallback}
            ratesLoading={ratesLoading}
            onRefreshRates={() => void refreshRates(true)}
            theme={theme}
            setTheme={setTheme}
            cloudSession={cloudSession}
            onCloudSession={handleCloudSession}
            notify={notify}
          />
        );
    }
  })();

  const activeMeta = sections.find((item) => item.id === section)!;

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="Основная навигация"
      >
        <div className="brand-block">
          <div className="brand-mark">
            <span>И</span>
            <span>&</span>
            <span>А</span>
          </div>
          <div>
            <strong>Иван & Алина</strong>
            <small>семейный центр</small>
          </div>
          <button
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Закрыть меню"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="side-nav">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => {
                setSection(id);
                setSidebarOpen(false);
              }}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="family-mini">
            <span className="avatar avatar-ivan">И</span>
            <span className="avatar avatar-alina">А</span>
            <div>
              <strong>Наша семья</strong>
              <small>2 участника</small>
            </div>
          </div>
          <div className="safe-row">
            <ShieldCheck size={16} />
            <span>Данные защищены</span>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть меню"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="menu-button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Открыть меню"
            >
              <Menu size={22} />
            </button>
            <div>
              <span className="eyebrow">Семейное пространство</span>
              <h1>{activeMeta.label}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            {!cloudSession && (
              <button
                className="demo-badge"
                onClick={() => setSection("settings")}
              >
                <Sparkles size={14} /> Демо-режим
              </button>
            )}
            <button className="icon-button" aria-label="Уведомления">
              <Bell size={19} />
              <i />
            </button>
            <button
              className="user-switch"
              onClick={() =>
                updateState((current) => ({
                  ...current,
                  currentUser:
                    current.currentUser === "Иван" ? "Алина" : "Иван",
                }))
              }
            >
              <span
                className={`avatar ${state.currentUser === "Иван" ? "avatar-ivan" : "avatar-alina"}`}
              >
                {state.currentUser[0]}
              </span>
              <span>{state.currentUser}</span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <div className="page-content">
          {hydrated ? content : <LoadingState />}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {sections.map(({ id, short, icon: Icon }) => (
          <button
            key={id}
            className={section === id ? "active" : ""}
            onClick={() => setSection(id)}
          >
            <Icon size={20} />
            <span>{short}</span>
          </button>
        ))}
      </nav>

      {section === "operations" && (
        <button
          className="mobile-fab"
          onClick={() => setOperationModal("new")}
          aria-label="Добавить операцию"
        >
          <Plus size={24} />
        </button>
      )}

      {operationModal && (
        <OperationDialog
          initial={operationModal === "new" ? undefined : operationModal}
          state={state}
          exchangeRates={rateSnapshot.rates}
          onClose={() => setOperationModal(null)}
          onSave={(operation) => {
            updateState((current) => ({
              ...current,
              operations: current.operations.some(
                (item) => item.id === operation.id,
              )
                ? current.operations.map((item) =>
                    item.id === operation.id ? operation : item,
                  )
                : [operation, ...current.operations],
            }));
            setOperationModal(null);
            notify(
              operationModal === "new"
                ? "Операция добавлена"
                : "Операция обновлена",
            );
          }}
        />
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <Check size={17} />
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <span />
      <span />
      <span />
      <p>Открываем семейный центр…</p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

function Dashboard({
  state,
  exchangeRates,
  setSection,
  onAdd,
}: {
  state: FamilyState;
  exchangeRates: ExchangeRates;
  setSection: (section: AppSection) => void;
  onAdd: () => void;
}) {
  const monthOps = state.operations.filter((item) =>
    item.date.startsWith(CURRENT_MONTH),
  );
  const income = monthOps
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.baseAmount, 0);
  const expense = monthOps
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.baseAmount, 0);
  const allIncome = state.operations
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.baseAmount, 0);
  const allExpense = state.operations
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.baseAmount, 0);
  const personAmount = (person: Person, type: TransactionType) =>
    monthOps
      .filter((item) => item.person === person && item.type === type)
      .reduce((sum, item) => sum + item.baseAmount, 0);
  const monthBudget = state.budgets
    .filter((item) => item.month === CURRENT_MONTH)
    .reduce(
      (sum, item) =>
        sum +
        convertCurrency(
          item.limit,
          item.currency ?? "USD",
          state.baseCurrency,
          exchangeRates,
        ),
      0,
    );
  const budgetPercent = monthBudget
    ? Math.round((expense / monthBudget) * 100)
    : 0;

  const chartMonths = ["2026-05", "2026-06", "2026-07", "2026-08"].map(
    (month) => ({
      month: monthLabel(month).split(" ")[0].slice(0, 3),
      Доходы: Math.round(
        state.operations
          .filter(
            (item) => item.date.startsWith(month) && item.type === "income",
          )
          .reduce((sum, item) => sum + item.baseAmount, 0),
      ),
      Расходы: Math.round(
        state.operations
          .filter(
            (item) => item.date.startsWith(month) && item.type === "expense",
          )
          .reduce((sum, item) => sum + item.baseAmount, 0),
      ),
    }),
  );
  const categoryChart = state.categories
    .filter((category) => category.type === "expense")
    .map((category) => ({
      name: category.name,
      value: monthOps
        .filter(
          (item) => item.type === "expense" && item.categoryId === category.id,
        )
        .reduce((sum, item) => sum + item.baseAmount, 0),
      color: category.color,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  const peopleChart = (["Иван", "Алина", "Общее"] as Person[])
    .map((person, index) => ({
      name: person,
      value: personAmount(person, "expense"),
      color: ["#60a5fa", "#a78bfa", "#34d399"][index],
    }))
    .filter((item) => item.value > 0);
  const upcoming = state.tasks
    .filter((item) => item.status !== "done")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);
  const currencyBalances = CURRENCIES.map((currency) => ({
    currency,
    income: convertCurrency(
      allIncome,
      state.baseCurrency,
      currency,
      exchangeRates,
    ),
    expense: convertCurrency(
      allExpense,
      state.baseCurrency,
      currency,
      exchangeRates,
    ),
    balance: convertCurrency(
      allIncome - allExpense,
      state.baseCurrency,
      currency,
      exchangeRates,
    ),
  }));

  return (
    <div className="page-stack">
      <SectionHeading
        eyebrow="Август 2026"
        title={`Добрый день, ${state.currentUser}!`}
        description="Вот как выглядит ваш общий финансовый месяц."
        actions={
          <>
            <button
              className="button secondary"
              onClick={() => setSection("plans")}
            >
              <CalendarDays size={17} /> Планы
            </button>
            <button className="button primary" onClick={onAdd}>
              <Plus size={17} /> Новая операция
            </button>
          </>
        }
      />

      <section className="balance-hero">
        <div className="balance-copy">
          <span>Общий баланс</span>
          <strong>
            {formatMoney(allIncome - allExpense, state.baseCurrency)}
          </strong>
          <small>
            <TrendingUp size={15} /> +12,4% за этот месяц
          </small>
        </div>
        <div className="balance-divider" />
        <div className="balance-side">
          <span>Чистый результат августа</span>
          <strong className={income - expense >= 0 ? "positive" : "negative"}>
            {formatMoney(income - expense, state.baseCurrency)}
          </strong>
          <small>Доходы минус расходы</small>
        </div>
        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />
      </section>

      <section className="currency-balance-grid" aria-label="Баланс по валютам">
        {currencyBalances.map((item) => (
          <div className="currency-balance-card" key={item.currency}>
            <div>
              <span>
                {item.currency === "USD"
                  ? "Доллары"
                  : item.currency === "RUB"
                    ? "Рубли"
                    : "Донги"}
              </span>
              <em>{item.currency}</em>
            </div>
            <strong className={item.balance < 0 ? "negative" : ""}>
              {formatMoney(item.balance, item.currency)}
            </strong>
            <small>
              +{formatCompactMoney(item.income, item.currency)} · −
              {formatCompactMoney(item.expense, item.currency)}
            </small>
          </div>
        ))}
      </section>

      <section className="metric-grid">
        <MetricCard
          icon={ArrowDownRight}
          label="Доходы"
          value={formatMoney(income, state.baseCurrency)}
          detail="за август"
          tone="income"
        />
        <MetricCard
          icon={ArrowUpRight}
          label="Расходы"
          value={formatMoney(expense, state.baseCurrency)}
          detail="за август"
          tone="expense"
        />
        <MetricCard
          icon={Users}
          label="Иван"
          value={formatMoney(
            personAmount("Иван", "income") - personAmount("Иван", "expense"),
            state.baseCurrency,
          )}
          detail={`${formatCompactMoney(personAmount("Иван", "income"), state.baseCurrency)} доход · ${formatCompactMoney(personAmount("Иван", "expense"), state.baseCurrency)} расход`}
          tone="ivan"
        />
        <MetricCard
          icon={Users}
          label="Алина"
          value={formatMoney(
            personAmount("Алина", "income") - personAmount("Алина", "expense"),
            state.baseCurrency,
          )}
          detail={`${formatCompactMoney(personAmount("Алина", "income"), state.baseCurrency)} доход · ${formatCompactMoney(personAmount("Алина", "expense"), state.baseCurrency)} расход`}
          tone="alina"
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel wide">
          <PanelTitle
            title="Динамика финансов"
            subtitle="Доходы и расходы в базовой валюте"
            action="4 месяца"
          />
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartMonths}
                margin={{ top: 12, right: 8, left: -22, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="incomeGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="expenseGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#fb7185" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#fb7185" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 6"
                  vertical={false}
                  stroke="var(--line)"
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--panel-strong)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    color: "var(--text)",
                  }}
                  formatter={(value) =>
                    formatMoney(Number(value), state.baseCurrency)
                  }
                />
                <Area
                  type="monotone"
                  dataKey="Доходы"
                  stroke="#34d399"
                  strokeWidth={2.4}
                  fill="url(#incomeGradient)"
                />
                <Area
                  type="monotone"
                  dataKey="Расходы"
                  stroke="#fb7185"
                  strokeWidth={2.4}
                  fill="url(#expenseGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span>
              <i className="dot income" /> Доходы
            </span>
            <span>
              <i className="dot expense" /> Расходы
            </span>
          </div>
        </div>
        <div className="panel budget-ring-panel">
          <PanelTitle
            title="Месячный бюджет"
            subtitle={`${formatMoney(expense, state.baseCurrency)} из ${formatMoney(monthBudget, state.baseCurrency)}`}
            action="Август"
          />
          <div
            className="budget-ring"
            style={
              {
                "--progress": `${Math.min(budgetPercent, 100) * 3.6}deg`,
              } as React.CSSProperties
            }
          >
            <div>
              <strong>{budgetPercent}%</strong>
              <span>использовано</span>
            </div>
          </div>
          <div className="budget-ring-foot">
            <span>
              <i /> Осталось
            </span>
            <strong>
              {formatMoney(
                Math.max(monthBudget - expense, 0),
                state.baseCurrency,
              )}
            </strong>
          </div>
          <button className="text-button" onClick={() => setSection("budget")}>
            Открыть бюджет <ArrowUpRight size={15} />
          </button>
        </div>
      </section>

      <section className="dashboard-grid three">
        <div className="panel">
          <PanelTitle title="Расходы по категориям" subtitle="Август" />
          <div className="mini-bars">
            {categoryChart.map((item) => (
              <div key={item.name}>
                <span>{item.name}</span>
                <div>
                  <i
                    style={{
                      width: `${(item.value / Math.max(...categoryChart.map((x) => x.value))) * 100}%`,
                      background: item.color,
                    }}
                  />
                </div>
                <strong>
                  {formatCompactMoney(item.value, state.baseCurrency)}
                </strong>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <PanelTitle title="Кто тратит" subtitle="Личные и общие расходы" />
          <div className="donut-layout">
            <div className="donut-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={peopleChart}
                    dataKey="value"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={4}
                  >
                    {peopleChart.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) =>
                      formatMoney(Number(value), state.baseCurrency)
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <span>{formatCompactMoney(expense, state.baseCurrency)}</span>
            </div>
            <div className="donut-legend">
              {peopleChart.map((item) => (
                <div key={item.name}>
                  <i style={{ background: item.color }} />
                  <span>{item.name}</span>
                  <strong>
                    {expense ? Math.round((item.value / expense) * 100) : 0}%
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel upcoming-panel">
          <PanelTitle
            title="Ближайшие планы"
            subtitle="Следующие 14 дней"
            action="Все планы"
            onAction={() => setSection("plans")}
          />
          <div className="upcoming-list">
            {upcoming.map((task) => (
              <div key={task.id}>
                <span className={`date-chip ${task.priority}`}>
                  <strong>
                    {new Date(`${task.dueDate}T12:00:00`).getDate()}
                  </strong>
                  <small>авг</small>
                </span>
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {task.owner} · {task.category}
                  </small>
                </div>
                <MoreHorizontal size={18} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel last-operations">
        <PanelTitle
          title="Последние операции"
          subtitle="Свежие движения по семейным счетам"
          action="Все операции"
          onAction={() => setSection("operations")}
        />
        <OperationList
          operations={state.operations.slice(0, 5)}
          state={state}
        />
      </section>

      <section className="goal-strip">
        <div>
          <span className="goal-strip-icon">
            <Target size={22} />
          </span>
          <div>
            <span>Главная цель</span>
            <strong>{state.goals[0]?.title}</strong>
          </div>
        </div>
        <div className="goal-strip-progress">
          <div>
            <i
              style={{
                width: `${Math.min(((state.goals[0]?.current ?? 0) / (state.goals[0]?.target || 1)) * 100, 100)}%`,
              }}
            />
          </div>
          <span>
            {Math.round(
              ((state.goals[0]?.current ?? 0) / (state.goals[0]?.target || 1)) *
                100,
            )}
            %
          </span>
        </div>
        <strong>
          {formatMoney(
            state.goals[0]?.current ?? 0,
            state.goals[0]?.currency ?? state.baseCurrency,
          )}{" "}
          <small>
            из{" "}
            {formatMoney(
              state.goals[0]?.target ?? 0,
              state.goals[0]?.currency ?? state.baseCurrency,
            )}
          </small>
        </strong>
        <button
          className="button secondary"
          onClick={() => setSection("goals")}
        >
          Подробнее
        </button>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">
        <Icon size={20} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function PanelTitle({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="panel-title">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && (
        <button onClick={onAction}>
          {action}
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}

function OperationList({
  operations,
  state,
}: {
  operations: Operation[];
  state: FamilyState;
}) {
  if (!operations.length)
    return (
      <EmptyState
        icon={WalletCards}
        title="Операций пока нет"
        text="Добавьте первый доход или расход."
      />
    );
  return (
    <div className="operation-list">
      {operations.map((operation) => {
        const expense = operation.type === "expense";
        return (
          <div className="operation-row" key={operation.id}>
            <div className={`operation-icon ${expense ? "expense" : "income"}`}>
              {expense ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
            </div>
            <div className="operation-main">
              <strong>
                {categoryName(state.categories, operation.categoryId)}
              </strong>
              <span>{operation.comment || operation.account}</span>
            </div>
            <span
              className={`person-pill person-${operation.person.toLowerCase()}`}
            >
              {operation.person}
            </span>
            <span className="operation-date">{formatDate(operation.date)}</span>
            <div className="operation-amount">
              <strong className={expense ? "negative" : "positive"}>
                {expense ? "−" : "+"}
                {formatMoney(operation.baseAmount, state.baseCurrency)}
              </strong>
              {operation.currency !== state.baseCurrency && (
                <small>
                  {formatMoney(operation.amount, operation.currency)}
                </small>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={25} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

function Operations({
  state,
  setState,
  onAdd,
  onEdit,
  onCloudDelete,
  notify,
}: {
  state: FamilyState;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  onAdd: () => void;
  onEdit: (operation: Operation) => void;
  onCloudDelete: (kind: "operation", id: string) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | TransactionType>("all");
  const [person, setPerson] = useState<"all" | Person>("all");
  const [currency, setCurrency] = useState<"all" | Currency>("all");
  const [category, setCategory] = useState("all");
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [sort, setSort] = useState<"new" | "old" | "high" | "low">("new");
  const [deleteTarget, setDeleteTarget] = useState<Operation | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return state.operations
      .filter((item) => {
        const haystack =
          `${item.comment} ${item.account} ${categoryName(state.categories, item.categoryId)}`.toLocaleLowerCase(
            "ru",
          );
        return (
          (!normalized || haystack.includes(normalized)) &&
          (type === "all" || item.type === type) &&
          (person === "all" || item.person === person) &&
          (currency === "all" || item.currency === currency) &&
          (category === "all" || item.categoryId === category) &&
          (!month || item.date.startsWith(month))
        );
      })
      .sort((a, b) => {
        if (sort === "high") return b.baseAmount - a.baseAmount;
        if (sort === "low") return a.baseAmount - b.baseAmount;
        return sort === "old"
          ? a.date.localeCompare(b.date)
          : b.date.localeCompare(a.date);
      });
  }, [
    state.operations,
    state.categories,
    query,
    type,
    person,
    currency,
    category,
    month,
    sort,
  ]);
  const total = filtered.reduce(
    (sum, item) =>
      sum + (item.type === "income" ? item.baseAmount : -item.baseAmount),
    0,
  );

  return (
    <div className="page-stack">
      <SectionHeading
        eyebrow="Учёт денег"
        title="Операции"
        description="Доходы и расходы Ивана, Алины и семьи."
        actions={
          <button className="button primary" onClick={onAdd}>
            <Plus size={17} /> Добавить операцию
          </button>
        }
      />
      <div className="filter-panel">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по комментарию, счёту или категории"
            aria-label="Поиск операций"
          />
        </label>
        <label>
          <span>Месяц</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label>
          <span>Тип</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            <option value="all">Все</option>
            <option value="income">Доходы</option>
            <option value="expense">Расходы</option>
          </select>
        </label>
        <label>
          <span>Участник</span>
          <select
            value={person}
            onChange={(event) => setPerson(event.target.value as typeof person)}
          >
            <option value="all">Все</option>
            <option>Иван</option>
            <option>Алина</option>
            <option>Общее</option>
          </select>
        </label>
        <label>
          <span>Валюта</span>
          <select
            value={currency}
            onChange={(event) =>
              setCurrency(event.target.value as typeof currency)
            }
          >
            <option value="all">Все</option>
            <option>USD</option>
            <option>RUB</option>
            <option>VND</option>
          </select>
        </label>
        <label>
          <span>Категория</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">Все</option>
            {state.categories
              .filter((item) => !item.archived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="result-bar">
        <div>
          <Filter size={16} />
          <span>
            Найдено: <strong>{filtered.length}</strong>
          </span>
        </div>
        <div className="filter-total">
          Итог по фильтрам{" "}
          <strong className={total >= 0 ? "positive" : "negative"}>
            {formatMoney(total, state.baseCurrency)}
          </strong>
        </div>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          aria-label="Сортировка"
        >
          <option value="new">Сначала новые</option>
          <option value="old">Сначала старые</option>
          <option value="high">Сначала крупные</option>
          <option value="low">Сначала небольшие</option>
        </select>
      </div>
      <div className="panel operations-table-panel">
        {!filtered.length ? (
          <EmptyState
            icon={Search}
            title="Ничего не найдено"
            text="Попробуйте изменить фильтры или добавьте новую операцию."
            action={
              <button className="button primary" onClick={onAdd}>
                <Plus size={16} /> Добавить
              </button>
            }
          />
        ) : (
          <div className="operations-table">
            <div className="table-head">
              <span>Операция</span>
              <span>Участник</span>
              <span>Дата</span>
              <span>Счёт</span>
              <span>Сумма</span>
              <span />
            </div>
            {filtered.map((operation) => {
              const isExpense = operation.type === "expense";
              return (
                <div className="table-row" key={operation.id}>
                  <div className="table-operation">
                    <span
                      className={`operation-icon ${isExpense ? "expense" : "income"}`}
                    >
                      {isExpense ? (
                        <TrendingDown size={17} />
                      ) : (
                        <TrendingUp size={17} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {categoryName(state.categories, operation.categoryId)}
                      </strong>
                      <small>{operation.comment || "Без комментария"}</small>
                    </div>
                  </div>
                  <span
                    className={`person-pill person-${operation.person.toLowerCase()}`}
                  >
                    {operation.person}
                  </span>
                  <span>{formatDate(operation.date)}</span>
                  <span>{operation.account}</span>
                  <div className="table-amount">
                    <strong className={isExpense ? "negative" : "positive"}>
                      {isExpense ? "−" : "+"}
                      {formatMoney(operation.baseAmount, state.baseCurrency)}
                    </strong>
                    <small>
                      {formatMoney(operation.amount, operation.currency)} · курс{" "}
                      {operation.rate}
                    </small>
                  </div>
                  <div className="row-actions">
                    <button
                      onClick={() => onEdit(operation)}
                      aria-label="Редактировать"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(operation)}
                      aria-label="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {deleteTarget && (
        <ConfirmDialog
          title="Удалить операцию?"
          text={`Операция «${categoryName(state.categories, deleteTarget.categoryId)}» будет удалена без возможности восстановления.`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const id = deleteTarget.id;
            setState((current) => ({
              ...current,
              operations: current.operations.filter((item) => item.id !== id),
            }));
            onCloudDelete("operation", id);
            setDeleteTarget(null);
            notify("Операция удалена");
          }}
        />
      )}
    </div>
  );
}

const operationSchema = z.object({
  amount: z.number().positive("Введите сумму больше нуля"),
  rate: z.number().positive("Курс должен быть больше нуля"),
  comment: z.string().max(120, "Не более 120 символов"),
  account: z.string().min(1, "Укажите счёт"),
});

function OperationDialog({
  initial,
  state,
  exchangeRates,
  onClose,
  onSave,
}: {
  initial?: Operation;
  state: FamilyState;
  exchangeRates: ExchangeRates;
  onClose: () => void;
  onSave: (operation: Operation) => void;
}) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [currency, setCurrency] = useState<Currency>(
    initial?.currency ?? state.baseCurrency,
  );
  const [rate, setRate] = useState(
    String(
      initial?.rate ??
        rateBetween(
          initial?.currency ?? state.baseCurrency,
          state.baseCurrency,
          exchangeRates,
        ),
    ),
  );
  const [date, setDate] = useState(initial?.date ?? TODAY);
  const [person, setPerson] = useState<Person>(initial?.person ?? "Общее");
  const filteredCategories = state.categories.filter(
    (item) => item.type === type && !item.archived,
  );
  const [categoryId, setCategoryId] = useState(
    initial?.categoryId ?? filteredCategories[0]?.id ?? "",
  );
  const [account, setAccount] = useState(initial?.account ?? "Карта USD");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [error, setError] = useState("");
  const converted = (Number(amount) || 0) * (Number(rate) || 0);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div
        className="dialog operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-dialog-title"
      >
        <div className="dialog-head">
          <div>
            <span className="eyebrow">
              {initial ? "Редактирование" : "Новая запись"}
            </span>
            <h2 id="operation-dialog-title">
              {initial ? "Изменить операцию" : "Добавить операцию"}
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = operationSchema.safeParse({
              amount: Number(amount),
              rate: Number(rate),
              comment,
              account,
            });
            if (!parsed.success || !categoryId) {
              setError(
                parsed.error?.issues[0]?.message ?? "Выберите категорию",
              );
              return;
            }
            onSave({
              id: initial?.id ?? uid("op"),
              type,
              amount: parsed.data.amount,
              currency,
              rate: parsed.data.rate,
              baseAmount: parsed.data.amount * parsed.data.rate,
              date,
              person,
              categoryId,
              account: parsed.data.account,
              comment: parsed.data.comment,
              createdAt: initial?.createdAt ?? new Date().toISOString(),
              author: initial?.author ?? state.currentUser,
            });
          }}
        >
          <div className="segmented">
            <button
              type="button"
              className={type === "expense" ? "active expense" : ""}
              onClick={() => {
                setType("expense");
                setCategoryId(
                  state.categories.find(
                    (item) => item.type === "expense" && !item.archived,
                  )?.id ?? "",
                );
              }}
            >
              <ArrowUpRight size={17} /> Расход
            </button>
            <button
              type="button"
              className={type === "income" ? "active income" : ""}
              onClick={() => {
                setType("income");
                setCategoryId(
                  state.categories.find(
                    (item) => item.type === "income" && !item.archived,
                  )?.id ?? "",
                );
              }}
            >
              <ArrowDownRight size={17} /> Доход
            </button>
          </div>
          <div className="form-grid">
            <label>
              <span>Сумма</span>
              <input
                min="0.01"
                step="any"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
                required
              />
            </label>
            <label>
              <span>Валюта</span>
              <select
                value={currency}
                onChange={(event) => {
                  const next = event.target.value as Currency;
                  setCurrency(next);
                  setRate(
                    String(
                      rateBetween(next, state.baseCurrency, exchangeRates),
                    ),
                  );
                }}
              >
                <option>USD</option>
                <option>RUB</option>
                <option>VND</option>
              </select>
            </label>
            <label>
              <span>Курс к {state.baseCurrency}</span>
              <input
                min="0.0000001"
                step="any"
                type="number"
                value={rate}
                readOnly
                title="Курс обновляется автоматически"
                required
              />
              <small>Автоматический курс</small>
            </label>
            <div className="conversion-preview">
              <span>В базовой валюте</span>
              <strong>{formatMoney(converted, state.baseCurrency)}</strong>
            </div>
            <label>
              <span>Дата</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Участник</span>
              <select
                value={person}
                onChange={(event) => setPerson(event.target.value as Person)}
              >
                <option>Иван</option>
                <option>Алина</option>
                <option>Общее</option>
              </select>
            </label>
            <label>
              <span>Категория</span>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                required
              >
                {filteredCategories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Счёт / способ оплаты</span>
              <input
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="Например, Wise"
                required
              />
            </label>
            <label className="full">
              <span>
                Комментарий <small>{comment.length}/120</small>
              </span>
              <input
                value={comment}
                maxLength={120}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Коротко о назначении операции"
              />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Отмена
            </button>
            <button type="submit" className="button primary">
              {initial ? "Сохранить" : "Добавить операцию"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  text,
  onCancel,
  onConfirm,
}: {
  title: string;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
      >
        <span className="danger-icon">
          <Trash2 size={22} />
        </span>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="dialog-actions">
          <button className="button secondary" onClick={onCancel}>
            Отмена
          </button>
          <button className="button danger" onClick={onConfirm}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

function BudgetSection({
  state,
  exchangeRates,
  setState,
  onCloudDelete,
  notify,
}: {
  state: FamilyState;
  exchangeRates: ExchangeRates;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  onCloudDelete: (kind: "budget", id: string) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [categoryId, setCategoryId] = useState(
    state.categories.find((item) => item.type === "expense" && !item.archived)
      ?.id ?? "",
  );
  const [limit, setLimit] = useState("");
  const monthBudgets = state.budgets.filter((item) => item.month === month);
  const rows = monthBudgets
    .map((budget) => {
      const spent = state.operations
        .filter(
          (item) =>
            item.type === "expense" &&
            item.categoryId === budget.categoryId &&
            item.date.startsWith(month),
        )
        .reduce((sum, item) => sum + item.baseAmount, 0);
      const convertedLimit = convertCurrency(
        budget.limit,
        budget.currency ?? "USD",
        state.baseCurrency,
        exchangeRates,
      );
      return {
        ...budget,
        spent,
        convertedLimit,
        percent: Math.round((spent / convertedLimit) * 100),
        category: categoryName(state.categories, budget.categoryId),
      };
    })
    .sort((a, b) => b.percent - a.percent);
  const totalLimit = rows.reduce((sum, item) => sum + item.convertedLimit, 0);
  const totalSpent = rows.reduce((sum, item) => sum + item.spent, 0);
  const availableCategories = state.categories.filter(
    (item) =>
      item.type === "expense" &&
      !item.archived &&
      !monthBudgets.some((budget) => budget.categoryId === item.id),
  );

  const copyPrevious = () => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() - 1);
    const previous = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const source = state.budgets.filter((item) => item.month === previous);
    if (!source.length) {
      notify("В предыдущем месяце лимитов нет", "error");
      return;
    }
    setState((current) => ({
      ...current,
      budgets: [
        ...current.budgets.filter((item) => item.month !== month),
        ...source.map((item) => ({ ...item, id: uid("budget"), month })),
      ],
    }));
    notify("Лимиты предыдущего месяца скопированы");
  };

  return (
    <div className="page-stack">
      <SectionHeading
        eyebrow="Контроль расходов"
        title="Бюджет на месяц"
        description="Лимиты по категориям и раннее предупреждение о перерасходе."
        actions={
          <>
            <label className="month-control">
              <CalendarDays size={16} />
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <button className="button secondary" onClick={copyPrevious}>
              <Copy size={16} /> Копировать прошлый
            </button>
          </>
        }
      />
      <section className="budget-summary-grid">
        <div className="summary-card">
          <span>Общий лимит</span>
          <strong>{formatMoney(totalLimit, state.baseCurrency)}</strong>
          <small>{rows.length} категорий</small>
        </div>
        <div className="summary-card">
          <span>Потрачено</span>
          <strong>{formatMoney(totalSpent, state.baseCurrency)}</strong>
          <small>
            {totalLimit ? Math.round((totalSpent / totalLimit) * 100) : 0}%
            бюджета
          </small>
        </div>
        <div className="summary-card">
          <span>Осталось</span>
          <strong className={totalSpent > totalLimit ? "negative" : "positive"}>
            {formatMoney(totalLimit - totalSpent, state.baseCurrency)}
          </strong>
          <small>
            {totalSpent > totalLimit ? "Лимит превышен" : "До конца месяца"}
          </small>
        </div>
      </section>
      <section className="panel budget-table-panel">
        <PanelTitle
          title={`Лимиты — ${monthLabel(month)}`}
          subtitle="Цвет меняется по мере использования бюджета"
        />
        {!rows.length ? (
          <EmptyState
            icon={PiggyBank}
            title="Лимиты не заданы"
            text="Добавьте первый лимит для категории ниже."
          />
        ) : (
          <div className="budget-rows">
            {rows.map((row) => {
              const tone =
                row.percent > 90
                  ? "red"
                  : row.percent >= 70
                    ? "yellow"
                    : "green";
              return (
                <div className="budget-row" key={row.id}>
                  <div className="budget-name">
                    <i
                      style={{
                        background: state.categories.find(
                          (item) => item.id === row.categoryId,
                        )?.color,
                      }}
                    />
                    <div>
                      <strong>{row.category}</strong>
                      <small>
                        {row.percent > 100
                          ? `Перерасход ${formatMoney(row.spent - row.convertedLimit, state.baseCurrency)}`
                          : `Осталось ${formatMoney(row.convertedLimit - row.spent, state.baseCurrency)}`}
                      </small>
                    </div>
                  </div>
                  <div className="budget-progress">
                    <div>
                      <i
                        className={tone}
                        style={{ width: `${Math.min(row.percent, 100)}%` }}
                      />
                    </div>
                    <span>{row.percent}%</span>
                  </div>
                  <div className="budget-values">
                    <strong>
                      {formatMoney(row.spent, state.baseCurrency)}
                    </strong>
                    <small>
                      из {formatMoney(row.convertedLimit, state.baseCurrency)}
                      {(row.currency ?? "USD") !== state.baseCurrency && (
                        <> · {formatMoney(row.limit, row.currency ?? "USD")}</>
                      )}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => {
                      if (!window.confirm(`Удалить лимит «${row.category}»?`))
                        return;
                      setState((current) => ({
                        ...current,
                        budgets: current.budgets.filter(
                          (item) => item.id !== row.id,
                        ),
                      }));
                      onCloudDelete("budget", row.id);
                    }}
                    aria-label="Удалить лимит"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <form
        className="panel add-budget-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(limit);
          if (!categoryId || value <= 0) {
            notify("Выберите категорию и укажите положительный лимит", "error");
            return;
          }
          setState((current) => ({
            ...current,
            budgets: [
              ...current.budgets,
              {
                id: uid("budget"),
                month,
                categoryId,
                limit: value,
                currency: current.baseCurrency,
              },
            ],
          }));
          setLimit("");
          notify("Лимит добавлен");
        }}
      >
        <div>
          <span className="eyebrow">Новый лимит</span>
          <h3>Добавить категорию в бюджет</h3>
        </div>
        <label>
          <span>Категория</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={!availableCategories.length}
          >
            {availableCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Лимит, {state.baseCurrency}</span>
          <input
            type="number"
            min="0.01"
            step="any"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            placeholder="0"
          />
        </label>
        <button
          className="button primary"
          type="submit"
          disabled={!availableCategories.length}
        >
          <Plus size={16} /> Добавить
        </button>
      </form>
    </div>
  );
}

function GoalsSection({
  state,
  exchangeRates,
  setState,
  onCloudDelete,
  notify,
}: {
  state: FamilyState;
  exchangeRates: ExchangeRates;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  onCloudDelete: (kind: "goal", id: string) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [modal, setModal] = useState<Goal | "new" | null>(null);
  const [status, setStatus] = useState<"all" | Goal["status"]>("all");
  const goals = state.goals.filter(
    (goal) => status === "all" || goal.status === status,
  );
  const activeTotal = state.goals.filter(
    (item) => item.status === "active",
  ).length;
  const achieved = state.goals.filter((item) => item.status === "done").length;

  return (
    <div className="page-stack">
      <SectionHeading
        eyebrow="Большие планы"
        title="Финансовые цели"
        description="Видимый прогресс помогает двигаться к важному вместе."
        actions={
          <button className="button primary" onClick={() => setModal("new")}>
            <Plus size={17} /> Новая цель
          </button>
        }
      />
      <div className="goals-overview">
        <div>
          <Target size={22} />
          <span>
            Активных целей<strong>{activeTotal}</strong>
          </span>
        </div>
        <div>
          <Flag size={22} />
          <span>
            Выполнено<strong>{achieved}</strong>
          </span>
        </div>
        <div>
          <CircleDollarSign size={22} />
          <span>
            Накоплено всего
            <strong>
              {formatCompactMoney(
                state.goals.reduce(
                  (sum, item) =>
                    sum +
                    convertCurrency(
                      item.current,
                      item.currency,
                      state.baseCurrency,
                      exchangeRates,
                    ),
                  0,
                ),
                state.baseCurrency,
              )}
            </strong>
          </span>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="paused">Приостановлены</option>
          <option value="done">Выполнены</option>
        </select>
      </div>
      {!goals.length ? (
        <div className="panel">
          <EmptyState
            icon={Target}
            title="Здесь появятся цели"
            text="Создайте первую цель и начните отмечать прогресс."
          />
        </div>
      ) : (
        <div className="goals-grid">
          {goals.map((goal) => {
            const progress = Math.min(
              Math.round((goal.current / goal.target) * 100),
              100,
            );
            return (
              <article
                className="goal-card"
                key={goal.id}
                style={{ "--goal-color": goal.color } as React.CSSProperties}
              >
                <div className="goal-card-head">
                  <span>
                    <Target size={20} />
                  </span>
                  <div>
                    <em className={`status-pill ${goal.status}`}>
                      {goal.status === "active"
                        ? "Активна"
                        : goal.status === "done"
                          ? "Выполнена"
                          : "На паузе"}
                    </em>
                    <h3>{goal.title}</h3>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setModal(goal)}
                    aria-label="Редактировать цель"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <p>{goal.description}</p>
                <div className="goal-money">
                  <strong>{formatMoney(goal.current, goal.currency)}</strong>
                  <span>из {formatMoney(goal.target, goal.currency)}</span>
                </div>
                <div className="goal-progress">
                  <div>
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <strong>{progress}%</strong>
                </div>
                <div className="goal-details">
                  <span>
                    Осталось{" "}
                    <strong>
                      {formatMoney(
                        Math.max(goal.target - goal.current, 0),
                        goal.currency,
                      )}
                    </strong>
                  </span>
                  <span>
                    Срок <strong>{formatDate(goal.deadline)}</strong>
                  </span>
                  <span>
                    Ответственный <strong>{goal.owner}</strong>
                  </span>
                </div>
                <div className="goal-actions">
                  <button
                    className="button secondary"
                    onClick={() => {
                      const raw = window.prompt("Сколько добавить?", "100");
                      const amount = Number(raw);
                      if (!amount || amount < 0) return;
                      setState((current) => ({
                        ...current,
                        goals: current.goals.map((item) =>
                          item.id === goal.id
                            ? {
                                ...item,
                                current: Math.min(
                                  item.current + amount,
                                  item.target,
                                ),
                                status:
                                  item.current + amount >= item.target
                                    ? "done"
                                    : item.status,
                              }
                            : item,
                        ),
                      }));
                      notify("Прогресс цели обновлён");
                    }}
                  >
                    + Пополнить
                  </button>
                  <button
                    className="icon-button danger-hover"
                    onClick={() => {
                      if (!window.confirm(`Удалить цель «${goal.title}»?`))
                        return;
                      setState((current) => ({
                        ...current,
                        goals: current.goals.filter(
                          (item) => item.id !== goal.id,
                        ),
                      }));
                      onCloudDelete("goal", goal.id);
                    }}
                    aria-label="Удалить цель"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {modal && (
        <GoalDialog
          initial={modal === "new" ? undefined : modal}
          state={state}
          onClose={() => setModal(null)}
          onSave={(goal) => {
            setState((current) => ({
              ...current,
              goals: current.goals.some((item) => item.id === goal.id)
                ? current.goals.map((item) =>
                    item.id === goal.id ? goal : item,
                  )
                : [goal, ...current.goals],
            }));
            setModal(null);
            notify("Цель сохранена");
          }}
        />
      )}
    </div>
  );
}

function GoalDialog({
  initial,
  state,
  onClose,
  onSave,
}: {
  initial?: Goal;
  state: FamilyState;
  onClose: () => void;
  onSave: (goal: Goal) => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    target: String(initial?.target ?? ""),
    current: String(initial?.current ?? 0),
    currency: initial?.currency ?? state.baseCurrency,
    deadline: initial?.deadline ?? "2026-12-31",
    owner: initial?.owner ?? "Вместе",
    status: initial?.status ?? "active",
    color: initial?.color ?? "#34d399",
  });
  const patch = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">Финансовая цель</span>
            <h2>{initial ? "Редактировать цель" : "Новая цель"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !form.title.trim() ||
              Number(form.target) <= 0 ||
              Number(form.current) < 0
            )
              return;
            onSave({
              id: initial?.id ?? uid("goal"),
              title: form.title.trim(),
              description: form.description.trim(),
              target: Number(form.target),
              current: Number(form.current),
              currency: form.currency as Currency,
              deadline: form.deadline,
              owner: form.owner as Goal["owner"],
              status: form.status as Goal["status"],
              color: form.color,
              icon: "target",
            });
          }}
        >
          <div className="form-grid">
            <label className="full">
              <span>Название</span>
              <input
                value={form.title}
                onChange={(event) => patch("title", event.target.value)}
                required
              />
            </label>
            <label className="full">
              <span>Описание</span>
              <textarea
                value={form.description}
                onChange={(event) => patch("description", event.target.value)}
                rows={3}
              />
            </label>
            <label>
              <span>Целевая сумма</span>
              <input
                type="number"
                min="0.01"
                step="any"
                value={form.target}
                onChange={(event) => patch("target", event.target.value)}
                required
              />
            </label>
            <label>
              <span>Уже накоплено</span>
              <input
                type="number"
                min="0"
                step="any"
                value={form.current}
                onChange={(event) => patch("current", event.target.value)}
              />
            </label>
            <label>
              <span>Валюта</span>
              <select
                value={form.currency}
                onChange={(event) =>
                  patch("currency", event.target.value as Currency)
                }
              >
                <option>USD</option>
                <option>RUB</option>
                <option>VND</option>
              </select>
            </label>
            <label>
              <span>Срок</span>
              <input
                type="date"
                value={form.deadline}
                onChange={(event) => patch("deadline", event.target.value)}
              />
            </label>
            <label>
              <span>Ответственный</span>
              <select
                value={form.owner}
                onChange={(event) =>
                  patch("owner", event.target.value as Goal["owner"])
                }
              >
                <option>Иван</option>
                <option>Алина</option>
                <option>Вместе</option>
              </select>
            </label>
            <label>
              <span>Статус</span>
              <select
                value={form.status}
                onChange={(event) =>
                  patch("status", event.target.value as Goal["status"])
                }
              >
                <option value="active">Активна</option>
                <option value="paused">Приостановлена</option>
                <option value="done">Выполнена</option>
              </select>
            </label>
            <label>
              <span>Цвет</span>
              <input
                type="color"
                value={form.color}
                onChange={(event) => patch("color", event.target.value)}
              />
            </label>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Отмена
            </button>
            <button className="button primary" type="submit">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const taskStatusMeta: Record<TaskStatus, { label: string; next: TaskStatus }> =
  {
    planned: { label: "Запланировано", next: "progress" },
    progress: { label: "В работе", next: "done" },
    done: { label: "Выполнено", next: "planned" },
  };

function PlansSection({
  state,
  setState,
  onCloudDelete,
  notify,
}: {
  state: FamilyState;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  onCloudDelete: (kind: "task", id: string) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [view, setView] = useState<"list" | "board">("board");
  const [owner, setOwner] = useState<"all" | FamilyTask["owner"]>("all");
  const [status, setStatus] = useState<"all" | TaskStatus>("all");
  const [deadline, setDeadline] = useState<"all" | "overdue" | "week">("all");
  const [modal, setModal] = useState<FamilyTask | "new" | null>(null);
  const filtered = state.tasks.filter((task) => {
    const inWeek = task.dueDate >= TODAY && task.dueDate <= "2026-08-18";
    return (
      (owner === "all" || task.owner === owner) &&
      (status === "all" || task.status === status) &&
      (deadline === "all" ||
        (deadline === "overdue"
          ? task.dueDate < TODAY && task.status !== "done"
          : inWeek))
    );
  });
  const advance = (task: FamilyTask) => {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id
          ? { ...item, status: taskStatusMeta[item.status].next }
          : item,
      ),
    }));
    notify("Статус задачи обновлён");
  };
  const taskCard = (task: FamilyTask) => {
    const overdue = task.dueDate < TODAY && task.status !== "done";
    return (
      <article
        className={`task-card ${overdue ? "overdue" : ""}`}
        key={task.id}
      >
        <div className="task-top">
          <span className={`priority-dot ${task.priority}`} />{" "}
          <span>{task.category}</span>
          <button className="icon-button" onClick={() => setModal(task)}>
            <Pencil size={15} />
          </button>
        </div>
        <h3>{task.title}</h3>
        <p>{task.description}</p>
        <div className="task-meta">
          <span className={overdue ? "negative" : ""}>
            <CalendarDays size={14} />
            {overdue ? "Просрочено · " : ""}
            {formatDate(task.dueDate)}
          </span>
          <span className={`owner-chip owner-${task.owner.toLowerCase()}`}>
            {task.owner}
          </span>
        </div>
        <button className="task-status-button" onClick={() => advance(task)}>
          {task.status === "done" && <Check size={15} />}
          {taskStatusMeta[task.status].label}
          <ArrowUpRight size={14} />
        </button>
        <button
          className="task-delete"
          onClick={() => {
            if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
            setState((current) => ({
              ...current,
              tasks: current.tasks.filter((item) => item.id !== task.id),
            }));
            onCloudDelete("task", task.id);
          }}
          aria-label="Удалить задачу"
        >
          <Trash2 size={14} />
        </button>
      </article>
    );
  };

  return (
    <div className="page-stack">
      <SectionHeading
        eyebrow="Совместный ритм"
        title="Планы и задачи"
        description="Все важные дела семьи в одном спокойном пространстве."
        actions={
          <button className="button primary" onClick={() => setModal("new")}>
            <Plus size={17} /> Новая задача
          </button>
        }
      />
      <div className="plan-toolbar">
        <div className="view-toggle">
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            <BarChart3 size={16} /> Доска
          </button>
          <button
            className={view === "list" ? "active" : ""}
            onClick={() => setView("list")}
          >
            <List size={16} /> Список
          </button>
        </div>
        <label>
          <Users size={15} />
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value as typeof owner)}
          >
            <option value="all">Все ответственные</option>
            <option>Иван</option>
            <option>Алина</option>
            <option>Вместе</option>
          </select>
        </label>
        <label>
          <Flag size={15} />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="all">Все статусы</option>
            <option value="planned">Запланировано</option>
            <option value="progress">В работе</option>
            <option value="done">Выполнено</option>
          </select>
        </label>
        <label>
          <CalendarDays size={15} />
          <select
            value={deadline}
            onChange={(event) =>
              setDeadline(event.target.value as typeof deadline)
            }
          >
            <option value="all">Все сроки</option>
            <option value="week">На этой неделе</option>
            <option value="overdue">Просроченные</option>
          </select>
        </label>
      </div>
      {!filtered.length ? (
        <div className="panel">
          <EmptyState
            icon={ClipboardList}
            title="Задач по фильтрам нет"
            text="Измените фильтры или создайте новую задачу."
          />
        </div>
      ) : view === "board" ? (
        <div className="kanban-board">
          {(["planned", "progress", "done"] as TaskStatus[]).map((column) => (
            <section className={`kanban-column ${column}`} key={column}>
              <header>
                <div>
                  <i />
                  {taskStatusMeta[column].label}
                </div>
                <span>
                  {filtered.filter((item) => item.status === column).length}
                </span>
              </header>
              <div>
                {filtered
                  .filter((item) => item.status === column)
                  .map(taskCard)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="task-list">{filtered.map(taskCard)}</div>
      )}
      {modal && (
        <TaskDialog
          initial={modal === "new" ? undefined : modal}
          onClose={() => setModal(null)}
          onSave={(task) => {
            setState((current) => ({
              ...current,
              tasks: current.tasks.some((item) => item.id === task.id)
                ? current.tasks.map((item) =>
                    item.id === task.id ? task : item,
                  )
                : [task, ...current.tasks],
            }));
            setModal(null);
            notify("Задача сохранена");
          }}
        />
      )}
    </div>
  );
}

function TaskDialog({
  initial,
  onClose,
  onSave,
}: {
  initial?: FamilyTask;
  onClose: () => void;
  onSave: (task: FamilyTask) => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    owner: initial?.owner ?? "Вместе",
    dueDate: initial?.dueDate ?? "2026-08-20",
    priority: initial?.priority ?? "medium",
    status: initial?.status ?? "planned",
    category: initial?.category ?? "Дом",
  });
  const patch = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">Планировщик</span>
            <h2>{initial ? "Редактировать задачу" : "Новая задача"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.title.trim()) return;
            onSave({
              id: initial?.id ?? uid("task"),
              title: form.title.trim(),
              description: form.description.trim(),
              owner: form.owner as FamilyTask["owner"],
              dueDate: form.dueDate,
              priority: form.priority as FamilyTask["priority"],
              status: form.status as FamilyTask["status"],
              category: form.category.trim() || "Другое",
              createdAt: initial?.createdAt ?? new Date().toISOString(),
            });
          }}
        >
          <div className="form-grid">
            <label className="full">
              <span>Название</span>
              <input
                value={form.title}
                onChange={(event) => patch("title", event.target.value)}
                required
              />
            </label>
            <label className="full">
              <span>Описание</span>
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => patch("description", event.target.value)}
              />
            </label>
            <label>
              <span>Ответственный</span>
              <select
                value={form.owner}
                onChange={(event) =>
                  patch("owner", event.target.value as FamilyTask["owner"])
                }
              >
                <option>Иван</option>
                <option>Алина</option>
                <option>Вместе</option>
              </select>
            </label>
            <label>
              <span>Срок</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => patch("dueDate", event.target.value)}
                required
              />
            </label>
            <label>
              <span>Приоритет</span>
              <select
                value={form.priority}
                onChange={(event) =>
                  patch(
                    "priority",
                    event.target.value as FamilyTask["priority"],
                  )
                }
              >
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </label>
            <label>
              <span>Статус</span>
              <select
                value={form.status}
                onChange={(event) =>
                  patch("status", event.target.value as FamilyTask["status"])
                }
              >
                <option value="planned">Запланировано</option>
                <option value="progress">В работе</option>
                <option value="done">Выполнено</option>
              </select>
            </label>
            <label className="full">
              <span>Категория</span>
              <input
                value={form.category}
                onChange={(event) => patch("category", event.target.value)}
              />
            </label>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Отмена
            </button>
            <button className="button primary" type="submit">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NotesSection({
  state,
  setState,
  onCloudDelete,
  notify,
}: {
  state: FamilyState;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  onCloudDelete: (kind: "note", id: string) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");
  const [editor, setEditor] = useState<Note | "new" | null>(null);
  const visible = state.notes.filter(
    (note) => note.visibility === "shared" || note.author === state.currentUser,
  );
  const tags = Array.from(new Set(visible.flatMap((note) => note.tags))).sort();
  const filtered = visible
    .filter(
      (note) =>
        `${note.title} ${note.text}`
          .toLocaleLowerCase("ru")
          .includes(query.toLocaleLowerCase("ru")) &&
        (tag === "all" || note.tags.includes(tag)),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <div className="page-stack">
      <SectionHeading
        eyebrow="Общая память"
        title="Заметки"
        description={`Личные заметки видите только вы — ${state.currentUser}.`}
        actions={
          <button className="button primary" onClick={() => setEditor("new")}>
            <Plus size={17} /> Новая заметка
          </button>
        }
      />
      <div className="notes-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по заметкам"
          />
        </label>
        <div className="tag-filter">
          <button
            className={tag === "all" ? "active" : ""}
            onClick={() => setTag("all")}
          >
            Все
          </button>
          {tags.map((item) => (
            <button
              key={item}
              className={tag === item ? "active" : ""}
              onClick={() => setTag(item)}
            >
              #{item}
            </button>
          ))}
        </div>
      </div>
      {!filtered.length ? (
        <div className="panel">
          <EmptyState
            icon={NotebookPen}
            title="Заметок не найдено"
            text="Создайте новую заметку или измените фильтр."
          />
        </div>
      ) : (
        <div className="notes-grid">
          {filtered.map((note) => (
            <article
              className={`note-card ${note.pinned ? "pinned" : ""}`}
              key={note.id}
            >
              <div className="note-head">
                <div>
                  {note.pinned && <Pin size={15} />}
                  <span>
                    {note.visibility === "personal" ? "Личная" : "Общая"}
                  </span>
                </div>
                <button
                  className="icon-button"
                  onClick={() => {
                    setState((current) => ({
                      ...current,
                      notes: current.notes.map((item) =>
                        item.id === note.id
                          ? {
                              ...item,
                              pinned: !item.pinned,
                              updatedAt: new Date().toISOString(),
                            }
                          : item,
                      ),
                    }));
                  }}
                  aria-label={note.pinned ? "Открепить" : "Закрепить"}
                >
                  <Pin size={16} />
                </button>
              </div>
              <h3>{note.title}</h3>
              <p>{note.text}</p>
              <div className="note-tags">
                {note.tags.map((item) => (
                  <span key={item}>#{item}</span>
                ))}
              </div>
              <footer>
                <div>
                  <span
                    className={`avatar ${note.author === "Иван" ? "avatar-ivan" : "avatar-alina"}`}
                  >
                    {note.author[0]}
                  </span>
                  <span>
                    {note.author} · {formatDate(note.updatedAt.slice(0, 10))}
                  </span>
                </div>
                <div>
                  <button
                    onClick={() => setEditor(note)}
                    aria-label="Редактировать"
                  >
                    <Pencil size={15} />
                  </button>
                  {note.author === state.currentUser && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`Удалить заметку «${note.title}»?`))
                          return;
                        setState((current) => ({
                          ...current,
                          notes: current.notes.filter(
                            (item) => item.id !== note.id,
                          ),
                        }));
                        onCloudDelete("note", note.id);
                      }}
                      aria-label="Удалить"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
      {editor && (
        <NoteDialog
          initial={editor === "new" ? undefined : editor}
          currentUser={state.currentUser}
          onClose={() => setEditor(null)}
          onSave={(note) => {
            setState((current) => ({
              ...current,
              notes: current.notes.some((item) => item.id === note.id)
                ? current.notes.map((item) =>
                    item.id === note.id ? note : item,
                  )
                : [note, ...current.notes],
            }));
            setEditor(null);
            localStorage.removeItem(`${STORAGE_KEY}-note-draft`);
            notify("Заметка сохранена");
          }}
        />
      )}
    </div>
  );
}

function NoteDialog({
  initial,
  currentUser,
  onClose,
  onSave,
}: {
  initial?: Note;
  currentUser: "Иван" | "Алина";
  onClose: () => void;
  onSave: (note: Note) => void;
}) {
  const [form, setForm] = useState(() => {
    if (initial)
      return {
        title: initial.title,
        text: initial.text,
        tags: initial.tags.join(", "),
        visibility: initial.visibility,
      };
    try {
      const saved = localStorage.getItem(NOTE_DRAFT_KEY);
      if (saved)
        return JSON.parse(saved) as {
          title: string;
          text: string;
          tags: string;
          visibility: Note["visibility"];
        };
    } catch {
      /* empty draft */
    }
    return {
      title: "",
      text: "",
      tags: "",
      visibility: "shared" as Note["visibility"],
    };
  });
  const patch = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!initial) localStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify(form));
  }, [form, initial]);
  return (
    <div className="dialog-backdrop">
      <div className="dialog note-dialog" role="dialog" aria-modal="true">
        <div className="dialog-head">
          <div>
            <span className="eyebrow">Черновик сохраняется автоматически</span>
            <h2>{initial ? "Редактировать заметку" : "Новая заметка"}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.title.trim() || !form.text.trim()) return;
            onSave({
              id: initial?.id ?? uid("note"),
              title: form.title.trim(),
              text: form.text.trim(),
              author: initial?.author ?? currentUser,
              visibility: form.visibility,
              tags: form.tags
                .split(",")
                .map((item) => item.trim().replace(/^#/, ""))
                .filter(Boolean),
              createdAt: initial?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              pinned: initial?.pinned ?? false,
            });
          }}
        >
          <label>
            <span>Заголовок</span>
            <input
              value={form.title}
              onChange={(event) => patch("title", event.target.value)}
              required
            />
          </label>
          <label>
            <span>Текст</span>
            <textarea
              rows={9}
              value={form.text}
              onChange={(event) => patch("text", event.target.value)}
              required
            />
          </label>
          <div className="form-grid">
            <label>
              <span>Доступ</span>
              <select
                value={form.visibility}
                onChange={(event) =>
                  patch("visibility", event.target.value as Note["visibility"])
                }
              >
                <option value="shared">Общая</option>
                <option value="personal">Личная</option>
              </select>
            </label>
            <label>
              <span>Теги через запятую</span>
              <input
                value={form.tags}
                onChange={(event) => patch("tags", event.target.value)}
                placeholder="важное, дом"
              />
            </label>
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Закрыть
            </button>
            <button className="button primary" type="submit">
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsSection({
  state,
  setState,
  exchangeRates,
  ratesDate,
  ratesFallback,
  ratesLoading,
  onRefreshRates,
  theme,
  setTheme,
  cloudSession,
  onCloudSession,
  notify,
}: {
  state: FamilyState;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  exchangeRates: ExchangeRates;
  ratesDate: string;
  ratesFallback: boolean;
  ratesLoading: boolean;
  onRefreshRates: () => void;
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  cloudSession: boolean;
  onCloudSession: (value: boolean) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const [categoryType, setCategoryType] = useState<TransactionType>("expense");
  const [categoryInput, setCategoryInput] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const markExport = () =>
    setState((current) => ({
      ...current,
      lastExport: new Date().toISOString(),
    }));
  const exportCsv = () => {
    const header = [
      "Тип",
      "Сумма",
      "Валюта",
      "Курс",
      `Сумма ${state.baseCurrency}`,
      "Дата",
      "Участник",
      "Категория",
      "Счёт",
      "Комментарий",
      "Автор",
    ];
    const escape = (value: string | number) =>
      `"${String(value).replaceAll('"', '""')}"`;
    const rows = state.operations.map((item) =>
      [
        item.type === "income" ? "Доход" : "Расход",
        item.amount,
        item.currency,
        item.rate,
        item.baseAmount,
        item.date,
        item.person,
        categoryName(state.categories, item.categoryId),
        item.account,
        item.comment,
        item.author,
      ]
        .map(escape)
        .join(";"),
    );
    downloadFile(
      `operacii-ivan-alina-${CURRENT_MONTH}.csv`,
      `\uFEFF${header.map(escape).join(";")}\n${rows.join("\n")}`,
      "text/csv;charset=utf-8",
    );
    markExport();
    notify("CSV-файл подготовлен");
  };
  const exportJson = () => {
    downloadFile(
      `rezervnaya-kopiya-ivan-alina-${TODAY}.json`,
      JSON.stringify(
        { version: 1, exportedAt: new Date().toISOString(), data: state },
        null,
        2,
      ),
      "application/json;charset=utf-8",
    );
    markExport();
    notify("Резервная копия сохранена");
  };

  return (
    <div className="page-stack settings-page">
      <SectionHeading
        eyebrow="Семейное пространство"
        title="Настройки"
        description="Валюта, синхронизация, категории и резервные копии."
      />
      <section className="settings-grid">
        <div className="panel settings-card">
          <div className="settings-card-head">
            <span>
              <CircleDollarSign size={20} />
            </span>
            <div>
              <h3>Финансы и интерфейс</h3>
              <p>Общие предпочтения семьи</p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>Базовая валюта</strong>
              <small>Все суммы пересчитываются автоматически</small>
            </div>
            <select
              value={state.baseCurrency}
              disabled={ratesLoading}
              onChange={(event) => {
                const nextCurrency = event.target.value as Currency;
                if (nextCurrency === state.baseCurrency) return;
                setState((current) => ({
                  ...current,
                  baseCurrency: nextCurrency,
                  operations: rebaseOperations(
                    current.operations,
                    nextCurrency,
                    exchangeRates,
                  ),
                }));
                notify("Все суммы пересчитаны в " + nextCurrency);
              }}
            >
              <option>USD</option>
              <option>RUB</option>
              <option>VND</option>
            </select>
          </div>
          <div className="setting-row exchange-rate-row">
            <div>
              <strong>Автоматические курсы</strong>
              <small>
                1 USD ={" "}
                {exchangeRates.RUB.toLocaleString("ru-RU", {
                  maximumFractionDigits: 2,
                })}{" "}
                RUB ·{" "}
                {exchangeRates.VND.toLocaleString("ru-RU", {
                  maximumFractionDigits: 0,
                })}{" "}
                VND · {ratesFallback ? "резервный" : ratesDate}
              </small>
            </div>
            <button
              className="button secondary compact-button"
              type="button"
              disabled={ratesLoading}
              onClick={onRefreshRates}
            >
              <RefreshCw size={14} className={ratesLoading ? "spinning" : ""} />
              {ratesLoading ? "Загрузка" : "Обновить"}
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>Тема оформления</strong>
              <small>Настройка сохраняется на устройстве</small>
            </div>
            <div className="theme-toggle">
              <button
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
              >
                <Sun size={15} /> Светлая
              </button>
              <button
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
              >
                <Moon size={15} /> Тёмная
              </button>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>Текущий пользователь</strong>
              <small>Влияет на личные заметки и автора записей</small>
            </div>
            <select
              value={state.currentUser}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  currentUser: event.target.value as FamilyState["currentUser"],
                }))
              }
            >
              <option>Иван</option>
              <option>Алина</option>
            </select>
          </div>
        </div>
        <div className="panel settings-card export-card">
          <div className="settings-card-head">
            <span>
              <Download size={20} />
            </span>
            <div>
              <h3>Экспорт и копии</h3>
              <p>
                {state.lastExport
                  ? `Последний экспорт: ${formatDate(state.lastExport.slice(0, 10))}`
                  : "Экспорт ещё не выполнялся"}
              </p>
            </div>
          </div>
          <button className="export-button" onClick={exportCsv}>
            <span>
              <Download size={18} />
            </span>
            <div>
              <strong>Операции в CSV</strong>
              <small>Подходит для Excel и Google Sheets</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
          <button className="export-button" onClick={exportJson}>
            <span>
              <FileJson size={18} />
            </span>
            <div>
              <strong>Все данные в JSON</strong>
              <small>Полная резервная копия семьи</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
          <button
            className="export-button"
            onClick={() => importRef.current?.click()}
          >
            <span>
              <Upload size={18} />
            </span>
            <div>
              <strong>Импортировать копию</strong>
              <small>Текущие данные будут заменены</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
          <input
            ref={importRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (
                !window.confirm(
                  "Импорт заменит все текущие данные. Продолжить?",
                )
              ) {
                event.target.value = "";
                return;
              }
              try {
                const parsed = JSON.parse(await file.text()) as
                  { data?: FamilyState } | FamilyState;
                const data =
                  "data" in parsed && parsed.data
                    ? parsed.data
                    : (parsed as FamilyState);
                if (
                  !Array.isArray(data.operations) ||
                  !Array.isArray(data.categories) ||
                  !["USD", "RUB", "VND"].includes(data.baseCurrency)
                )
                  throw new Error("bad format");
                setState(() => ({
                  ...data,
                  budgets: data.budgets.map((budget) => ({
                    ...budget,
                    currency: budget.currency ?? "USD",
                  })),
                }));
                notify("Резервная копия импортирована");
              } catch {
                notify(
                  "Файл не похож на резервную копию семейного центра",
                  "error",
                );
              }
              event.target.value = "";
            }}
          />
        </div>
      </section>

      <CloudPanel
        state={state}
        setState={setState}
        cloudSession={cloudSession}
        onCloudSession={onCloudSession}
        notify={notify}
      />

      <section className="panel category-settings">
        <div className="category-settings-head">
          <div>
            <span className="eyebrow">Справочники</span>
            <h3>Категории операций</h3>
            <p>
              Собственные категории можно добавлять, переименовывать и
              архивировать.
            </p>
          </div>
          <div className="view-toggle">
            <button
              className={categoryType === "expense" ? "active" : ""}
              onClick={() => setCategoryType("expense")}
            >
              Расходы
            </button>
            <button
              className={categoryType === "income" ? "active" : ""}
              onClick={() => setCategoryType("income")}
            >
              Доходы
            </button>
          </div>
        </div>
        <form
          className="category-add"
          onSubmit={(event) => {
            event.preventDefault();
            const name = categoryInput.trim();
            if (!name) return;
            if (
              state.categories.some(
                (item) =>
                  item.type === categoryType &&
                  item.name.toLocaleLowerCase("ru") ===
                    name.toLocaleLowerCase("ru"),
              )
            ) {
              notify("Такая категория уже существует", "error");
              return;
            }
            setState((current) => ({
              ...current,
              categories: [
                ...current.categories,
                {
                  id: uid("category"),
                  name,
                  type: categoryType,
                  archived: false,
                  color: categoryType === "expense" ? "#fb7185" : "#34d399",
                },
              ],
            }));
            setCategoryInput("");
            notify("Категория добавлена");
          }}
        >
          <input
            value={categoryInput}
            onChange={(event) => setCategoryInput(event.target.value)}
            placeholder="Название новой категории"
          />
          <button className="button primary" type="submit">
            <Plus size={16} /> Добавить
          </button>
        </form>
        <div className="category-list">
          {state.categories
            .filter((item) => item.type === categoryType)
            .map((category) => (
              <div
                key={category.id}
                className={category.archived ? "archived" : ""}
              >
                <i style={{ background: category.color }} />
                <span>
                  {category.name}
                  <small>
                    {category.archived
                      ? "В архиве"
                      : category.isDefault
                        ? "По умолчанию"
                        : "Собственная"}
                  </small>
                </span>
                <button
                  onClick={() => {
                    const name = window
                      .prompt("Новое название категории", category.name)
                      ?.trim();
                    if (!name) return;
                    setState((current) => ({
                      ...current,
                      categories: current.categories.map((item) =>
                        item.id === category.id ? { ...item, name } : item,
                      ),
                    }));
                  }}
                  aria-label="Переименовать"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      categories: current.categories.map((item) =>
                        item.id === category.id
                          ? { ...item, archived: !item.archived }
                          : item,
                      ),
                    }))
                  }
                  aria-label={
                    category.archived ? "Вернуть из архива" : "Архивировать"
                  }
                >
                  <Archive size={15} />
                </button>
              </div>
            ))}
        </div>
      </section>

      <section className="panel danger-zone">
        <div>
          <span>
            <Trash2 size={19} />
          </span>
          <div>
            <h3>Демонстрационные данные</h3>
            <p>Можно вернуть исходный набор или очистить все записи.</p>
          </div>
        </div>
        <div>
          <button
            className="button secondary"
            disabled={resetBusy}
            onClick={async () => {
              if (!window.confirm("Заменить текущие данные демонстрационными?"))
                return;
              setResetBusy(true);
              try {
                const restoredDemo = createDemoState();
                const demoState = {
                  ...restoredDemo,
                  currentUser: state.currentUser,
                  operations: restoredDemo.operations.map((operation) => ({
                    ...operation,
                    id: uid("operation"),
                  })),
                };
                if (cloudSession) await replaceFamilyCloudData(demoState);
                setState(() => demoState);
                notify("Демонстрационные данные восстановлены");
              } catch (error) {
                notify(getErrorMessage(error), "error");
              } finally {
                setResetBusy(false);
              }
            }}
          >
            Восстановить демо
          </button>
          <button
            className="button danger"
            disabled={resetBusy}
            onClick={async () => {
              if (
                !window.confirm(
                  "Удалить общие операции, бюджеты, цели, планы и заметки? Аккаунты, семья и код приглашения сохранятся.",
                )
              )
                return;
              setResetBusy(true);
              try {
                if (cloudSession) await clearFamilyCloudRecords();
                setState((current) => ({
                  ...current,
                  operations: [],
                  budgets: [],
                  goals: [],
                  tasks: [],
                  notes: [],
                }));
                notify("Семейные данные удалены — можно начинать с нуля");
              } catch (error) {
                notify(getErrorMessage(error), "error");
              } finally {
                setResetBusy(false);
              }
            }}
          >
            Удалить все данные
          </button>
        </div>
      </section>
    </div>
  );
}

function CloudPanel({
  state,
  setState,
  cloudSession,
  onCloudSession,
  notify,
}: {
  state: FamilyState;
  setState: (updater: (current: FamilyState) => FamilyState) => void;
  cloudSession: boolean;
  onCloudSession: (value: boolean) => void;
  notify: (message: string, tone?: Toast["tone"]) => void;
}) {
  const client = supabase;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState<"Иван" | "Алина">(state.currentUser);
  const [joinCode, setJoinCode] = useState("");
  const [familyCode, setFamilyCode] = useState("");
  const [authHint, setAuthHint] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setAuthHint("");
    try {
      await task();
    } catch (error) {
      const message = getErrorMessage(error);
      setAuthHint(message);
      notify(message, "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!cloudSession || !client) return;
    loadFamilyInviteCode()
      .then(setFamilyCode)
      .catch((error) => setSyncWarning(getErrorMessage(error)));
  }, [cloudSession, client]);

  if (!isSupabaseConfigured || !client)
    return (
      <section className="panel cloud-panel">
        <div className="cloud-visual">
          <Cloud size={25} />
          <i />
        </div>
        <div className="cloud-copy">
          <span className="eyebrow">Синхронизация</span>
          <h3>Демо-режим работает локально</h3>
          <p>
            Данные сохраняются в браузере. Чтобы пользоваться ими на MacBook и
            телефонах, добавьте переменные Supabase по инструкции в README.
          </p>
        </div>
        <span className="status-pill paused">Не подключено</span>
      </section>
    );

  if (cloudSession)
    return (
      <section className="panel cloud-panel connected">
        <div className="cloud-visual">
          <ShieldCheck size={25} />
        </div>
        <div className="cloud-copy">
          <span className="eyebrow">Supabase подключён</span>
          <h3>Семейные данные синхронизируются</h3>
          <p>
            Изменения автоматически отправляются в защищённое пространство
            семьи.
          </p>
          {familyCode && <code>Код приглашения: {familyCode}</code>}
          {syncWarning && <p className="cloud-sync-warning">{syncWarning}</p>}
        </div>
        <div className="cloud-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const cloud = await loadFamilyFromCloud(state);
                setState(() => cloud);
                notify("Данные загружены из облака");
              })
            }
          >
            Загрузить
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await saveFamilyToCloud(state);
                notify("Данные синхронизированы");
              })
            }
          >
            Сохранить
          </button>
          <button
            className="text-button"
            onClick={() =>
              run(async () => {
                await client.auth.signOut();
                onCloudSession(false);
                notify("Вы вышли из аккаунта");
              })
            }
          >
            Выйти
          </button>
        </div>
      </section>
    );

  const joinWithCode = async () => {
    const invite = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(invite))
      throw new Error("Введите код приглашения из 8 символов");

    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session) {
      const { error } = await client.auth.signInAnonymously({
        options: { data: { display_name: "Алина" } },
      });
      if (error?.code === "anonymous_provider_disabled")
        throw new Error(
          "В Supabase нужно один раз включить Anonymous Sign-Ins: Authentication → Sign In / Providers → Anonymous.",
        );
      if (error) throw error;
    }

    const { error: rpcError } = await client.rpc("join_family_space", {
      invite,
      member_name: "Алина",
    });
    if (rpcError) throw rpcError;

    const cloud = await loadFamilyFromCloud({
      ...state,
      currentUser: "Алина",
    });
    setState(() => cloud);
    setFamilyCode(await loadFamilyInviteCode());
    onCloudSession(true);
    notify("Алина вошла — общие данные загружены");
  };

  const authenticate = async (intent: "login" | "create") => {
    if (!email || password.length < 8)
      throw new Error("Введите email и пароль минимум из 8 символов");
    if (intent === "login") {
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      const cloud = await loadFamilyFromCloud(state);
      setState(() => cloud);
      onCloudSession(true);
      notify("Вход выполнен");
      return;
    }
    const { data: signInData, error: signInError } =
      await client.auth.signInWithPassword({ email, password });
    let session = signInData.session;

    if (!session && signInError?.code === "email_not_confirmed") {
      const { error: resendError } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (resendError) throw resendError;
      const message =
        "Письмо отправлено повторно. Подтвердите email, вернитесь сюда и нажмите эту кнопку ещё раз.";
      setAuthHint(message);
      notify("Проверьте почту");
      return;
    }

    if (!session) {
      if (signInError && signInError.code !== "invalid_credentials")
        throw signInError;
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      session = data.session;
      if (!session) {
        const message =
          "Подтвердите email, затем вернитесь на этот сайт и нажмите эту кнопку ещё раз.";
        setAuthHint(message);
        notify("Письмо для подтверждения отправлено");
        return;
      }
    }

    try {
      const cloud = await loadFamilyFromCloud({ ...state, currentUser: name });
      setState(() => cloud);
      setFamilyCode(await loadFamilyInviteCode());
      onCloudSession(true);
      notify("Семейное пространство уже создано — вход выполнен");
      return;
    } catch (error) {
      if (getErrorMessage(error) !== "Семейное пространство ещё не создано")
        throw error;
    }

    const { data: code, error: rpcError } = await client.rpc(
      "create_family_space",
      { family_name: "Иван & Алина", member_name: name },
    );
    if (rpcError) throw rpcError;
    const familyState = {
      ...createEmptyState(),
      currentUser: name,
      baseCurrency: state.baseCurrency,
    };
    setFamilyCode(String(code));
    setState(() => familyState);
    onCloudSession(true);
    try {
      await saveFamilyToCloud(familyState);
    } catch (error) {
      const message = `Семья создана, но начальные настройки не сохранены: ${getErrorMessage(error)}`;
      setSyncWarning(message);
      notify("Семья создана. Настройки можно сохранить позже", "error");
      return;
    }
    notify("Семейное пространство создано");
  };

  return (
    <section className="panel cloud-auth-panel">
      <div className="cloud-auth-intro">
        <span className="cloud-visual">
          <Cloud size={25} />
        </span>
        <div>
          <span className="eyebrow">Supabase готов</span>
          <h3>Войти в семейное пространство</h3>
          <p>Для Алины достаточно кода. Email и пароль ей не нужны.</p>
        </div>
      </div>
      <div className="family-code-entry">
        <label>
          <span>Код приглашения для Алины</span>
          <input
            value={joinCode}
            onChange={(event) =>
              setJoinCode(
                event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
              )
            }
            placeholder="Например, F7K2PX8A"
            autoComplete="one-time-code"
            maxLength={8}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || joinCode.length !== 8}
          onClick={() => run(joinWithCode)}
        >
          Войти по коду
        </button>
        <small>Без регистрации, почты и подтверждений.</small>
      </div>
      <div className="owner-auth-label">
        <span>Вход Ивана и создание семьи</span>
      </div>
      <div className="cloud-auth-form">
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
          />
        </label>
        <label>
          <span>Имя</span>
          <select
            value={name}
            onChange={(event) => setName(event.target.value as typeof name)}
          >
            <option>Иван</option>
            <option>Алина</option>
          </select>
        </label>
      </div>
      <div className="cloud-auth-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => run(() => authenticate("login"))}
        >
          Войти
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => run(() => authenticate("create"))}
        >
          Создать семью
        </button>
      </div>
      {authHint && (
        <p className="cloud-auth-hint" role="status" aria-live="polite">
          {authHint}
        </p>
      )}
    </section>
  );
}
