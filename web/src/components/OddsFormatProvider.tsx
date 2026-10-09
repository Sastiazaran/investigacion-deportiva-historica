"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  ODDS_FORMAT_QUERY,
  ODDS_FORMAT_STORAGE_KEY,
  isOddsFormat,
  type OddsFormat,
} from "../lib/odds-format";

type OddsFormatContextValue = {
  format: OddsFormat;
  setFormat: (format: OddsFormat) => void;
};

const OddsFormatContext = createContext<OddsFormatContextValue>({
  format: "decimal",
  setFormat: () => {},
});

function readFormat(): OddsFormat {
  const query = new URLSearchParams(window.location.search).get(ODDS_FORMAT_QUERY);
  if (isOddsFormat(query)) return query;
  const stored = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
  if (isOddsFormat(stored)) return stored;
  return "decimal";
}

export function OddsFormatProvider({ children }: { children: React.ReactNode }) {
  const [format, setFormatState] = useState<OddsFormat>("decimal");

  useEffect(() => {
    const apply = () => {
      const next = readFormat();
      setFormatState(next);
      const query = new URLSearchParams(window.location.search).get(ODDS_FORMAT_QUERY);
      if (isOddsFormat(query)) {
        window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, query);
      }
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  const setFormat = (next: OddsFormat) => {
    setFormatState(next);
    window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, next);
    const url = new URL(window.location.href);
    if (next === "american") url.searchParams.set(ODDS_FORMAT_QUERY, "american");
    else url.searchParams.delete(ODDS_FORMAT_QUERY);
    window.history.replaceState(null, "", url);
  };

  const value = useMemo(() => ({ format, setFormat }), [format]);
  return <OddsFormatContext.Provider value={value}>{children}</OddsFormatContext.Provider>;
}

export function useOddsFormat() {
  return useContext(OddsFormatContext);
}
