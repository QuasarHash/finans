export type Person = "Иван" | "Алина" | "Общее";
export type Currency = "USD" | "RUB" | "VND";
export type TransactionType = "income" | "expense";

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  archived: boolean;
  color: string;
  isDefault?: boolean;
}

export interface Operation {
  id: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  rate: number;
  baseAmount: number;
  date: string;
  person: Person;
  categoryId: string;
  account: string;
  comment: string;
  createdAt: string;
  author: "Иван" | "Алина";
}

export interface Budget {
  id: string;
  month: string;
  categoryId: string;
  limit: number;
  currency: Currency;
}

export type GoalStatus = "active" | "done" | "paused";
export interface Goal {
  id: string;
  title: string;
  description: string;
  target: number;
  current: number;
  currency: Currency;
  deadline: string;
  owner: "Иван" | "Алина" | "Вместе";
  status: GoalStatus;
  color: string;
  icon: string;
}

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "planned" | "progress" | "done";
export interface FamilyTask {
  id: string;
  title: string;
  description: string;
  owner: "Иван" | "Алина" | "Вместе";
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  category: string;
  createdAt: string;
}

export interface Note {
  id: string;
  title: string;
  text: string;
  author: "Иван" | "Алина";
  authorUserId?: string;
  visibility: "personal" | "shared";
  tags: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

export interface FamilyState {
  baseCurrency: Currency;
  currentUser: "Иван" | "Алина";
  operations: Operation[];
  budgets: Budget[];
  goals: Goal[];
  tasks: FamilyTask[];
  notes: Note[];
  categories: Category[];
  lastExport: string | null;
}

export type AppSection =
  | "dashboard"
  | "operations"
  | "budget"
  | "goals"
  | "plans"
  | "notes"
  | "settings";
