import { useEffect, useState } from "react";
import type { JobOption } from "@/lib/types";

const label = (j: JobOption) => `${j.jobId} — ${j.name}`;

/** Type-to-search job selector (thousands of active jobs → datalist, not a select). */
export function JobPicker({ jobs, value, onChange }: { jobs: JobOption[]; value: string; onChange: (jobId: string | undefined) => void }) {
  const current = jobs.find((j) => j.jobId === value);
  const [text, setText] = useState(current ? label(current) : "");
  useEffect(() => setText(current ? label(current) : ""), [current]);

  function pick(raw: string) {
    setText(raw);
    const t = raw.trim();
    if (!t) return;
    const hit = jobs.find((j) => label(j) === t) ?? jobs.find((j) => j.jobId === t);
    if (hit && hit.jobId !== value) onChange(hit.jobId);
  }

  return (
    <>
      <input
        list="job-options"
        className="h-8 w-[min(380px,80vw)] rounded border border-white/20 bg-white px-2 text-[13px] font-medium text-ink"
        placeholder="— Choose a Job — (type job # or name)"
        value={text}
        onChange={(e) => pick(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setText(current ? label(current) : "")}
        aria-label="Job"
      />
      <datalist id="job-options">
        {jobs.map((j) => (
          <option key={j.jobId} value={label(j)} />
        ))}
      </datalist>
    </>
  );
}
