import type { FamilyState } from "./types";
import { LEGACY_DEMO_OPERATION_IDS } from "./demo-data";
import { supabase } from "./supabase";

async function getContext() {
  if (!supabase) throw new Error("Supabase не настроен");
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error("Сначала войдите в аккаунт");
  const { data: membership, error: memberError } = await supabase
    .from("family_members")
    .select("family_id, display_name")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!membership) throw new Error("Семейное пространство ещё не создано");
  return {
    client: supabase,
    user: authData.user,
    familyId: membership.family_id as string,
    displayName: membership.display_name as "Иван" | "Алина",
  };
}

export async function loadFamilyInviteCode(): Promise<string> {
  const { client, familyId } = await getContext();
  const { data, error } = await client
    .from("families")
    .select("invite_code")
    .eq("id", familyId)
    .single();
  if (error) throw new Error(error.message);
  return String(data.invite_code);
}

export async function loadFamilyFromCloud(
  fallback: FamilyState,
): Promise<FamilyState> {
  const { client, familyId, displayName } = await getContext();
  const { error: demoCleanupError } = await client
    .from("transactions")
    .delete()
    .eq("family_id", familyId)
    .in("id", [...LEGACY_DEMO_OPERATION_IDS]);
  if (demoCleanupError) throw demoCleanupError;

  const [operations, budgets, goals, tasks, notes, categories, settings] =
    await Promise.all([
      client
        .from("transactions")
        .select("*")
        .eq("family_id", familyId)
        .order("date", { ascending: false }),
      client.from("budgets").select("*").eq("family_id", familyId),
      client.from("financial_goals").select("*").eq("family_id", familyId),
      client.from("family_tasks").select("*").eq("family_id", familyId),
      client.from("notes").select("*").eq("family_id", familyId),
      client.from("categories").select("*").eq("family_id", familyId),
      client
        .from("family_settings")
        .select("*")
        .eq("family_id", familyId)
        .maybeSingle(),
    ]);
  const firstError = [
    operations,
    budgets,
    goals,
    tasks,
    notes,
    categories,
    settings,
  ].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  return {
    ...fallback,
    currentUser: displayName,
    baseCurrency: (settings.data?.base_currency ??
      fallback.baseCurrency) as FamilyState["baseCurrency"],
    lastExport: settings.data?.last_export_at ?? null,
    categories: (categories.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      archived: row.archived,
      color: row.color,
      isDefault: row.is_default,
    })),
    operations: (operations.data ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      currency: row.currency,
      rate: Number(row.exchange_rate),
      baseAmount: Number(row.base_amount),
      date: row.date,
      person: row.participant,
      categoryId: row.category_id,
      account: row.account,
      comment: row.comment ?? "",
      createdAt: row.created_at,
      author: row.author_name,
    })),
    budgets: (budgets.data ?? []).map((row) => ({
      id: row.id,
      month: row.month,
      categoryId: row.category_id,
      limit: Number(row.limit_amount),
      currency: (row.currency ?? "USD") as FamilyState["baseCurrency"],
    })),
    goals: (goals.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      target: Number(row.target_amount),
      current: Number(row.current_amount),
      currency: row.currency,
      deadline: row.deadline,
      owner: row.owner,
      status: row.status,
      color: row.color,
      icon: row.icon,
    })),
    tasks: (tasks.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      owner: row.owner,
      dueDate: row.due_date,
      priority: row.priority,
      status: row.status,
      category: row.category,
      createdAt: row.created_at,
    })),
    notes: (notes.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      text: row.body,
      author: row.author_name,
      authorUserId: row.author_id,
      visibility: row.visibility,
      tags: row.tags ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      pinned: row.pinned,
    })),
  };
}

