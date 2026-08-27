"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapData } from "@/lib/queries";

const STATUS_FILL: Record<string, string> = {
  new: "#10b981",
  exploring: "#0ea5e9",
  active: "#f97316",
  on_hold: "#94a3b8",
  client: "#8b5cf6",
  won: "#22c55e",
  lost: "#ef4444",
  dormant: "#a8a29e",
};

interface Node {
  key: string;
  href: string;
  label: string;
  type: "person" | "company";
  status: string;
  x: number;
  y: number;
  degree: number;
}

interface Edge {
  a: number; // node index
  b: number;
  label: string | null;
  dashed: boolean;
}

const W = 1100;
const H = 760;

/** Deterministic force-directed layout (no Math.random → stable SSR). */
function layout(data: MapData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const index = new Map<string, number>();

  data.companies.forEach((c, i) => {
    index.set(`c${c.id}`, nodes.length);
    const angle = (i / data.companies.length) * Math.PI * 2;
    nodes.push({
      key: `c${c.id}`,
      href: `/companies/${c.slug}`,
      label: c.name,
      type: "company",
      status: c.status_key,
      x: W / 2 + Math.cos(angle) * 260,
      y: H / 2 + Math.sin(angle) * 240,
      degree: 0,
    });
  });
  data.people.forEach((p, i) => {
    index.set(`p${p.id}`, nodes.length);
    const angle = (i / data.people.length) * Math.PI * 2 + 0.35;
    nodes.push({
      key: `p${p.id}`,
      href: `/people/${p.slug}`,
      label: p.name,
      type: "person",
      status: p.status_key,
      x: W / 2 + Math.cos(angle) * 130,
      y: H / 2 + Math.sin(angle) * 120,
      degree: 0,
    });
  });

  const edges: Edge[] = [];
  for (const p of data.people) {
    if (p.company_id != null && index.has(`c${p.company_id}`)) {
      edges.push({
        a: index.get(`p${p.id}`)!,
        b: index.get(`c${p.company_id}`)!,
        label: null,
        dashed: false,
      });
    }
  }
  for (const c of data.connections) {
    const a = index.get(`p${c.from_person_id}`);
    const b = index.get(`p${c.to_person_id}`);
    if (a != null && b != null) {
      edges.push({ a, b, label: c.label, dashed: (c.label ?? "").includes("owed") });
    }
  }
  for (const e of edges) {
    nodes[e.a].degree++;
    nodes[e.b].degree++;
  }

  // Simple spring/repulsion simulation
  for (let iter = 0; iter < 400; iter++) {
    const t = 1 - iter / 400;
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = ((i * 7 + j) % 13) - 6;
          dy = ((i * 11 + j) % 17) - 8;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const force = (16000 / d2) * t;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        nodes[i].x -= fx;
        nodes[i].y -= fy;
        nodes[j].x += fx;
        nodes[j].y += fy;
      }
    }
    // springs
    for (const e of edges) {
      const na = nodes[e.a];
      const nb = nodes[e.b];
      const dx = nb.x - na.x;
      const dy = nb.y - na.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = 110;
      const force = ((d - ideal) / d) * 0.08;
      na.x += dx * force;
      na.y += dy * force;
      nb.x -= dx * force;
      nb.y -= dy * force;
    }
    // gravity to center
    for (const n of nodes) {
      n.x += (W / 2 - n.x) * 0.006;
      n.y += (H / 2 - n.y) * 0.006;
    }
  }
  // clamp into frame
  for (const n of nodes) {
    n.x = Math.max(60, Math.min(W - 60, n.x));
    n.y = Math.max(30, Math.min(H - 30, n.y));
  }
  return { nodes, edges };
}

export default function NetworkMap({ data }: { data: MapData }) {
  const { nodes, edges } = useMemo(() => layout(data), [data]);
  const [hover, setHover] = useState<number | null>(null);
  // Render client-side only: SVG float coordinates hydrate unreliably from SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const neighbors = useMemo(() => {
    if (hover == null) return null;
    const set = new Set<number>([hover]);
    for (const e of edges) {
      if (e.a === hover) set.add(e.b);
      if (e.b === hover) set.add(e.a);
    }
    return set;
  }, [hover, edges]);

  if (!mounted) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-xl border border-stone-200 bg-white text-sm text-stone-400"
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        Laying out the network…
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[640px]"
        onMouseLeave={() => setHover(null)}
      >
      {edges.map((e, i) => {
        const dim = neighbors && !(neighbors.has(e.a) && neighbors.has(e.b));
        const active = hover != null && (e.a === hover || e.b === hover);
        return (
          <g key={i} opacity={dim ? 0.12 : 1}>
            <line
              x1={nodes[e.a].x}
              y1={nodes[e.a].y}
              x2={nodes[e.b].x}
              y2={nodes[e.b].y}
              stroke={active ? "#6366f1" : e.label ? "#c4b5fd" : "#e7e5e4"}
              strokeWidth={active ? 2 : 1.2}
              strokeDasharray={e.dashed ? "4 4" : undefined}
            />
            {e.label && active ? (
              <text
                x={(nodes[e.a].x + nodes[e.b].x) / 2}
                y={(nodes[e.a].y + nodes[e.b].y) / 2 - 4}
                textAnchor="middle"
                className="fill-indigo-600"
                fontSize={10}
                fontStyle="italic"
              >
                {e.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const dim = neighbors && !neighbors.has(i);
        const r = 7 + Math.min(6, n.degree * 1.5);
        const fill = STATUS_FILL[n.status] ?? "#a8a29e";
        return (
          // A real SVG link: keyboard-focusable, middle-click / cmd-click open
          // in a new tab, and screen readers announce it as a link.
          <a
            key={n.key}
            href={n.href}
            aria-label={`${n.label} (${n.type})`}
            style={{ opacity: dim ? 0.15 : 1 }}
            className="cursor-pointer focus:outline-none [&:focus-visible>*]:stroke-indigo-500"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            {n.type === "company" ? (
              <rect
                x={n.x - r}
                y={n.y - r}
                width={r * 2}
                height={r * 2}
                rx={3}
                fill="#fff"
                stroke={fill}
                strokeWidth={2.5}
              />
            ) : (
              <circle cx={n.x} cy={n.y} r={r} fill={fill} opacity={0.9} />
            )}
            <text
              x={n.x}
              y={n.y + r + 11}
              textAnchor="middle"
              fontSize={n.type === "company" ? 10.5 : 10}
              fontWeight={n.type === "company" ? 600 : 400}
              className={n.type === "company" ? "fill-stone-700" : "fill-stone-500"}
            >
              {n.label.length > 24 ? n.label.slice(0, 23) + "…" : n.label}
            </text>
          </a>
        );
      })}
      </svg>
    </div>
  );
}
