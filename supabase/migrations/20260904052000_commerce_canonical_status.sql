alter table public.vco_order_lines
  add column canonical_status text generated always as (
    case lower(btrim(status))
      when 'pending' then 'pending_payment'
      when 'pending_payment' then 'pending_payment'
      when 'unpaid' then 'pending_payment'
      when 'awaiting_payment' then 'pending_payment'
      when '待付款' then 'pending_payment'
      when 'paid' then 'processing'
      when 'unshipped' then 'processing'
      when 'processing' then 'processing'
      when 'awaiting_fulfillment' then 'processing'
      when 'ready_to_ship' then 'processing'
      when '待发货' then 'processing'
      when '已付款' then 'processing'
      when 'shipped' then 'shipped'
      when 'in_transit' then 'shipped'
      when 'partially_shipped' then 'shipped'
      when '已发货' then 'shipped'
      when '运输中' then 'shipped'
      when 'completed' then 'completed'
      when 'delivered' then 'completed'
      when 'fulfilled' then 'completed'
      when '已完成' then 'completed'
      when '交易成功' then 'completed'
      when '已签收' then 'completed'
      when 'cancelled' then 'cancelled'
      when 'canceled' then 'cancelled'
      when 'closed' then 'cancelled'
      when '已取消' then 'cancelled'
      when '交易关闭' then 'cancelled'
      when 'refunded' then 'refunded'
      when 'refund_pending' then 'refunded'
      when 'partially_refunded' then 'refunded'
      when '已退款' then 'refunded'
      when '退款中' then 'refunded'
      else 'other'
    end
  ) stored;

alter table public.vco_order_lines
  add constraint vco_order_lines_canonical_status_check
  check (canonical_status in ('pending_payment','processing','shipped','completed','cancelled','refunded','other'));

create index vco_order_lines_owner_canonical_status_occurred_idx
  on public.vco_order_lines(owner_id, canonical_status, occurred_at desc);

comment on column public.vco_order_lines.canonical_status is
  'Derived operational state; status keeps the unmodified source-platform value.';

-- Rollback: drop the index, constraint, then generated column. Raw status remains intact.
