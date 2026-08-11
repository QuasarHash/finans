-- Позволяет Алине повторно войти по семейному коду после выхода,
-- очистки браузера или установки сайта как веб-приложения.
-- Код приглашения в этом сценарии работает как семейный пароль.

create or replace function public.join_family_space(invite text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_family_id uuid;
  current_family_id uuid;
  existing_member_id uuid;
  existing_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация'; end if;
  if member_name not in ('Иван', 'Алина') then raise exception 'Имя должно быть Иван или Алина'; end if;

  select id
  into target_family_id
  from public.families
  where invite_code = upper(trim(invite));

  if target_family_id is null then raise exception 'Код приглашения не найден'; end if;

  select family_id
  into current_family_id
  from public.family_members
  where user_id = auth.uid();

  if current_family_id is not null then
    if current_family_id = target_family_id then return target_family_id; end if;
    raise exception 'Пользователь уже состоит в другом семейном пространстве';
  end if;

  select id, user_id
  into existing_member_id, existing_user_id
  from public.family_members
  where family_id = target_family_id and display_name = member_name
  for update;

  if existing_member_id is not null then
    if member_name <> 'Алина' then
      raise exception 'Повторный вход по коду доступен только Алине';
    end if;

    -- Общие операции сохраняют автора после переноса доступа.
    update public.transactions
    set author_id = auth.uid()
    where family_id = target_family_id and author_id = existing_user_id;

    update public.family_members
    set user_id = auth.uid(), joined_at = now()
    where id = existing_member_id;

    return target_family_id;
  end if;

  if (select count(*) from public.family_members where family_id = target_family_id) >= 2 then
    raise exception 'В семейном пространстве уже два участника';
  end if;

  insert into public.family_members(family_id, user_id, display_name)
  values (target_family_id, auth.uid(), member_name);

  return target_family_id;
end;
$$;

revoke all on function public.join_family_space(text, text) from public;
grant execute on function public.join_family_space(text, text) to authenticated;
