"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapData } from "@/lib/queries";

/** Fill for a status the vocabulary doesn't know (stone). */
const UNKNOWN_FILL = "#a8a29e";

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

interface Graph {
  nodes: Node[];
  edges: Edge[];
  /** Too big for the full layout: placed by placeGrouped() instead. */
  simplified: boolean;
}

const W = 1100;
const H = 760;

/**
 * Up to this many people + companies the map gets the full force-directed
 * layout. Its repulsion step compares every pair of nodes 400 times (about
 * 0.2 s at 300 nodes on a recent laptop, growing with the square: billions of
 * steps for a few thousand), so a bigger network gets placeGrouped() instead.
 */
const FULL_LAYOUT_MAX = 300;

/** Deterministic layout (no Math.random → the map looks the same each visit). */
function layout(data: MapData): Graph {
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

  const simplified = nodes.length > FULL_LAYOUT_MAX;
  if (simplified) placeGrouped(nodes, data, index);
  else simulate(nodes, edges);
  // clamp into frame
  for (const n of nodes) {
    n.x = Math.max(60, Math.min(W - 60, n.x));
    n.y = Math.max(30, Math.min(H - 30, n.y));
  }
  return { nodes, edges, simplified };
}

/**
 * Quick placement for a big network, linear in its size: each company (with
 * its people in a ring around it) and each person without a company gets one
 * spot on a sunflower spiral that fills the frame, biggest groups in the
 * middle. Intros are drawn but don't move anyone.
 */
function placeGrouped(nodes: Node[], data: MapData, index: Map<string, number>) {
  const groups: number[][] = [];
  const byCompany = new Map<number, number[]>();
  for (const c of data.companies) {
    const g = [index.get(`c${c.id}`)!];
    byCompany.set(c.id, g);
    groups.push(g);
  }
  for (const p of data.people) {
    const i = index.get(`p${p.id}`)!;
    const g = p.company_id != null ? byCompany.get(p.company_id) : undefined;
    if (g) g.push(i);
    else groups.push([i]);
  }
  groups.sort((a, b) => b.length - a.length); // stable, so still deterministic

  const rx = W / 2 - 70;
  const ry = H / 2 - 40;
  const spacing = Math.sqrt((Math.PI * rx * ry) / groups.length);
  const golden = Math.PI * (3 - Math.sqrt(5));
  groups.forEach(([head, ...members], k) => {
    const r = Math.sqrt((k + 0.5) / groups.length);
    const cx = W / 2 + Math.cos(k * golden) * r * rx;
    const cy = H / 2 + Math.sin(k * golden) * r * ry;
    nodes[head].x = cx;
    nodes[head].y = cy;
    const ring = spacing * Math.min(1.5, 0.3 + 0.1 * Math.sqrt(members.length));
    members.forEach((m, j) => {
      const angle = (j / members.length) * Math.PI * 2;
      nodes[m].x = cx + Math.cos(angle) * ring;
      nodes[m].y = cy + Math.sin(angle) * ring;
    });
  });
}

/** Simple spring/repulsion simulation, for up to FULL_LAYOUT_MAX nodes. */
function simulate(nodes: Node[], edges: Edge[]) {
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
}

/** Above this many people the map starts on the most engaged statuses only (the chips add the rest). */
const BIG_NETWORK = 150;

export interface MapStatus {
  key: string;
  label: string;
  dot: string;
  rank: number;
}

/**
 * The people (and the companies they work at, or whose own status is shown)
 * for the chosen statuses. With every chip on, everything shows, including a
 * status the vocabulary no longer knows.
 */
function filterData(data: MapData, shown: Set<string>, all: boolean): MapData {
  if (all) return data;
  const visible = (status: string) => shown.has(status);
  const people = data.people.filter((p) => visible(p.status_key));
  const ids = new Set(people.map((p) => p.id));
  const withPeople = new Set(people.map((p) => p.company_id));
  return {
    people,
    companies: data.companies.filter((c) => withPeople.has(c.id) || visible(c.status_key)),
    connections: data.connections.filter((c) => ids.has(c.from_person_id) && ids.has(c.to_person_id)),
  };
}

/**
 * `statuses` (from the vocabulary, lib/vocab.mjs, via the page) colour the
 * nodes and make the filter chips. Hover or focus a node to isolate its
 * network; on a touch screen the first tap isolates and the second opens it.
 */
