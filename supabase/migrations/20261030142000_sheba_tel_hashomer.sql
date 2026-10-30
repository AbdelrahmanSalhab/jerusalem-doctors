-- Sheba (Tel HaShomer) is a hospital of its own, not Assaf Harofeh (Shamir).
--
-- The spelling "تل هشومير شيبا" was added to Assaf Harofeh by mistake, which
-- linked a Sheba doctor's workplace to it and, because an exact spelling beats
-- a partial match, kept a separate Sheba entry from claiming that workplace.
-- This takes the spelling off Assaf Harofeh and gives Sheba its names. If an
-- admin already made the same edits in /admin/institutions it changes nothing.
-- Workplaces move to Sheba at the next daily institutions check, or on any
-- save in /admin/institutions.
--
-- Apply in the Supabase SQL editor. Safe to run more than once.

update public.institutions
   set aliases = array_remove(aliases, 'تل هشومير شيبا')
 where name_ar in ('أساف هروفيه (شمير)', 'مستشفى أساف هروفيه (شمير)');

insert into public.institutions (name_ar, name_he, kind, aliases) values
  ('شيبا تل هشومير', 'שיבא תל השומר', 'hospital',
   array['تل هشومير شيبا', 'شيبا', 'تل هشومير', 'שיבא', 'תל השומר', 'مستشفى شيبا']::text[])
on conflict (name_ar) do update
  set name_he = coalesce(public.institutions.name_he, excluded.name_he),
      aliases = (select array_agg(distinct a) from unnest(public.institutions.aliases || excluded.aliases) a);

insert into public.applied_migrations (name) values ('20261030142000_sheba_tel_hashomer') on conflict do nothing;
