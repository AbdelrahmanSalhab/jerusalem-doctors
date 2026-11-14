// Small outline marks for the buttons that open WhatsApp and the team's
// Linktree. Decorative: the button's text names the destination.

const BASE = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg {...BASE} className={`h-5 w-5 shrink-0 ${className}`}>
      <path d="M3 21l1.7-4.9A9 9 0 1 1 8.1 19.3L3 21Z" />
      <path d="M9.2 8.6c-.3.5-.3 1.3.4 2.5s1.9 2.3 3 2.8c.9.4 1.6.1 2-.4l.3-.6-1.6-.9-.7.5c-.6-.3-1.4-1-1.8-1.7l.5-.7-.8-1.7-.7.2Z" />
    </svg>
  );
}

export function LinktreeIcon({ className = "" }: { className?: string }) {
  return (
    <svg {...BASE} className={`h-5 w-5 shrink-0 ${className}`}>
      <path d="M12 22V3" />
      <path d="M12 8 7 6" />
      <path d="M12 8l5-2" />
      <path d="M12 13 5.5 10" />
      <path d="M12 13l6.5-3" />
      <path d="M12 18 4 14" />
      <path d="M12 18l8-4" />
    </svg>
  );
}
