"use client";

import { buttonStyles } from "./ui";

/** Opens the browser's print dialog; choose "Save as PDF" to get a PDF. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${buttonStyles.primary} print:hidden`}>
      {label}
    </button>
  );
}
