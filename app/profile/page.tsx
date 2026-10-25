import { PasswordSection } from "./PasswordSection";
import { ProfileForm } from "./ProfileForm";
import { requireDoctor } from "@/lib/auth/session";
import { cachedSpecialties } from "@/lib/cachedReads";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { DoctorWorkplace } from "@/lib/db/types";
import { SAVED_WORKPLACE_COLUMNS } from "@/lib/workplace";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const me = await requireDoctor();
  const service = createSupabaseServiceClient();

  const [specialties, { data: doctorSpecialties }, { data: workplaces }, loginEmail] =
    await Promise.all([
      cachedSpecialties(),
      service
        .from("doctor_specialties")
        .select("specialty_id")
        .eq("doctor_id", me.id),
      service
        .from("doctor_workplaces")
        .select(SAVED_WORKPLACE_COLUMNS)
        .eq("doctor_id", me.id)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true }),
      // Admins sign in at /login/dev with an email and password; doctors
      // have neither, so nobody else is asked.
      me.is_admin && me.auth_user_id
        ? service.auth.admin.getUserById(me.auth_user_id).then((r) => r.data.user?.email ?? null)
        : null,
    ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="mb-2 text-2xl font-bold sm:text-3xl">ملفي</h1>
      <p className="mb-6 text-foreground/70">
        قم بتحديث معلوماتك التي تظهر للأطباء الآخرين في النظام.
      </p>

      <ProfileForm
        doctor={me}
        specialties={specialties}
        currentSpecialtyIds={(doctorSpecialties ?? []).map(
          (r) => r.specialty_id,
        )}
        currentWorkplaces={
          (workplaces as Pick<
            DoctorWorkplace,
            | "name"
            | "workplace_type"
            | "details"
            | "address"
            | "hours"
            | "phone"
            | "is_primary"
            | "sort_order"
          >[]) ?? []
        }
      />
      {loginEmail && <PasswordSection email={loginEmail} />}
    </main>
  );
}
