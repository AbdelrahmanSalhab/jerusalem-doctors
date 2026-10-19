"use client";

// The `.input` look shared by the signup and profile forms.

export function InputStyles() {
  return (
    <style jsx global>{`
      .input {
        width: 100%;
        padding: 0.75rem 0.875rem;
        font-size: 1rem;
        border-radius: 0.375rem;
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        background: transparent;
      }
      .input:focus {
        outline: none;
        border-color: var(--foreground);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--foreground) 14%, transparent);
      }
    `}</style>
  );
}
