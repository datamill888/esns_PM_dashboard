import { useQuery } from "@tanstack/react-query";
import { daysBetween, fmtShort, type ISODate } from "@/lib/dates";
import { money } from "@/lib/format";
import { getInvoices } from "@/lib/api/pm.functions";
import { Drill } from "./Drill";
import { Card, Empty, ErrorBox, Loading, Stat } from "./ui";

export function InvoicingTab({ jobId, asOf }: { jobId: string; asOf: ISODate }) {
  const q = useQuery({ queryKey: ["ar", jobId, asOf], queryFn: () => getInvoices({ data: { jobId, asOf } }) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data.rows;

  const all = { kind: "ar" as const };
  const sub = `Invoices dated on or before ${fmtShort(asOf)} · AR accounts 115010, 115031, 115040`;
  const billed = rows.reduce((s, r) => s + r.amount, 0);
  const rcvd = rows.reduce((s, r) => s + r.received, 0);
  const out = rows.reduce((s, r) => s + r.outstanding, 0);
  const paidRows = rows.filter((r) => r.invoiceDate && r.receivedDate);
  const dso = paidRows.length
    ? Math.round(paidRows.reduce((s, r) => s + daysBetween(r.invoiceDate!, r.receivedDate!), 0) / paidRows.length)
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Stat label="Invoiced to Date" value={<Drill title="Invoiced to date — all invoices" subtitle={sub} request={all} value={billed}>{money(billed)}</Drill>} tone="bl" sub={`${rows.length} invoices`} />
        <Stat label="Received" value={<Drill title="Received — all invoices" subtitle={sub} request={all} value={rcvd} valueColumn="rcvd_amt">{money(rcvd)}</Drill>} tone="ev" />
        <Stat label="Outstanding" value={<Drill title="Outstanding — all invoices" subtitle={sub} request={all} value={out} valueColumn="outstanding">{money(out)}</Drill>} tone="fc" />
        <Stat label="Avg Days to Pay" value={dso == null ? "—" : `${dso} days`} />
      </div>
      <Card title="Invoicing" right="AR accounts 115010 · 115031 · 115040">
        {rows.length === 0 ? (
          <Empty>No invoices for this job as of {fmtShort(asOf)}.</Empty>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Description</th>
                  <th>Invoice Date</th>
                  <th>Received Date</th>
                  <th className="r">Days Open</th>
                  <th className="r">Invoice Amount</th>
                  <th className="r">Received</th>
                  <th className="r">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = r.invoiceDate ? daysBetween(r.invoiceDate, r.receivedDate ?? asOf) : null;
                  return (
                    <tr key={`${r.invoiceNum}|${r.invoiceDate}`}>
                      <td className="font-semibold">{r.invoiceNum}</td>
                      <td className="max-w-[260px] truncate text-sub" title={r.description ?? ""}>{r.description ?? "—"}</td>
                      <td>{fmtShort(r.invoiceDate)}</td>
                      <td>{fmtShort(r.receivedDate)}</td>
                      <td className={`num r ${!r.receivedDate && open != null && open > 60 ? "font-semibold text-bad" : ""}`}>{open ?? "—"}</td>
                      <td className="num r">
                        <Drill title={`Invoice ${r.invoiceNum}`} subtitle={`Invoiced ${fmtShort(r.invoiceDate)}`} request={{ kind: "ar", invoiceNum: r.invoiceNum, invoiceDate: r.invoiceDate }} value={r.amount}>{money(r.amount)}</Drill>
                      </td>
                      <td className="num r">
                        <Drill title={`Invoice ${r.invoiceNum} — received`} subtitle={`Invoiced ${fmtShort(r.invoiceDate)}`} request={{ kind: "ar", invoiceNum: r.invoiceNum, invoiceDate: r.invoiceDate }} value={r.received} valueColumn="rcvd_amt">{money(r.received)}</Drill>
                      </td>
                      <td className={`num r ${r.outstanding > 0 ? "font-semibold text-fc" : ""}`}>
                        <Drill title={`Invoice ${r.invoiceNum} — outstanding`} subtitle={`Invoiced ${fmtShort(r.invoiceDate)}`} request={{ kind: "ar", invoiceNum: r.invoiceNum, invoiceDate: r.invoiceDate }} value={r.outstanding} valueColumn="outstanding">{money(r.outstanding)}</Drill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Total</td>
                  <td className="num r"><Drill title="Invoiced to date — all invoices" subtitle={sub} request={all} value={billed}>{money(billed)}</Drill></td>
                  <td className="num r"><Drill title="Received — all invoices" subtitle={sub} request={all} value={rcvd} valueColumn="rcvd_amt">{money(rcvd)}</Drill></td>
                  <td className="num r"><Drill title="Outstanding — all invoices" subtitle={sub} request={all} value={out} valueColumn="outstanding">{money(out)}</Drill></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
