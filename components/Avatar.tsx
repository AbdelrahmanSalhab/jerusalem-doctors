import Image from "next/image";

/**
 * Doctor avatar — uses profile_picture_url if present, otherwise renders the
 * first Arabic letter of the doctor's name as a fallback. Round, sized via
 * the `size` prop (Tailwind h-/w- utilities recompute automatically).
 */
export function Avatar({
  url,
  fallback,
  size = "md",
  alt = "",
}: {
  url: string | null | undefined;
  fallback: string;
  size?: "sm" | "md" | "lg" | "xl";
  alt?: string;
}) {
  const dim =
    size === "sm" ? 40 : size === "md" ? 48 : size === "lg" ? 72 : 96;
  const initial = fallback.trim().charAt(0) || "؟";
  const cls =
    size === "sm"
      ? "h-10 w-10 text-base"
      : size === "md"
        ? "h-12 w-12 text-lg"
        : size === "lg"
          ? "h-[72px] w-[72px] text-2xl"
          : "h-24 w-24 text-3xl";

  if (url) {
    return (
      <Image
        src={url}
        alt={alt}
        width={dim}
        height={dim}
        className={`${cls} shrink-0 rounded-full object-cover`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${cls} flex shrink-0 items-center justify-center rounded-full bg-foreground/10 font-bold text-foreground/80`}
    >
      {initial}
    </div>
  );
}
