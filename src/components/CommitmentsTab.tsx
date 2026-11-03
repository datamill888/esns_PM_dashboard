import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ISODate } from "@/lib/dates";
import { money, money2, qty } from "@/lib/format";
import type { CommitmentRow } from "@/lib/types";
import { getCommitments } from "@/lib/api/pm.functions";
import { Card, Empty, ErrorBox, Loading, Stat } from "./ui";

export function CommitmentsTab({ jobId, asOf }: { jobId: string; asOf: ISODate }) {
  const q = useQuery({ queryKey: ["po", jobId, asOf], queryFn: () => getCommitments({ data: { jobId, asOf } }) });
  const [filter, setFilter] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    const f = filter.trim().toLowerCase();
    return all.filter((r) => {
      if (openOnly && r.amtOrdered - r.amtReceived <= 0.005) return false;
      if (!f) return true;
      return [r.poNum, r.vendorName, r.lineDescr, r.costCode, r.costType, r.poDescr].some((v) => v?.toLowerCase().includes(f));
    });
  }, [q.data, filter, openOnly]);

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} />;

  const t = (k: keyof CommitmentRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const ordered = t("amtOrdered");
  const received = t("amtReceived");
  const paid = t("paidAmt");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Stat label="Committed (Ordered)" value={money(ordered)} tone="bl" />
        <Stat label="Received / Invoiced" value={money(received)} tone="ac" />
        <Stat label="Remaining Commitment" value={money(ordered - received)} tone="fc" />
        <Stat label="Paid" value={money(paid)} tone="ev" />
      </div>

      <Card
        title="PO & SC Commitments"
        right={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open balance only
            </label>
            <input
              className="h-7 w-56 rounded border border-line px-2 text-[12px] text-ink"
              placeholder="Filter PO, vendor, cost code…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty>No purchase orders or subcontracts match.</Empty>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>PO / SC</th>
                  <th>Line</th>
                  <th>Vendor</th>
                  <th>Description</th>
                  <th>Cost Code</th>
                  <th>Cost Type</th>
                  <th>Status</th>
                  <th className="r">Unit Price</th>
                  <th className="r">Qty Ordered</th>
                  <th className="r">Qty Rcvd/Invcd</th>
                  <th className="r">Qty Remaining</th>
                  <th className="r">Amt Ordered</th>
                  <th className="r">Amt Rcvd/Invcd</th>
                  <th className="r">Amt Remaining</th>
                  <th className="r">Paid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.poNum}|${r.lineNum}`}>
                    <td className="font-semibold">{r.poNum}</td>
                    <td>{r.lineNum}</td>
                    <td className="max-w-[200px] truncate" title={r.vendorName ?? ""}>{r.vendorName ?? r.vendorId ?? "—"}</td>
                    <td className="max-w-[240px] truncate text-sub" title={r.lineDescr ?? r.poDescr ?? ""}>{r.lineDescr ?? r.poDescr ?? "—"}</td>
                    <td title={r.costCodeDescr ?? ""}>{r.costCode ?? "—"}</td>
                    <td title={r.costTypeDescr ?? ""}>{r.costType ?? "—"}</td>
                    <td>{r.status === "A" || r.status === "O" ? "Open" : r.status === "C" ? "Closed" : r.status ?? "—"}</td>
                    <td className="num r">{r.qtyOrdered ? money2(r.amtOrdered / r.qtyOrdered) : "—"}</td>
                    <td className="num r">{qty(r.qtyOrdered)}</td>
                    <td className="num r">{qty(r.qtyReceived)}</td>
                    <td className="num r">{qty(r.qtyOrdered - r.qtyReceived)}</td>
                    <td className="num r">{money(r.amtOrdered)}</td>
                    <td className="num r">{money(r.amtReceived)}</td>
                    <td className="num r font-medium">{money(r.amtOrdered - r.amtReceived)}</td>
                    <td className="num r">{money(r.paidAmt)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={11}>Total ({rows.length} lines)</td>
                  <td className="num r">{money(ordered)}</td>
                  <td className="num r">{money(received)}</td>
                  <td className="num r">{money(ordered - received)}</td>
                  <td className="num r">{money(paid)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
