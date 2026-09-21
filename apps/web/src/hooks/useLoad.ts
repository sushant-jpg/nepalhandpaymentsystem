import { useCallback, useEffect, useState } from "react";

export function useLoad<T>(loader: () => Promise<T>, dependencies: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await loader()); } catch (e) { setError(e instanceof Error ? e.message : "Could not load data."); } finally { setLoading(false); } }, dependencies);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
