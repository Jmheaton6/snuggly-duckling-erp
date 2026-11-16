-- Phase 5 read models. Aggregated in the database (the API returns at most 1,000 raw rows),
-- and run with the caller's permissions, so only staff can read them.

-- Store-local day range → timestamps, so the date index on journal_lines / sales is used.
create function day_start(p_day date) returns timestamptz
language sql immutable as $$ select p_day::timestamp at time zone 'America/Denver' $$;

-- Debits and credits per account for a date range (the P&L is built from these).
create function account_activity(p_from date, p_to date)
returns table (code text, name text, type text, sort int, debit numeric, credit numeric)
language sql stable set search_path = public as $$
  select a.code, a.name, a.type, a.sort, coalesce(sum(j.debit), 0), coalesce(sum(j.credit), 0)
  from accounts a
  left join journal_lines j on j.account = a.code and j.ts >= day_start(p_from) and j.ts < day_start(p_to + 1)
  group by a.code, a.name, a.type, a.sort
  order by a.sort
$$;

-- Balance of one account (debits − credits) at the end of a day. Inventory uses it for turnover.
create function account_balance(p_code text, p_as_of date) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(debit - credit), 0) from journal_lines where account = p_code and ts < day_start(p_as_of + 1)
$$;

-- Units, net sales, cost and margin per item sold in a date range (before returns).
create function top_items(p_from date, p_to date)
returns table (item_id int, sku text, name text, category text, units numeric, net_sales numeric, cogs numeric, tickets bigint)
language sql stable set search_path = public as $$
  select i.id, i.sku, i.name, i.category, sum(l.qty), sum(l.net_amount), sum(l.cogs), count(distinct s.id)
  from sale_lines l
  join sales s on s.id = l.sale_id
  join items i on i.id = l.item_id
  where s.ts >= day_start(p_from) and s.ts < day_start(p_to + 1)
  group by i.id
  order by sum(l.net_amount) desc
$$;
