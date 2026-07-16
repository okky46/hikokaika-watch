alter table public.price_snapshots
  drop constraint if exists price_snapshots_type_check;

alter table public.price_snapshots
  add constraint price_snapshots_type_check
  check (price_type in (
    'pre_report_close',
    'current_close',
    'formal_offer_price',
    'daily_close'
  ));

alter table public.case_events
  drop constraint if exists case_events_type_check;

alter table public.case_events
  add constraint case_events_type_check
  check (event_type in (
    'observation_report',
    'company_comment',
    'follow_up_report',
    'timely_disclosure',
    'formal_announcement',
    'price_revision',
    'tender_offer_result',
    'consideration_ended',
    'withdrawal',
    'correction',
    'other',
    'large_shareholding_report'
  ));
