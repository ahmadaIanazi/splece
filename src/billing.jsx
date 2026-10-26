import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Wallet,
  RefreshCw,
  BarChart3,
  Film,
  FileText,
  BookOpen,
} from "lucide-react";
import { api, tc } from "./state";
import { money } from "../shared/costs.mjs";

export function useBilling(projectId, episodeId) {
  const [accounts, setAccounts] = useState(null),
    [report, setReport] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const live = useRef(true),
    current = useRef(projectId);
  current.current = projectId;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const loadReport = useCallback(async () => {
    if (!projectId) return;
    const result = await api(`/projects/${projectId}/costs`);
    if (live.current && current.current === projectId) setReport(result);
  }, [projectId]);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api("/billing/balances")
        .then((r) => {
          if (!stopped) setAccounts(r);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("studio-mode-changed", load);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("studio-mode-changed", load);
    };
  }, []);
  useEffect(() => {
    let stopped = false;
    const load = () =>
      loadReport().catch((e) => {
        if (!stopped) setError(e.message);
      });
    load();
    const timer = setInterval(load, 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [loadReport, episodeId]);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const r = await api("/billing/refresh", {});
      if (live.current) setAccounts(r);
      await loadReport();
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return {
    accounts,
    report: report?.projectId === projectId ? report : null,
    error,
    busy,
    refresh,
  };
}
const names = { venice: "Venice", deepseek: "DeepSeek", fal: "fal.ai" };
function shortBalance(account) {
  if (!account?.configured) return "—";
  const monetary =
    account.balances?.find((b) => b.currency === "USD") ||
    account.balances?.find((b) => b.currency === "CNY");
  const diem = account.balances?.find(
    (b) => b.currency === "DIEM" && b.amount > 0,
  );
  return (
    [
      monetary && money(monetary.amount, monetary.currency),
      diem && money(diem.amount, "DIEM"),
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}
export function BillingHeader({ billing, onOpen, onConnections }) {
  const { accounts, report, busy, refresh, error } = billing;
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (
        e.key === "Escape" ||
        (e.type === "pointerdown" && !root.current?.contains(e.target))
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="billing-compact" ref={root}>
      <button
        className="credits-trigger"
        aria-label="Credits and connections"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Wallet size={15} />
        <span>
          {report?.totals?.estimated > 0 ? "~" : ""}
          {report ? money(report.total) : "—"}
          {report?.totals?.unknown > 0 ? " + ?" : ""}
        </span>
        <small>project</small>
      </button>
      {open && (
        <div className="credits-popover">
          <header>
            <b>Credits & connections</b>
            <button
              className="icon"
              title="Refresh balances"
              aria-label="Refresh balances"
              disabled={busy}
              onClick={refresh}
            >
              <RefreshCw size={14} />
            </button>
          </header>
          {Object.entries(names).map(([id, name]) => {
            const a = accounts?.providers?.[id];
            return (
              <div className="credit-provider" key={id}>
                <span>
                  <i data-connected={!!a?.configured} />
                  {name}
                </span>
                <b>{shortBalance(a)}</b>
                <small>
                  {a?.balanceUnavailable ? "Key saved · balance unavailable" : a?.error
                    ? "Connection needs attention"
                    : a?.configured
                      ? a.cached
                        ? "Saved balance"
                        : "Connected"
                      : "Not connected"}
                </small>
              </div>
            );
          })}
          {error && <p role="alert">{error}</p>}
          <button
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          >
            <BarChart3 size={14} />
            Project costs {report ? money(report.total) : ""}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onConnections?.();
            }}
          >
            <Wallet size={14} />
            Manage connections
          </button>
        </div>
      )}
    </div>
  );
}
const costLabels = {
  confirmed: "confirmed",
  estimated: "estimated",
  unknown: "cost unavailable",
  pending: "queued quote",
  test: "Offline · no charge",
  "not-submitted": "not charged / not submitted",
};
export function GenerationCost({ record }) {
  if (!record) return null;
  return (
    <span className="generation-cost">
      {money(record.amount)} <small>USD · {costLabels[record.status]}</small>
      {record.charges
        ?.filter((c) => c.currency !== "USD")
        .map((c, i) => (
          <small key={i}> · {money(c.amount, c.currency)}</small>
        ))}
    </span>
  );
}
export function CostPanel({ billing, project, onSeek }) {
  const { accounts, report, busy, error, refresh } = billing;
  const [selected, setSelected] = useState(null),
    [showTest, setShowTest] = useState(false);
  const chart = report?.bins || [],
    maximum = Math.max(0.01, ...chart.map((b) => b.amount));
  const selectedBin = selected === null ? null : chart[selected];
  const records = (report?.records || []).filter(
    (r) =>
      (showTest || !r.test) &&
      (!selectedBin || selectedBin.jobs.includes(r.key)),
  );
  return (
    <div className="cost-panel">
      <div className="cost-panel-heading">
        <div>
          <strong>{project.name}</strong>
          <small>All episodes · every attempt, including removed clips</small>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          title="Read balances and billing history; no generation credits used"
        >
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          {busy ? "Refreshing…" : "Refresh balances"}
        </button>
      </div>
      {error && (
        <p role="alert" className="cost-warning">
          {error}
        </p>
      )}
      <div className="cost-totals">
        <div className="total">
          <small>Project total · USD value</small>
          <strong>{report ? money(report.total) : "…"}</strong>
          <span>
            {report?.totals.estimated > 0
              ? "Includes estimates"
              : "Recorded cost"}
          </span>
        </div>
        <div>
          <small>Confirmed</small>
          <strong>{money(report?.totals.confirmed)}</strong>
        </div>
        <div>
          <small>Estimated</small>
          <strong>{money(report?.totals.estimated)}</strong>
        </div>
        <div>
          <small>Queued quotes</small>
          <strong>{money(report?.totals.pending)}</strong>
          <span>Not added to spending</span>
        </div>
      </div>
      {report?.totals.unknown > 0 && (
        <p className="cost-warning">
          {report.totals.unknown} request(s) have no reliable price or usage
          record. Their cost is not included above.
        </p>
      )}
      <div className="provider-balances">
        {["venice", "deepseek"].map((provider) => {
          const a = accounts?.providers?.[provider];
          return (
            <section key={provider}>
              <h3>
                {names[provider]} <small>account balance</small>
              </h3>
              {a?.balances?.length ? (
                <div className="balance-values">
                  {a.balances.map((b) => (
                    <span key={b.currency}>
                      <b>{money(b.amount, b.currency)}</b>
                      {b.granted != null && (
                        <small>
                          Includes {money(b.granted, b.currency)} granted
                        </small>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p>
                  {a?.configured
                    ? "Balance not fetched yet"
                    : "Add an API key in Settings"}
                </p>
              )}
              <small>
                {a?.checkedAt
                  ? `${a.cached ? "Saved" : "Updated"} ${new Date(a.checkedAt).toLocaleString()}`
                  : "Refresh reads balances without generating anything."}
              </small>
              {a?.available === false && (
                <p className="cost-warning">
                  Provider reports insufficient balance.
                </p>
              )}
              {a?.error && <p className="cost-warning">{a.error}</p>}
              {a?.history?.error && (
                <p className="cost-warning">{a.history.error}</p>
              )}
            </section>
          );
        })}
      </div>
      <div className="cost-chart-heading">
        <h3>
          <BarChart3 size={16} /> Cost across this episode
        </h3>
        {selectedBin && (
          <button onClick={() => setSelected(null)}>Show all requests</button>
        )}
      </div>
      <p className="cost-caption">
        Each bar covers 10 seconds and includes every regeneration. Longer clips
        are divided across bars. Removed clips retain their submitted position.
        Text work is listed separately below.
      </p>
      <div className="cost-chart" aria-label="Generation cost per ten seconds">
        <div className="cost-chart-bars">
          {chart.map((bin, i) => (
            <button
              key={i}
              className={selected === i ? "selected" : ""}
              aria-label={`${tc(bin.start)} to ${tc(bin.end)}: ${money(bin.amount)}, ${bin.jobs.length} attempts`}
              title={`${tc(bin.start)}–${tc(bin.end)} · ${money(bin.amount)} · ${bin.jobs.length} attempts${bin.removed ? ` · ${bin.removed} removed` : ""}`}
              onClick={() => setSelected(selected === i ? null : i)}
            >
              <span className="cost-bar-value">{money(bin.amount)}</span>
              <span
                className="cost-bar"
                style={{
                  height: `${Math.max(1, (Math.max(0, bin.amount) / maximum) * 100)}px`,
                }}
              >
                <i
                  style={{
                    height: `${bin.amount > 0 ? (Math.max(0, bin.confirmed) / bin.amount) * 100 : 0}%`,
                  }}
                />
              </span>
              <small>{tc(bin.start).slice(0, -2)}</small>
            </button>
          ))}
        </div>
      </div>
      {selectedBin && (
        <div className="cost-bin-detail">
          <b>
            {tc(selectedBin.start)}–{tc(selectedBin.end)} ·{" "}
            {money(selectedBin.amount)}
          </b>
          <span>{selectedBin.jobs.length} attempts</span>
          <button onClick={() => onSeek(selectedBin.start)}>
            <Film size={14} /> Go to timeline
          </button>
        </div>
      )}
      <div className="cost-record-heading">
        <h3>{selectedBin ? "Requests in this range" : "Request history"}</h3>
        <label>
          <input
            type="checkbox"
            checked={showTest}
            onChange={(e) => setShowTest(e.target.checked)}
          />{" "}
          Include offline previews
        </label>
      </div>
      <div className="cost-records">
        {records.map((r) => {
          const Icon =
            r.kind === "video"
              ? Film
              : r.kind === "story"
                ? BookOpen
                : FileText;
          return (
            <div className="cost-record" key={r.key}>
              <Icon size={17} />
              <div>
                <b>{r.title}</b>
                <small>
                  {names[r.provider] || r.provider} · {r.model} · {r.state}
                </small>
                <small>
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                  {r.usage
                    ? ` · ${r.usage.prompt_tokens ?? "?"} input / ${r.usage.completion_tokens ?? "?"} output tokens`
                    : ""}
                </small>
                {r.estimate && (
                  <small title={r.estimate.note}>
                    Rate card {r.estimate.verified} · {r.estimate.note}
                  </small>
                )}
              </div>
              <GenerationCost record={r} />
            </div>
          );
        })}
        {!records.length && (
          <p className="muted">No paid requests in this view.</p>
        )}
      </div>
      <p className="cost-caption">
        Venice quotes stay estimated until a billing entry matches the request
        ID. fal.ai charges remain historical estimates. DeepSeek uses recorded
        token usage and a dated price estimate. USD, DIEM and CNY account
        balances remain separate; USD project values do not imply a cash debit.
      </p>
    </div>
  );
}
