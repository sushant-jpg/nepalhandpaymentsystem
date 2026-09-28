import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

export type BackendStatus = "checking" | "available" | "unavailable";

export function useBackendHealth() {
  const [status, setStatus] = useState<BackendStatus>("checking");

  const check = useCallback(async () => {
    setStatus("checking");
    try {
      await api.health();
      setStatus("available");
    } catch {
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => { void check(); }, [check]);
  return { status, check };
}
