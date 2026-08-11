-- Иван & Алина — семейный центр
-- Полная схема MVP, функции семейного приглашения и Row Level Security.

create extension if not exists pgcrypto;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{8}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (display_name in ('Иван', 'Алина')),
  joined_at timestamptz not null default now(),
  unique (family_id, display_name)
);

create table if not exists public.categories (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  type text not null check (type in ('income', 'expense')),
  archived boolean not null default false,
  color text not null default '#34d399',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (family_id, type, name)
);

create table if not exists public.transactions (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(20, 4) not null check (amount > 0),
  currency text not null check (currency in ('USD', 'RUB', 'VND')),
  exchange_rate numeric(20, 10) not null check (exchange_rate > 0),
  base_amount numeric(20, 4) not null check (base_amount >= 0),
  date date not null,
  participant text not null check (participant in ('Иван', 'Алина', 'Общее')),
  category_id text not null references public.categories(id) on delete restrict,
  account text not null check (char_length(account) between 1 and 100),
  comment text not null default '' check (char_length(comment) <= 120),
  author_id uuid not null references auth.users(id) on delete restrict,
  author_name text not null check (author_name in ('Иван', 'Алина')),
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  category_id text not null references public.categories(id) on delete cascade,
  limit_amount numeric(20, 4) not null check (limit_amount > 0),
  currency text not null default 'USD' check (currency in ('USD', 'RUB', 'VND')),
  created_at timestamptz not null default now(),
  unique (family_id, month, category_id)
);