export default function NetworkMap({ data, statuses }: { data: MapData; statuses: MapStatus[] }) {
  const statusFill = useMemo(() => Object.fromEntries(statuses.map((s) => [s.key, s.dot])), [statuses]);
  const big = data.people.length > BIG_NETWORK;
  const [shown, setShown] = useState<Set<string>>(
    () => new Set((big ? statuses.filter((s) => s.rank < 3) : statuses).map((s) => s.key))
  );
  const all = shown.size === statuses.length;
  const filtered = useMemo(() => filterData(data, shown, all), [data, shown, all]);
  // Laid out in the browser after mount, never during server rendering: the
  // layout is CPU-heavy and would hold up the server's single thread (every
  // other page and the background loops), and SVG float coordinates hydrate
  // unreliably from SSR anyway.
  const [graph, setGraph] = useState<Graph | null>(null);
  useEffect(() => {
    // A tick's delay lets the placeholder paint before the layout runs.
    const timer = setTimeout(() => setGraph(layout(filtered)), 0);
    return () => clearTimeout(timer);
  }, [filtered]);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const pointer = useRef<string>("mouse");
  const nodesNow = graph?.nodes;
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !nodesNow) return null;
    const i = nodesNow.findIndex((n) => n.label.toLowerCase().includes(q));
    return i >= 0 ? i : -1;
  }, [query, nodesNow]);
  // Reset the selection when the graph is rebuilt (indices change).
  useEffect(() => {
    setHover(null);
    setPicked(null);
  }, [graph]);
  const focus = hover ?? picked ?? (found != null && found >= 0 ? found : null);
  const edges = graph?.edges;
  const neighbors = useMemo(() => {
    if (focus == null || !edges) return null;
    const set = new Set<number>([focus]);
    for (const e of edges) {
      if (e.a === focus) set.add(e.b);
      if (e.b === focus) set.add(e.a);
    }
    return set;
  }, [focus, edges]);

  const toggle = (key: string) =>
    setShown((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size ? next : cur;
    });

  const controls = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setShown(new Set(statuses.map((s) => s.key)))}
          aria-pressed={all}
          className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${all ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-100"}`}
        >
          All
        </button>
        {statuses.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={shown.has(s.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-inset ${
              shown.has(s.key) ? "bg-white font-medium text-stone-800 ring-stone-400" : "bg-stone-100 text-stone-500 ring-stone-200 line-through"
            }`}
          >
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.dot }} />
            {s.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a person or company…"
          aria-label="Find on the map"
          className="ml-auto w-full rounded-lg border border-stone-300 px-2.5 py-1 text-sm sm:w-56"
        />
      </div>
      {big && !all ? (
        <p className="text-xs text-stone-500">
          Showing {filtered.people.length} of {data.people.length} people: the most engaged statuses first, so names stay readable. Use the chips to add more.
        </p>
      ) : null}
      {found === -1 ? <p className="text-xs text-amber-700">Nobody on the map matches &ldquo;{query}&rdquo; — check the status chips.</p> : null}
    </div>
  );

  if (!graph || !edges) {
    return (
      <div className="space-y-3">
        {controls}
        <div
          className="flex w-full items-center justify-center rounded-xl border border-stone-200 bg-white text-sm text-stone-500"
          style={{ aspectRatio: `${W} / ${H}` }}
        >
          Laying out the network…
        </div>
      </div>
    );
  }
  const { nodes, simplified } = graph;
  const pick = picked != null ? nodes[picked] : null;

  return (
    <div className="space-y-3">
      {controls}
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        {simplified ? (
          <p className="rounded-t-xl border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {nodes.length.toLocaleString()} people and companies are too many to arrange properly, so
            this is a simplified map: people are grouped around their company, intros don&apos;t pull
            anyone closer, and names appear when you hover. Narrow it with the chips, or use Find.
          </p>
        ) : null}
        {pick ? (
          <p className="flex items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
            <span>
              <b>{pick.label}</b> and their connections
            </span>
            <a href={pick.href} className="font-semibold text-indigo-700 underline">
              Open profile →
            </a>
          </p>
        ) : null}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[640px]"
          onMouseLeave={() => setHover(null)}
          onPointerDown={(e) => {
            pointer.current = e.pointerType;
            // A tap on empty space clears a touch selection.
            if (e.pointerType !== "mouse" && e.target === e.currentTarget) setPicked(null);
          }}
        >
      {edges.map((e, i) => {
        const dim = neighbors && !(neighbors.has(e.a) && neighbors.has(e.b));
        const active = focus != null && (e.a === focus || e.b === focus);
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
        // A simplified map is too dense for every name: smaller marks, names on hover.
        const r = simplified ? 4 : 7 + Math.min(6, n.degree * 1.5);
        const showLabel = !simplified || (neighbors?.has(i) ?? false);
        const fill = statusFill[n.status] ?? UNKNOWN_FILL;
        return (
          // A real SVG link: keyboard-focusable, middle-click / cmd-click open
          // in a new tab, and screen readers announce it as a link.
          <a
            key={n.key}
            href={n.href}
            aria-label={`${n.label} (${n.type})`}
            style={{ opacity: dim ? 0.15 : 1 }}
            className="cursor-pointer focus:outline-none [&:focus-visible>*]:stroke-indigo-500"
            onMouseEnter={() => pointer.current === "mouse" && setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={(e) => {
              // Touch: the first tap isolates the node (with an "Open profile" link), the second opens it.
              if (pointer.current !== "mouse" && picked !== i) {
                e.preventDefault();
                setHover(null);
                setPicked(i);
              }
            }}
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
            {showLabel ? (
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
            ) : null}
          </a>
        );
      })}
        </svg>
      </div>
    </div>
  );
}
