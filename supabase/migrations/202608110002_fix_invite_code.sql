-- Исправляет генерацию кода приглашения в проектах Supabase,
-- где gen_random_bytes недоступна в search_path функции.

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

revoke all on function public.create_family_space(text, text) from public;
grant execute on function public.create_family_space(text, text) to authenticated;
