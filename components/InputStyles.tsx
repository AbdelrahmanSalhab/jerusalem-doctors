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
        outline: 2px solid currentColor;
        outline-offset: 1px;
      }
    `}</style>
  );
}
