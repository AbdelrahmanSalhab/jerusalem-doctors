"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function PhotoUploader({
  currentUrl,
  fallback,
  onUploaded,
}: {
  currentUrl: string | null;
  fallback: string;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(currentUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;

    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("نوع الملف غير مدعوم. استخدم JPG أو PNG أو WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("حجم الصورة أكبر من 2 ميغابايت.");
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/profile/photo", {
        method: "POST",
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) {
        if (body?.code === "file_too_large") {
          setError("حجم الصورة أكبر من 2 ميغابايت.");
        } else if (body?.code === "unsupported_type") {
          setError("نوع الملف غير مدعوم.");
        } else {
          setError("تعذّر رفع الصورة. حاول لاحقًا.");
        }
        return;
      }
      setUrl(body.url);
      onUploaded(body.url);
    } catch (err) {
      console.error(err);
      setError("خطأ في الاتصال أثناء الرفع.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar url={url} fallback={fallback} size="xl" />
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={pick}
          disabled={uploading}
          className="rounded-md border border-foreground/20 px-4 py-2 text-base hover:bg-foreground/5 disabled:opacity-50"
        >
          {uploading ? "جارٍ الرفع..." : url ? "تغيير الصورة" : "رفع صورة"}
        </button>
        <p className="text-xs text-foreground/60">
          JPG / PNG / WebP — الحد الأقصى 2 ميغابايت
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={onChange}
        />
      </div>
    </div>
  );
}
