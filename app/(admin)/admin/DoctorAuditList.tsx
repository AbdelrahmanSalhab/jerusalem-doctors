// The last few things that happened to one doctor. Shown under the panel in
// both modes: after a save it is the admin's confirmation that the edit
// landed, and what it recorded.

import { auditDetail, auditTime, auditTitle } from "@/lib/auditText";
import type { DoctorDetail } from "@/lib/admin/doctorDetail";

export function DoctorAuditList({ audit }: { audit: DoctorDetail["audit"] }) {
  if (audit.length === 0) {
    return <p className="text-sm text-muted">لا أحداث مسجَّلة.</p>;
  }
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {audit.map((row) => {
        const line = auditDetail(row, () => undefined);
        return (
          <li key={row.id} className="flex flex-col">
            <span className="font-medium">
              {auditTitle(row.action)} <span className="text-xs text-muted">{auditTime(row.created_at)}</span>
            </span>
            {line && <span className="text-muted">{line}</span>}
          </li>
        );
      })}
    </ul>
  );
}
