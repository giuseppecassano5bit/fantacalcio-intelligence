"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface MdOption {
  matchday: number;
  label: string;
}

export function MatchdaySelect({ options, defaultMd }: { options: MdOption[]; defaultMd: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  if (options.length === 0) return null;
  const g = sp.get("g");
  const current = g ? Number(g) : defaultMd;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Giornata</span>
      <select
        className="input !w-auto !py-1.5 font-semibold"
        value={current ?? ""}
        onChange={(e) => {
          const params = new URLSearchParams(sp.toString());
          const v = Number(e.target.value);
          if (v === defaultMd) params.delete("g");
          else params.set("g", String(v));
          const qs = params.toString();
          router.push(qs ? `${pathname}?${qs}` : pathname);
        }}
      >
        {options.map((o) => (
          <option key={o.matchday} value={o.matchday}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
