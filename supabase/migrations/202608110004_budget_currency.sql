-- Сохраняет валюту каждого бюджетного лимита отдельно.
-- Существующие лимиты были созданы в исходной базовой валюте USD.

alter table public.budgets
add column if not exists currency text not null default 'USD'
check (currency in ('USD', 'RUB', 'VND'));
