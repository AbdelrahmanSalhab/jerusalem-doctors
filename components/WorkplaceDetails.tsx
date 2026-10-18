// A workplace's address, hours and phone on a doctor card: the phone dials,
// the address opens in Google Maps or Waze. Rows saved before the clinic
// fields existed fall back to their free-text details.

import type { SearchWorkplace } from "@/lib/directory";
import { clinicTelHref, mapLinks } from "@/lib/workplace";

const link = "underline decoration-foreground/30 underline-offset-2 hover:text-foreground";

export function WorkplaceDetails({ w }: { w: SearchWorkplace }) {
  const address = w.address?.trim();
  const hours = w.hours?.trim();
  const phone = w.phone?.trim();
  const tel = clinicTelHref(w.phone);
  const maps = mapLinks(w.address);

  if (!address && !hours && !phone) {
    const details = w.details?.trim();
    return details ? <p className="mt-0.5 text-foreground/65">{details}</p> : null;
  }

  return (
    <div className="mt-0.5 flex flex-col gap-0.5 text-foreground/65">
      {address && (
        <p>
          {address}
          {maps && (
            <>
              {" · "}
              <a href={maps.google} target="_blank" rel="noopener noreferrer" className={link}>
                خرائط Google
              </a>
              {" · "}
              <a href={maps.waze} target="_blank" rel="noopener noreferrer" className={link}>
                Waze
              </a>
            </>
          )}
        </p>
      )}
      {hours && <p>{hours}</p>}
      {phone && (
        <p>
          {tel ? (
            <a href={tel} dir="ltr" className={link}>
              {phone}
            </a>
          ) : (
            <span dir="ltr">{phone}</span>
          )}
        </p>
      )}
    </div>
  );
}
