import type { ReactNode } from "react";
import { Tiko, type TikoMood } from "../tiko";

export function EmptyState({
  title,
  body,
  action,
  mood = "think",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  mood?: TikoMood;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-border px-6 py-12 text-center">
      <Tiko mood={mood} size={84} />
      <h3 className="mt-2 text-lg font-bold">{title}</h3>
      <p className="max-w-[46ch] text-sm text-ink-muted">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
