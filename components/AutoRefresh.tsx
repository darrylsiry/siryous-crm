"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the (server) page every `seconds` while mounted — used while a background job runs. */
export default function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
