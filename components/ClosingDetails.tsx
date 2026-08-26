"use client";

import { useRef } from "react";

/**
 * A <details> that snaps shut when any form inside it is submitted. Native
 * <details> keeps its open state in the DOM, so after a server-action save +
 * router refresh the popover would otherwise stay open over the page.
 */
export default function ClosingDetails({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className={className} onSubmit={() => ref.current?.removeAttribute("open")}>
      {children}
    </details>
  );
}
