import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

export function useApiData<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load data.");
    } finally {
      setLoading(false);
    }
  }, dependencies);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, loading, reload };
}
