import { useEffect, useState } from "react";
import { Download, Filter, Search } from "lucide-react";
import type { TransactionView } from "@nepal-hand-pay/shared-types";
import { api } from "../lib/api";
import { dateTime, npr } from "../lib/format";
import { Empty, Loading, Notice, PageTitle, Status } from "../components/Ui";

export function TransactionsPage() {
  const [items, setItems] = useState<TransactionView[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    setLoading(true); setError("");
    api.get<{ items: TransactionView[]; pagination: { pages: number } }>(`/transactions?page=${page}&limit=15${status ? `&status=${status}` : ""}${risk ? `&riskLevel=${risk}` : ""}`)
      .then((data) => { setItems(data.items); setPages(data.pagination.pages); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Transactions could not be loaded."))
      .finally(() => setLoading(false));
  }, [page, status, risk]);

  const visible = items.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageTitle eyebrow="Money trail" title="Transactions" description="Searchable, paginated payment records. Completed financial records are retained rather than deleted." />
    <div className="card mb-5 flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><input className="input !mt-0 pl-9" placeholder="Search current page by transaction or party" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <label className="sr-only" htmlFor="status-filter">Status</label><select id="status-filter" className="input !mt-0 sm:w-48" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["SUCCESS", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"].map((value) => <option key={value}>{value}</option>)}</select>
      <label className="sr-only" htmlFor="risk-filter">Risk</label><select id="risk-filter" className="input !mt-0 sm:w-40" value={risk} onChange={(event) => { setRisk(event.target.value); setPage(1); }}><option value="">All risk</option>{["LOW", "MEDIUM", "HIGH", "BLOCKED"].map((value) => <option key={value}>{value}</option>)}</select>
      <span className="grid size-11 place-items-center rounded-xl bg-forest-50 text-forest-600"><Filter size={18} /></span>
    </div>
    {error && <Notice>{error}</Notice>}
    {loading ? <Loading /> : visible.length ? <div className="card overflow-x-auto p-0"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-4">Transaction</th><th className="px-5 py-4">Party</th><th className="px-5 py-4">Amount</th><th className="px-5 py-4">Status</th><th className="px-5 py-4">Risk</th><th className="px-5 py-4">Date</th><th className="px-5 py-4"><span className="sr-only">Receipt</span></th></tr></thead><tbody className="divide-y divide-slate-100">{visible.map((item) => <tr key={item.transactionId} className="hover:bg-slate-50/60"><td className="px-5 py-4 font-mono text-xs font-semibold text-ink">{item.transactionId}</td><td className="px-5 py-4">{item.merchantName || item.customerName || "—"}</td><td className="px-5 py-4 font-bold">{npr(item.amount)}</td><td className="px-5 py-4"><Status value={item.status} /></td><td className="px-5 py-4"><Status value={item.riskLevel} /></td><td className="px-5 py-4 text-slate-500">{dateTime(item.createdAt)}</td><td className="px-5 py-4"><button className="rounded-lg p-2 text-forest-600 hover:bg-forest-50" onClick={() => void api.download(`/transactions/${item.transactionId}/receipt.pdf`, `${item.transactionId}.pdf`)} aria-label={`Download receipt ${item.transactionId}`}><Download size={18} /></button></td></tr>)}</tbody></table></div> : <Empty title="No matching transactions" detail="Try changing the selected filters." />}
    <div className="mt-5 flex items-center justify-between text-sm text-slate-500"><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.max(1, pages)}</span><button className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
  </>;
}
