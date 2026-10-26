import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { canOpenStudio } from "../shared/home-entry.mjs";
import { LandingPage } from "./landing";

const Studio = lazy(() => import("./main"));
function OpeningStudio() {
  return (
    <div className="splece-opening" data-splece-theme="sculpted" role="status">
      <img src="/splece.svg" alt="" width="48" height="48" />
      <span>Opening your studio…</span>
    </div>
  );
}
function Entry() {
  const preview = window.location.pathname.replace(/\/$/, "") === "/welcome";
  const [state, setState] = useState("checking");
  useEffect(() => {
    let active = true;
    canOpenStudio(window.location).then((available) => {
      if (active) setState(available ? "studio" : "visitor");
    });
    return () => {
      active = false;
    };
  }, []);
  if (!preview && state === "checking") return <OpeningStudio />;
  if (!preview && state === "studio")
    return (
      <Suspense fallback={<OpeningStudio />}>
        <Studio />
      </Suspense>
    );
  return <LandingPage studioAvailable={state === "studio"} />;
}
createRoot(document.getElementById("root")).render(<Entry />);
