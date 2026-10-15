"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface RiskPoint {
  name: string;
  repo: string;
  score: number;
}

/** Highest-risk dependencies across every installed repository. */
export function RiskChart({ data }: { data: RiskPoint[] }) {
  if (data.length === 0)
    return (
      <p className="py-10 text-center text-sm text-ink-muted">
        No scans yet. Results appear after the first scan finishes.
      </p>
    );
  return (
    <div
      className="h-72 w-full"
      role="img"
      aria-label={`Risk scores: ${data.map((d) => `${d.name} ${d.score}`).join(", ")}`}
    >
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="name"
            width={130}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--ink-muted)", fontSize: 12, fontFamily: "var(--font-jetbrains)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              color: "var(--ink)",
            }}
            formatter={(v) => [String(v), "Risk score"]}
            labelFormatter={(label, payload) =>
              `${label} · ${(payload?.[0]?.payload as RiskPoint | undefined)?.repo ?? ""}`
            }
          />
          <Bar dataKey="score" radius={[0, 10, 10, 0]} barSize={18}>
            {data.map((d, i) => (
              <Cell
                key={`${d.repo}-${d.name}`}
                fill={i === 0 ? "var(--primary)" : i < 3 ? "var(--focus)" : "var(--primary-soft)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
