"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Present means sortable. */
  sortValue?: (row: T) => number | string;
}

export function SortableTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  caption,
}: {
  rows: readonly T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  caption: string;
}) {
  const [sort, setSort] = useState(initialSort);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sortValue || !sort) return rows;
    const get = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => ({ key, dir: s?.key === key && s.dir === "desc" ? "asc" : "desc" }));

  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  {c.sortValue ? (
                    <button onClick={() => toggle(c.key)}>
                      {c.label}
                      {active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
