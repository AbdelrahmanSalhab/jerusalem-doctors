# #16: what is left, and what to build next

Research only, no code. Numbers are from production on 2026-11-05.

## Where we are

Done (#244, #245, #249): signup no longer auto-approves; the directory is closed
to a doctor an admin has not accepted; every acceptance records how the admin
knew and why; the 99 doctors accepted before that were checked in bulk and
logged as `bulk_registry_check` (not "known personally": nobody contacted them);
an accepted doctor can no longer take another listed doctor's exact name (#250).

## The fact everything depends on

The registry is public. A name and a licence number prove nothing about who is
typing them, and nothing derived from the registry ever will. So the only two
things automation can do are:

1. **Limit what a wrong acceptance gets.**
2. **Bring in a proof the registry does not contain.**

## The exposure today

- An accepted account gets, for every doctor in a search result: `phone_e164`,
  `phone_display`, a WhatsApp link, `email` and each workplace's phone
  (`lib/directory.ts`, `toSearchHit`; returned as is by `GET /api/search`).
- An empty query is allowed, a search returns up to 50 rows, and there is no
  offset, but the filters (specialty, stage, institution, type) cut the
  directory into slices. 133 doctors are a few requests away.
- The limits are 30 searches a minute and 600 a day, and the "heavy use" alert
  fires only at 600. Real use over the last 30 days: median 4 searches a
  doctor-day, 95% at 33 or fewer, at most 8 contacts in a day (the 206-search
  maximum is probably an admin or the CI account; not yet excluded).

So one wrong acceptance can copy every number and email in minutes, and nothing
would notice.

## Options

| | What | Cost | Verdict |
|---|---|---|---|
| A | Phones and emails leave search results; one is shown when the doctor taps it, through a route that counts **distinct doctors revealed per account per day**. Tighter for new accounts. Over the budget: refused, one alert. | One extra tap for doctors. A medium PR, no new service (the counters use the same Redis as the other limits). | **Do first.** Bounds the damage whoever gets in, including the 93 bulk-reviewed. |
| B | A link sent to a workplace email (hospital or health-fund domain, list kept per institution) as a proof the registry lacks. | New: signup needs to send email. Not checked whether the project can. Proves a workplace mailbox, not the licence. Misses private clinics. | Only if sending email is easy. |
| C | Flags that order the admin queue: Arabic name against Hebrew name (6 of 100 flagged, 2 real questions), registry `specialist_since` and `license_issued_on` against the career stage and year typed, signup bursts, duplicate-licence attempts. | Small. Proves nothing against a careful impersonator. | Cheap, after A. |
| D | ID photo upload with automatic reading; suspending the first account when a second claims the same licence. | Stores identity documents in a public-repo app, and they can be forged; a stranger could lock a real doctor out by claiming first. | No. |

## Recommended order and shape of A

1. **Reveal on tap.** Search and the other directory lists return no phone or
   email; a doctor's card gets «إظهار الرقم». The call, WhatsApp and email links
   appear after the tap. `POST /api/usage/contact` already exists for the click
   count; the reveal is a sibling route that returns the numbers.
2. **Budget.** A Redis set per account per day (`SADD` plus expiry). A first
   guess to confirm against real use: 25 distinct doctors a day, 10 for the
   first 14 days after acceptance. Over it: 429, and the existing
   `directory_heavy_use` alert once a day, now meaning something.
3. **Every surface**, not only search: the profile page `/doctors/[id]` and the
   dashboard sections build their cards from the same shape. Checking each is
   part of the PR; only the search API was traced here.

Before building: measure real reveals per account excluding admin and CI,
decide the budget numbers, and decide whether new doctors get the tighter budget.

Then C, then B only if email sending exists.

## Also open

- Issues #247 (other renames are only logged and alerted) and #248 (the
  acceptance message comes from an admin's own WhatsApp) stay open: both are
  decisions about admin workload and a sending channel.
- `bulk_registry_check` has no label on the audit page yet (shows the raw key).
