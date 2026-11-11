import React from "react";
import { ArrowUpRight } from "lucide-react";
import "./landing-ios.css";

const screenshots = [
  {file:"projects.jpg", label:"Projects", alt:"Splece on iPhone showing three local film projects and illustrated templates"},
  {file:"timeline.jpg", label:"Timeline", alt:"Splece on iPhone showing an illustrated sunset scene above its five-second timeline"},
];

export function MobileShowcase({download, standalone=false}) {
  const Heading=standalone ? "h1" : "h2";
  return <section className="lp-ios lp-container" id="ios" aria-labelledby="lp-ios-title">
    <div className="lp-ios-copy">
      <span className="lp-eyebrow">SPLECE MOBILE</span>
      <Heading id="lp-ios-title">Splece for<br/><span>iPhone &amp; iPad.</span></Heading>
      <p>Storyboard a scene, direct a take, then cut it on the timeline. Edit and export on your device. Online AI sends selected prompts and references to your provider.</p>
      {download ? <a className="lp-button lp-button-primary" href={download.href}>{download.label} <ArrowUpRight size={16}/></a>
        : <div><strong className="lp-ios-status">Submitted for App Store review</strong><small>Already invited? Open your Apple invitation in <a className="lp-text-link" href="https://testflight.apple.com/">TestFlight</a>.</small></div>}
      <small>Android is in development.</small>
    </div>
    <div className="lp-ios-gallery" aria-label="iPhone app screenshots">
      {screenshots.map(({file,label,alt})=><figure key={file}>
        <a href={'/marketing/ios/'+file} aria-label={'View full-size '+label+' screenshot'} target="_blank" rel="noreferrer">
          <img src={'/marketing/ios/'+file} width="736" height="1600" alt={alt} loading="lazy"/>
        </a>
        <figcaption>{label}</figcaption>
      </figure>)}
    </div>
  </section>;
}
