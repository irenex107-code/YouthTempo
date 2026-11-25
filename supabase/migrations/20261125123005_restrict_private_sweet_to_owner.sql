-- A school relationship alone does not grant access to private SWEET check-ins.
drop policy if exists "sweet_records_select_school_members" on public.sweet_records;
