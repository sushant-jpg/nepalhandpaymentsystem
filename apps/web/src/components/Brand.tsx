import { Hand } from "lucide-react";
import { Link } from "react-router-dom";

export function Brand({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <Link to="/" className={`inline-flex items-center gap-2.5 rounded-lg ${light ? "text-white" : "text-ink"}`} aria-label="Nepal Hand Pay home">
    <span className={`grid size-10 place-items-center rounded-xl ${light ? "bg-white/15" : "bg-forest-600 text-white"}`}><Hand size={21} strokeWidth={2.2} /></span>
    {!compact && <span className="font-display text-lg font-extrabold tracking-tight">Nepal Hand <span className={light ? "text-emerald-300" : "text-forest-600"}>Pay</span></span>}
  </Link>;
}
