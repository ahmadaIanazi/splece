import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MobileShowcase } from "../../src/landing-ios.jsx";
import { iosDownload } from "../../shared/ios-download.mjs";
import "../../src/landing.css";
import "../site.css";

function IOSPage() {
  const [download,setDownload]=useState(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/downloads.json",{cache:"no-cache",signal:controller.signal})
      .then(r=>r.ok?r.json():null)
      .then(data=>setDownload(iosDownload(data?.ios))).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  return <div className="splece-landing lp-mobile-page" data-splece-theme="sculpted">
    <header className="lp-nav lp-container">
      <a className="lp-wordmark" href="/" aria-label="Splece home"><img className="lp-brand-lockup" src="/brand/splece-logo-white.svg" width="150" height="40" alt="Splece"/></a>
      <a className="lp-nav-cta" href="/#download">Desktop downloads</a>
    </header>
    <main><MobileShowcase download={download} standalone /></main>
    <footer className="lp-footer lp-container"><a href="/privacy/">iOS privacy policy</a><a href="/support/">Support</a><a href="/">Splece home</a></footer>
  </div>;
}
createRoot(document.getElementById("root")).render(<IOSPage/>);
