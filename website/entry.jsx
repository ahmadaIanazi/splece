import React from "react";
import { createRoot } from "react-dom/client";
import { LandingPage } from "../src/landing";
import "./site.css";

// Public marketing site: no local service discovery or editor bundle.
createRoot(document.getElementById("root")).render(
  <LandingPage studioAvailable={false} publicSite />,
);
