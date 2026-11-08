// /admin/settings: the directory's two switches. Each gives up a protection
// #16 added, so the page says what changes, what is lost and what still
// protects before an admin opens one. Read fresh, not from the cache the app's
// own requests use: this is the value an admin is about to change.

import Link from "next/link";
import { SettingsForm } from "./SettingsForm";
import { requireAdmin } from "@/lib/auth/session";
import { fetchSiteSettings } from "@/lib/siteSettings";
import { SETTINGS_TEXT } from "@/lib/siteSettingsText";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdmin();
  const settings = await fetchSiteSettings(createSupabaseServiceClient());

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">إعدادات الدليل</h1>
        <p className="max-w-3xl text-sm text-muted">
          مفتاحان، وكلاهما مغلق في الأصل. كل واحد منهما يتنازل عن حماية أُضيفت لأن سجل وزارة الصحة علني ولا يثبت أن من
          يكتب الاسم والترخيص هو صاحبهما. يُسجَّل كل تغيير باسم من فعله، ويصل بقية المشرفين تنبيه عند فتح مفتاح.{" "}
          <Link href="/admin/audit?action=directory_setting_changed" className="font-semibold underline">
            سجل التغييرات
          </Link>
        </p>
      </header>
      {/* The words are built here: they quote server-only limits (lib/ratelimit.ts). */}
      <SettingsForm initial={settings} text={SETTINGS_TEXT} />
    </main>
  );
}
