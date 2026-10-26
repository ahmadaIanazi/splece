import { useEffect, useState } from "react";
import { api } from "./state";
export function useSharedLibrary(project) {
  const [entries, setEntries] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api("/library/assets")
      .then((v) => {
        if (live) {
          setEntries(v);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [project.id]);
  return {
    entries: entries.filter(
      (e) =>
        e.owner !== project.id &&
        !project.assets.some((a) => a.libraryId === e.id),
    ),
    error,
    loading,
  };
}