export async function saveFamilyToCloud(state: FamilyState) {
  const { client, user, familyId } = await getContext();
  const stamp = new Date().toISOString();
  const settingsWrite = await client.from("family_settings").upsert({
    family_id: familyId,
    base_currency: state.baseCurrency,
    last_export_at: state.lastExport,
    updated_at: stamp,
  });
  if (settingsWrite.error) throw settingsWrite.error;
  if (state.categories.length) {
    const categoriesWrite = await client.from("categories").upsert(
      state.categories.map((item) => ({
        family_id: familyId,
        id: item.id,
        name: item.name,
        type: item.type,
        archived: item.archived,
        color: item.color,
        is_default: Boolean(item.isDefault),
      })),
    );
    if (categoriesWrite.error) throw categoriesWrite.error;
  }
  const writes = [
    state.operations.length
      ? client.from("transactions").upsert(
          state.operations.map((item) => ({
            family_id: familyId,
            id: item.id,
            type: item.type,
            amount: item.amount,
            currency: item.currency,
            exchange_rate: item.rate,
            base_amount: item.baseAmount,
            date: item.date,
            participant: item.person,
            category_id: item.categoryId,
            account: item.account,
            comment: item.comment,
            created_at: item.createdAt,
            author_id: user.id,
            author_name: item.author,
          })),
        )
      : Promise.resolve({ error: null }),
    state.budgets.length
      ? client.from("budgets").upsert(
          state.budgets.map((item) => ({
            family_id: familyId,
            id: item.id,
            month: item.month,
            category_id: item.categoryId,
            limit_amount: item.limit,
            currency: item.currency ?? "USD",
          })),
        )
      : Promise.resolve({ error: null }),
    state.goals.length
      ? client.from("financial_goals").upsert(
          state.goals.map((item) => ({
            family_id: familyId,
            id: item.id,
            title: item.title,
            description: item.description,
            target_amount: item.target,
            current_amount: item.current,
            currency: item.currency,
            deadline: item.deadline,
            owner: item.owner,
            status: item.status,
            color: item.color,
            icon: item.icon,
          })),
        )
      : Promise.resolve({ error: null }),
    state.tasks.length
      ? client.from("family_tasks").upsert(
          state.tasks.map((item) => ({
            family_id: familyId,
            id: item.id,
            title: item.title,
            description: item.description,
            owner: item.owner,
            due_date: item.dueDate,
            priority: item.priority,
            status: item.status,
            category: item.category,
            created_at: item.createdAt,
          })),
        )
      : Promise.resolve({ error: null }),
    state.notes.length
      ? client.from("notes").upsert(
          state.notes.map((item) => ({
            family_id: familyId,
            id: item.id,
            title: item.title,
            body: item.text,
            author_id: item.authorUserId ?? user.id,
            author_name: item.author,
            visibility: item.visibility,
            tags: item.tags,
            created_at: item.createdAt,
            updated_at: item.updatedAt,
            pinned: item.pinned,
          })),
        )
      : Promise.resolve({ error: null }),
  ];
  const results = await Promise.all(writes);
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

const familyDataTables = [
  "notes",
  "family_tasks",
  "financial_goals",
  "budgets",
  "transactions",
] as const;

async function clearFamilyData(includeCategories = false) {
  const { client, familyId } = await getContext();
  const tables = includeCategories
    ? [...familyDataTables, "categories"]
    : familyDataTables;

  for (const table of tables) {
    const { error } = await client
      .from(table)
      .delete()
      .eq("family_id", familyId);
    if (error) throw error;
  }
}

export async function clearFamilyCloudRecords() {
  await clearFamilyData();
}

export async function replaceFamilyCloudData(state: FamilyState) {
  await clearFamilyData(true);
  await saveFamilyToCloud(state);
}

const tableByKind = {
  operation: "transactions",
  budget: "budgets",
  goal: "financial_goals",
  task: "family_tasks",
  note: "notes",
  category: "categories",
} as const;

export async function deleteCloudRecord(
  kind: keyof typeof tableByKind,
  id: string,
) {
  const { client, familyId } = await getContext();
  const { error } = await client
    .from(tableByKind[kind])
    .delete()
    .eq("family_id", familyId)
    .eq("id", id);
  if (error) throw error;
}
