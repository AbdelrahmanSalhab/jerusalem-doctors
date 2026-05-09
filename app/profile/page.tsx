import { ProfileForm } from "./ProfileForm";
import { requireDoctor } from "@/lib/auth/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { DoctorWorkplace, Specialty } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const me = await requireDoctor();
  const service = createSupabaseServiceClient();

  const [{ data: specialties }, { data: doctorSpecialties }, { data: workplaces }] =
    await Promise.all([
      service
        .from("specialties")
        .select("id, name_ar")
        .eq("is_active", true)
        .order("sort_order"),
      service
        .from("doctor_specialties")
        .select("specialty_id")
        .eq("doctor_id", me.id),
      service
        .from("doctor_workplaces")
        .select("name, is_primary, sort_order")
        .eq("doctor_id", me.id)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true }),
    ]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="mb-2 text-2xl font-bold sm:text-3xl">ملفي</h1>
      <p className="mb-6 text-foreground/70">
        قم بتحديث معلوماتك التي تظهر للأطباء الآخرين في النظام.
      </p>

      <ProfileForm
        doctor={me}
        specialties={(specialties as Pick<Specialty, "id" | "name_ar">[]) ?? []}
        currentSpecialtyIds={(doctorSpecialties ?? []).map(
          (r) => r.specialty_id,
        )}
        currentWorkplaces={
          (workplaces as Pick<DoctorWorkplace, "name" | "is_primary" | "sort_order">[]) ?? []
        }
      />
    </main>
  );
}