create table if not exists public.financial_goals (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  target_amount numeric(20, 4) not null check (target_amount > 0),
  current_amount numeric(20, 4) not null default 0 check (current_amount >= 0),
  currency text not null check (currency in ('USD', 'RUB', 'VND')),
  deadline date not null,
  owner text not null check (owner in ('Иван', 'Алина', 'Вместе')),
  status text not null check (status in ('active', 'done', 'paused')),
  color text not null default '#34d399',
  icon text not null default 'target',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_tasks (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  owner text not null check (owner in ('Иван', 'Алина', 'Вместе')),
  due_date date not null,
  priority text not null check (priority in ('low', 'medium', 'high')),
  status text not null check (status in ('planned', 'progress', 'done')),
  category text not null default 'Другое',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id text primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) > 0),
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null check (author_name in ('Иван', 'Алина')),
  visibility text not null check (visibility in ('personal', 'shared')),
  tags text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_settings (
  family_id uuid primary key references public.families(id) on delete cascade,
  base_currency text not null default 'USD' check (base_currency in ('USD', 'RUB', 'VND')),
  last_export_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists transactions_family_date_idx on public.transactions(family_id, date desc);
create index if not exists transactions_family_type_idx on public.transactions(family_id, type);
create index if not exists transactions_family_participant_idx on public.transactions(family_id, participant);
create index if not exists budgets_family_month_idx on public.budgets(family_id, month);
create index if not exists goals_family_status_idx on public.financial_goals(family_id, status);
create index if not exists tasks_family_due_idx on public.family_tasks(family_id, due_date);
create index if not exists notes_family_updated_idx on public.notes(family_id, updated_at desc);
create index if not exists notes_author_visibility_idx on public.notes(author_id, visibility);

create or replace function public.protect_note_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.author_id <> new.author_id and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Автор заметки не может быть изменён';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_note_author_trigger on public.notes;
create trigger protect_note_author_trigger
before update on public.notes
for each row execute function public.protect_note_author();

create or replace function public.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members
    where family_id = target_family_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_family_member(uuid) from public;
grant execute on function public.is_family_member(uuid) to authenticated;

create or replace function public.create_family_space(family_name text, member_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family_id uuid;
  new_code text;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация'; end if;
  if member_name not in ('Иван', 'Алина') then raise exception 'Имя должно быть Иван или Алина'; end if;
  if exists (select 1 from public.family_members where user_id = auth.uid()) then
    raise exception 'Пользователь уже состоит в семейном пространстве';
  end if;

  loop
    new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.families where invite_code = new_code);
  end loop;

  insert into public.families(name, invite_code, created_by)
  values (coalesce(nullif(trim(family_name), ''), 'Иван & Алина'), new_code, auth.uid())
  returning id into new_family_id;

  insert into public.family_members(family_id, user_id, display_name)
  values (new_family_id, auth.uid(), member_name);
  insert into public.family_settings(family_id) values (new_family_id);

  return new_code;
end;
$$;

create or replace function public.join_family_space(invite text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация'; end if;
  if member_name not in ('Иван', 'Алина') then raise exception 'Имя должно быть Иван или Алина'; end if;
  if exists (select 1 from public.family_members where user_id = auth.uid()) then
    raise exception 'Пользователь уже состоит в семейном пространстве';
  end if;
  select id into target_family_id from public.families where invite_code = upper(trim(invite));
  if target_family_id is null then raise exception 'Код приглашения не найден'; end if;
  if (select count(*) from public.family_members where family_id = target_family_id) >= 2 then
    raise exception 'В семейном пространстве уже два участника';
  end if;
  if exists (select 1 from public.family_members where family_id = target_family_id and display_name = member_name) then
    raise exception 'Это имя уже занято в семье';
  end if;
  insert into public.family_members(family_id, user_id, display_name)
  values (target_family_id, auth.uid(), member_name);
  return target_family_id;
end;
$$;

revoke all on function public.create_family_space(text, text) from public;
revoke all on function public.join_family_space(text, text) from public;
grant execute on function public.create_family_space(text, text) to authenticated;
grant execute on function public.join_family_space(text, text) to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.financial_goals enable row level security;
alter table public.family_tasks enable row level security;
alter table public.notes enable row level security;
alter table public.family_settings enable row level security;

create policy "members read family" on public.families for select to authenticated using (public.is_family_member(id));
create policy "members update family" on public.families for update to authenticated using (public.is_family_member(id)) with check (public.is_family_member(id));
create policy "members read membership" on public.family_members for select to authenticated using (public.is_family_member(family_id));
create policy "users update own profile" on public.family_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_family_member(family_id));

create policy "members read categories" on public.categories for select to authenticated using (public.is_family_member(family_id));
create policy "members add categories" on public.categories for insert to authenticated with check (public.is_family_member(family_id));
create policy "members update categories" on public.categories for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy "members delete categories" on public.categories for delete to authenticated using (public.is_family_member(family_id));

create policy "members read transactions" on public.transactions for select to authenticated using (public.is_family_member(family_id));
create policy "members add transactions" on public.transactions for insert to authenticated with check (public.is_family_member(family_id) and author_id = auth.uid());
create policy "members update transactions" on public.transactions for update to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy "members delete transactions" on public.transactions for delete to authenticated using (public.is_family_member(family_id));

create policy "members manage budgets" on public.budgets for all to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy "members manage goals" on public.financial_goals for all to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy "members manage tasks" on public.family_tasks for all to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));
create policy "members manage settings" on public.family_settings for all to authenticated using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

create policy "members read allowed notes" on public.notes for select to authenticated
using (public.is_family_member(family_id) and (visibility = 'shared' or author_id = auth.uid()));
create policy "members add own notes" on public.notes for insert to authenticated
with check (public.is_family_member(family_id) and author_id = auth.uid());
create policy "members update allowed notes" on public.notes for update to authenticated
using (public.is_family_member(family_id) and (visibility = 'shared' or author_id = auth.uid()))
with check (public.is_family_member(family_id) and (visibility = 'shared' or author_id = auth.uid()));
create policy "authors delete notes" on public.notes for delete to authenticated
using (public.is_family_member(family_id) and author_id = auth.uid());

grant usage on schema public to authenticated;
grant select, update on public.families to authenticated;
grant select, update on public.family_members to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.financial_goals to authenticated;
grant select, insert, update, delete on public.family_tasks to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
grant select, insert, update, delete on public.family_settings to authenticated;
