import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Download,
  Check,
  Plus,
  Minus,
  Monitor,
  HardDrive,
  Plug,
  Scissors,
  Layers,
  Sparkles,
  BookOpen,
  Folder,
  ArrowLeftRight,
  LockKeyhole,
  ShieldCheck,
  Code2,
} from "lucide-react";
import {downloadDevice, platformNames} from "../shared/download-platform.mjs";
import { isAppleMobile, iosDownload } from "../shared/ios-download.mjs";
import { MobileShowcase } from "./landing-ios.jsx";
import { releaseLink } from "../shared/home-entry.mjs";
import "./landing.css";
import "./landing-showcase.css";

function PlatformIcon({ platform, ...props }) {
  if(platform === "linux") return <Monitor aria-hidden="true" {...props} />;
  return platform === "mac" ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M16.8 12.7c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3.1-1.7-1.3-.1-2.5.8-3.2.8-.6 0-1.6-.8-2.7-.8-1.4 0-2.8.9-3.5 2.1-1.5 2.6-.4 6.4 1 8.5.7 1 1.4 2.1 2.5 2 1 0 1.4-.6 2.7-.6s1.7.6 2.8.6c1.2 0 1.9-1 2.5-2 .8-1.1 1.2-2.3 1.2-2.3s-1.9-.8-1.9-3.5ZM14.8 6.5c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m3 5 8-1.1v7.2H3Zm9-1.3L22 2v9.1H12ZM3 12h8v7.2L3 18Zm9 0h10v10l-10-1.7Z" />
    </svg>
  );
}
const steps = [
  {
    number: "01",
    icon: BookOpen,
    title: "Start with a scene.",
    text: "Write on an intuitive canvas. Bring your characters, references and camera direction together. Reuse the details, instead of retyping them.",
    note: "A canvas for creative direction",
  },
  {
    number: "02",
    icon: Layers,
    title: "Find your favorite take.",
    text: "Try another model. Explore another take. Compare what works, with your earlier results and their prompts always close by.",
    note: "Room for every iteration",
  },
  {
    number: "03",
    icon: Scissors,
    title: "Make it your film.",
    text: "Trim imperfect moments, refine a range, arrange your clips and shape the sound. Go from generation to the final cut in one workspace.",
    note: "An editor built around AI",
  },
];
const faqs = [
  [
    "Is Splece really free?",
    "The editor is free. Editing imported footage and exporting locally do not use AI credits. Online generation uses your own supported provider keys, and those providers bill you separately. Offline mode uses sample footage so you can explore without paid generation.",
  ],
  [
    "What makes Splece built for AI?",
    "The canvas, reference library, prompts, takes and timeline belong to one workflow. Generate alternatives, compare results and refine the parts that need attention. Simple defaults handle repeated details, while you can inspect the prepared prompt and change supported model settings.",
  ],
  [
    "What stays on my computer?",
    "Project storage, editing, playback and export run locally. When you use live AI, the prompts, references, video or audio needed for that request go to the provider you choose. Results are saved back to your local project. Your API keys are stored separately from portable project bundles.",
  ],
  [
    "Which AI providers can I use?",
    "Connect your own keys for supported workflows through Venice and fal.ai, with DeepSeek available for smart writing. Capabilities depend on the selected model; connecting a provider does not enable its entire catalog. You can also edit your own footage without an AI key.",
  ],
  [
    "When can I download it or see the source?",
    "Splece is in beta. Choose your system below for current downloads and installation instructions. The source is available on GitHub under Apache 2.0. See the iPhone and iPad section for mobile availability.",
  ],
  [
    "Do I need a powerful graphics card?",
    "Connected providers run the AI models. Your computer handles playback, storage and export, so larger projects need more disk space and processing power. Hardware minimums and supported packaged-app operating systems will be confirmed with the releases.",
  ],
  [
    "Can I work offline or move my projects?",
    "You can edit and export media already on your computer offline. Online AI and downloads need internet. To move a project, save a portable checkpoint and copy its entire folder, including media and the hidden .frame folder. Keep the local service running and your computer awake while background jobs work.",
  ],
];
function LocalWorkflow() {
  return (
    <section
      className="lp-local-flow lp-container"
      id="how-it-works"
      aria-labelledby="local-flow-title"
    >
      <div className="lp-flow-heading">
        <span className="lp-eyebrow">02 / LOCAL BY DESIGN</span>
        <h2 id="local-flow-title">
          A browser tab.
          <br />
          <span>A studio on your computer.</span>
        </h2>
        <p>
          Splece connects your local project folder to an editor in your
          browser. <br />
          Your media and your edits stay in a project folder you control.
        </p>
      </div>
      <figure
        className="lp-computer-diagram"
        aria-label="Your computer contains your project folders, the Splece local app, and the browser editor. Files move between them locally. Optional online AI providers receive prompts and selected references when you use AI features."
      >
        <div className="lp-computer-label">
          <Monitor size={16} />
          <span>YOUR COMPUTER</span>
          <span>
            <PlatformIcon platform="mac" width="14" height="14" />
            <PlatformIcon platform="windows" width="13" height="13" /> Mac or
            Windows
          </span>
        </div>
        <div className="lp-flow-nodes">
          <div className="lp-folder-window">
            <div className="lp-window-top">
              <span className="lp-window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>Finder / File Explorer</span>
            </div>
            <div className="lp-folder-project">
              <Folder size={29} />
              <span>
                After the rain<small>Your project folder</small>
              </span>
            </div>
            <div className="lp-folder-files">
              <span>
                <Folder size={17} /> Media <small>Your footage & takes</small>
              </span>
              <span>
                <Folder size={17} /> Project <small>Your scenes & edits</small>
              </span>
              <span>
                <Folder size={17} /> Exports <small>Your finished films</small>
              </span>
            </div>
          </div>
          <div className="lp-local-bridge">
            <ArrowLeftRight className="lp-flow-arrow" size={26} />
            <div>
              <img src="/splece.svg" width="48" height="48" alt="" />
              <strong>Splece</strong>
              <span>Runs locally</span>
            </div>
            <ArrowLeftRight className="lp-flow-arrow" size={26} />
          </div>
          <div className="lp-browser-window">
            <div className="lp-window-top">
              <LockKeyhole size={12} />
              <span>Local browser editor</span>
            </div>
            <img
              src="/marketing/splece-editor.webp"
              alt="Splece’s browser editor connected to your local project"
              width="1280"
              height="720"
              loading="lazy"
            />
          </div>
        </div>
        <figcaption>
          <ShieldCheck size={17} />
          <strong>Local editing. Local export.</strong>
          <span>No project upload required.</span>
        </figcaption>
      </figure>
      <div className="lp-optional-ai">
        <span className="lp-ai-branch" aria-hidden="true" />
        <div>
          <Plug size={18} />
          <strong>Connect your AI.</strong>
          <span>Your keys. Your choice.</span>
        </div>
        <p>
          Online AI sends the required prompts, references or media to your chosen
          provider. <br />
          Generated media is saved back to your local project. Provider usage is
          billed separately.
        </p>
      </div>
    </section>
  );
}
export function LandingPage({ studioAvailable, publicSite = false }) {
  const [appleMobile] = useState(() => isAppleMobile(navigator));
  const [device] = useState(() => downloadDevice(navigator));
  const [platform, setPlatform] = useState(device.platform || "mac");
  const [releases, setReleases] = useState({});
  const [guide, setGuide] = useState(false);
  const [installGuide, setInstallGuide] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/downloads.json", { signal: controller.signal, cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((value) =>
        setReleases({
          version: typeof value?.version === "string" ? value.version : "0.1.0",
          ios: iosDownload(value?.ios),
          mac: releaseLink(value?.mac),
          windows: releaseLink(value?.windows),
          linux: releaseLink(value?.linux),
          source: publicSite ? null : releaseLink(value?.source),
        }),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [publicSite]);
  const installer = releaseLink(releases[platform]);
  const source = releaseLink(releases.source);
  const name = platformNames[platform];
  return (
    <div className="splece-landing" data-splece-theme="sculpted">
      <a className="lp-skip" href="#main-content">
        Skip to content
      </a>
      <main id="main-content" tabIndex={-1}>
        <div className="lp-opening">
          <header className="lp-nav lp-container">
            <a
              className="lp-wordmark"
              href={publicSite ? "/" : "/welcome"}
              aria-label="Splece home"
            >
              <img
                className="lp-brand-lockup"
                src="/brand/splece-logo-white.svg"
                alt="Splece"
                width="150"
                height="40"
              />
            </a>
            <nav aria-label="Main navigation">
              <a href={publicSite ? "/ios/" : "#ios"}>iPhone &amp; iPad</a>
              <a href="#how-it-works">Local by design</a>
              <a href="https://github.com/ahmadaIanazi/splece/blob/main/docs/guide/README.md" target="_blank" rel="noreferrer">Docs</a>
            </nav>
            <a
              className="lp-nav-cta"
              href={studioAvailable ? "/#home" : appleMobile ? "#ios" : "#download"}
            >
              {studioAvailable ? "Open studio" : appleMobile ? "Splece for iOS" : "Get Splece"}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </header>
          <section
            className="lp-hero lp-container"
            aria-labelledby="hero-title"
          >
            <div className="lp-hero-top">
              <div className="lp-hero-copy">
                <div className="lp-eyebrow lp-hero-eyebrow">
                  <span className="lp-status-dot" aria-hidden="true" /> THE AI
                  VIDEO GENERATOR + EDITOR
                </div>
                <h1 id="hero-title">
                  Less imagining.
                  <br />
                  <span>More “I made this.”</span>
                </h1>
              </div>
              <div className="lp-hero-intro">
                <p>
                  Free. Open source. Local by design.<br />
                  Bring your own API keys.
                </p>
              </div>
            </div>
            <figure className="lp-real-preview"><a href="/marketing/splece-editor.webp" target="_blank" rel="noreferrer" aria-label="View the full editor screenshot"><img src="/marketing/splece-editor.webp" alt="Splece’s real desktop editor with staged AI footage, preview and timeline" width="1280" height="720" fetchPriority="high" /></a></figure>
            <div className="lp-opening-foot">
              <div
                className="lp-principles"
                aria-label="Free editor, private projects, local editing"
              >
                <span>
                  <Check size={15} aria-hidden="true" /> Free editor
                </span>
                <span>
                  <ShieldCheck size={15} aria-hidden="true" /> Private projects
                </span>
                <span>
                  <HardDrive size={15} aria-hidden="true" /> Local editing
                </span>
              </div>
              <a href="#workflow">
                Meet your new workflow{" "}
                <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>
          </section>
        </div>
        <div className="lp-details">
          <section
            className="lp-workflow lp-container"
            id="workflow"
            aria-labelledby="workflow-title"
          >
            <div className="lp-section-heading">
              <div>
                <span className="lp-eyebrow">01 / FROM IDEA TO FINAL CUT</span>
                <h2 id="workflow-title">
                  Good ideas take
                  <br />
                  <span>a few takes.</span>
                </h2>
              </div>
              <p>
                Unexpected results are part of AI filmmaking.
                <br />
                Your workspace should make room for them.
              </p>
            </div>
            <div className="lp-step-grid">
              {steps.map(({ number, icon: Icon, title, text, note }) => (
                <article className="lp-step" key={number}>
                  <div className="lp-step-top">
                    <span>{number}</span>
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <div className="lp-step-bottom">
                    {note}
                    <ArrowRight size={16} aria-hidden="true" />
                  </div>
                </article>
              ))}
            </div>
            <div className="lp-control-note">
              <Sparkles size={19} aria-hidden="true" />
              <p>
                <strong>Less repeated prompting. More creative control.</strong>{" "}
                Splece connects the context behind the scenes. Your prompts and
                model settings are still yours to change.
              </p>
            </div>
          </section>
          <LocalWorkflow />
          <section
            className="lp-beliefs lp-container"
            aria-label="Free software and creative freedom"
          >
            <div>
              <span className="lp-eyebrow">YOUR STUDIO. YOUR TERMS.</span>
              <h2>
                Bring your keys.
                <br />
                <span>Keep your freedom.</span>
              </h2>
            </div>
            <div className="lp-belief-list">
              <article>
                <Plug size={22} aria-hidden="true" />
                <div>
                  <h3>Free editor. Your choice of AI.</h3>
                  <p>
                    Use supported models through your own provider accounts. Pay
                    your provider for the AI you use. Editing and local export
                    are free.
                  </p>
                </div>
              </article>
              <article>
                <Code2 size={22} aria-hidden="true" />
                <div>
                  <h3>Open source. Your creative freedom.</h3>
                  <p>
                    Original code licensed under Apache 2.0, created by Ahmad
                    Alanazi. Explore the source on GitHub. The Splece
                    name and logo remain reserved.
                  </p>
                  <a className="lp-text-link" href="https://github.com/ahmadaIanazi/splece" target="_blank" rel="noreferrer">
                    View on GitHub{" "}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </div>
              </article>
            </div>
          </section>
          <MobileShowcase download={releases.ios} />
          <section className="lp-download lp-container" id="download">
            <div className="lp-section-heading">
              <div>
                <span className="lp-eyebrow">03 / GET SPLECE</span>
                <h2>Make yourself at home.</h2>
              </div>
              <p>
                Free. Local. Built to be yours.
                <br />
                Bring your own keys for Online AI. Provider charges apply.
              </p>
            </div>
            <a className="lp-text-link" href="#ios">iPhone &amp; iPad availability <ArrowUpRight size={15} /></a>
            <div className="lp-download-grid">
              <div className="lp-download-card">
                <p className="lp-device-note">{device.mobile ? "Choose a desktop download below." : device.platform ? `Looks like you’re on ${platformNames[device.platform]}. Choose another system if needed.` : "Choose the computer you’ll use for Splece."}</p>
                <div
                  role="group"
                  className="lp-platform-toggle"
                  aria-label="Choose your operating system"
                >
                  {["mac", "windows", "linux"].map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setPlatform(p);
                        setGuide(false);
                        setInstallGuide(false);
                      }}
                      aria-pressed={platform === p}
                    >
                      <PlatformIcon platform={p} width="19" height="19" />
                      {p === "mac" ? "macOS" : platformNames[p]}
                    </button>
                  ))}
                </div>
                <PlatformIcon
                  platform={platform}
                  className="lp-large-platform"
                  width="46"
                  height="46"
                />
                <h3>Splece for {name}</h3>
                <p>
                  {installer
                    ? "Your free AI video studio, ready for your own keys and ideas."
                    : platform === "linux" ? "A Linux installer is not available yet." : "The Windows beta is being prepared and tested. It is not available for download yet."}
                </p>
                {installer ? (
                  <a className="lp-button lp-button-primary" href={installer}>
                    <Download size={17} />
                    {device.mobile ? `${name} download details` : `Download for ${name}`}
                  </a>
                ) : platform === "linux" ? <span className="lp-platform-unavailable">Linux · Not available yet</span> : (
                  <button
                    className="lp-button lp-button-primary"
                    onClick={() => setInstallGuide(!installGuide)}
                    aria-expanded={installGuide}
                    aria-controls="lp-install-guide"
                  >
                    {installGuide
                      ? "Hide installation steps"
                      : "How installation will work"}
                    <ArrowRight size={17} />
                  </button>
                )}
                <span className="lp-download-note">
                  {installer
                    ? platform === "mac" ? "Apple Silicon (M1 or later) · macOS 13+ · Beta" : platform === "windows" ? "Windows x64 · Unsigned beta · Publisher warning expected" : "Ubuntu/Debian x64 · Experimental beta"
                    : "Direct download · No app store required"}
                </span>
                {installGuide && (
                  <div className="lp-install-guide" id="lp-install-guide">
                    <strong>{name} installation</strong>
                    <ol>
                      {(platform === "mac"
                        ? [
                            "Download the Splece disk image (.dmg).",
                            "Open it and drag Splece into Applications.",
                            "Open Splece. Your local studio starts in your browser.",
                          ]
                        : [
                            "Download the Splece installer (.exe).",
                            "Open it and follow the short setup.",
                            "Launch Splece from Start or your desktop.",
                          ]
                      ).map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ol>
                    <p>
                      The installer will include the runtime and video tools. No
                      terminal or separate developer tools needed. Downloads
                      will appear here when the installers are released.
                    </p>
                  </div>
                )}
                {studioAvailable ? (
                  <a className="lp-installed" href="/#home">
                    <span className="lp-status-dot" />
                    Your local studio is running <ArrowUpRight size={14} />
                  </a>
                ) : (
                  <details className="lp-already-installed">
                    <summary>Already set up Splece?</summary>
                    <p>
                      Start Splece on your computer, then open your local
                      workspace. On Mac, you can use the Dock launcher.
                    </p>
                    <a href="splece://open" className="lp-text-link">
                      Open Splece <ArrowUpRight size={14} />
                    </a>
                    <small>
                      The app link works with packaged installations. For a
                      source installation, open your running studio at
                      127.0.0.1:4310.
                    </small>
                  </details>
                )}
              </div>
              <div className="lp-requirements" id="requirements">
                <span className="lp-eyebrow">THE ESSENTIALS</span>
                <h3>What you’ll need.</h3>
                <div>
                  <Monitor size={18} />
                  <p>
                    <strong>A computer & a browser</strong>
                    <span>
                      {platform === "mac"
                        ? "Apple Silicon Mac (M1 or later), macOS 13+ and a current browser. Intel Macs are not supported by this beta."
                        : platform === "linux" ? "Ubuntu 22.04+ or compatible Debian 12+ desktop, x64. Experimental .deb package; other distributions and ARM are not supported." : "A 64-bit Windows 10/11 computer and a current browser. This unsigned beta was tested on a Windows runner; consumer-PC testing is ongoing."}
                    </span>
                  </p>
                </div>
                <div>
                  <HardDrive size={18} />
                  <p>
                    <strong>Space for your stories</strong>
                    <span>
                      Keep free disk space for originals, preview copies,
                      generated takes and exports. Requirements grow with your
                      project.
                    </span>
                  </p>
                </div>
                <div>
                  <Plug size={18} />
                  <p>
                    <strong>Internet for Online AI</strong>
                    <span>
                      Your provider API keys and credits enable generation. No
                      key is needed to edit your own footage or explore Offline
                      mode.
                    </span>
                  </p>
                </div>
                <div>
                  <Check size={18} />
                  <p>
                    <strong>Designed for a simple install</strong>
                    <span>
                      The desktop packages include the app runtime and video
                      tools. Source development and optional local add-ons
                      have separate requirements.
                    </span>
                  </p>
                </div>
              </div>
            </div>
            {!publicSite && (
              <div className="lp-developer-link">
                <span>Want to build it yourself?</span>
                <button
                  onClick={() => setGuide(!guide)}
                  aria-expanded={guide}
                  aria-controls="lp-setup-guide"
                >
                  Developer setup{" "}
                  {guide ? <Minus size={14} /> : <Plus size={14} />}
                </button>
              </div>
            )}
            {!publicSite && guide && (
              <section
                className="lp-setup-guide"
                id="lp-setup-guide"
                aria-label={`${name} setup guide`}
              >
                <div>
                  <span className="lp-eyebrow">
                    SOURCE PREVIEW / {name.toUpperCase()}
                  </span>
                  <h3>A few steps to your first project.</h3>
                  <p>
                    This early release runs from a source folder. Keep that
                    folder in place after setup.
                  </p>
                  {source && (
                    <a
                      className="lp-button lp-button-secondary"
                      href={source}
                      download
                    >
                      <Download size={16} />
                      Download source · {releases.version}
                    </a>
                  )}
                </div>
                <ol>
                  <li>
                    <strong>Install Node.js 22.13 or later.</strong>
                    <span>
                      Include npm. For the Mac Dock launcher, install Apple’s
                      Command Line Tools too. No developer tools are required
                      for the planned packaged installers.
                    </span>
                  </li>
                  <li>
                    <strong>
                      Unzip Splece and open its folder in{" "}
                      {platform === "mac" ? "Terminal" : "PowerShell"}.
                    </strong>
                    <span>
                      {source
                        ? "Use the source download here."
                        : "Use the Splece source folder provided with this preview."}{" "}
                      Run these commands from that folder:
                    </span>
                    <pre>
                      <code>{"npm install\nnpm run build\nnpm start"}</code>
                    </pre>
                  </li>
                  <li>
                    <strong>Open your studio.</strong>
                    <a href="http://127.0.0.1:4310/#home">
                      http://127.0.0.1:4310
                    </a>
                    <span>
                      Keep the terminal open while working. Create a project,
                      import footage, or connect an AI provider.
                    </span>
                  </li>
                  {platform === "mac" && (
                    <li>
                      <strong>Optional: add Splece to your Dock.</strong>
                      <span>
                        In a second terminal, run{" "}
                        <code>npm run install:macos</code> from the same folder.
                        Open Splece in your home Applications folder. This
                        development launcher is locally signed, not a public
                        notarized release.
                      </span>
                    </li>
                  )}
                </ol>
              </section>
            )}
          </section>
          <section
            className="lp-faq lp-container"
            id="questions"
            aria-labelledby="questions-title"
          >
            <div>
              <span className="lp-eyebrow">04 / A LITTLE CLARITY</span>
              <h2 id="questions-title">
                Good questions.
                <br />
                <span>Straight answers.</span>
              </h2>
            </div>
            <div className="lp-questions">
              {faqs.map(([q, a]) => (
                <details key={q}>
                  <summary>
                    {q}
                    <Plus size={19} className="lp-plus" aria-hidden="true" />
                    <Minus size={19} className="lp-minus" aria-hidden="true" />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </section>
          <section className="lp-final-cta lp-container">
            <span className="lp-eyebrow">THE NEXT TAKE COULD BE THE ONE.</span>
            <h2>
              Make something
              <br />
              <span>only you would.</span>
            </h2>
            <a className="lp-button lp-button-primary" href="#download">
              Explore Splece <ArrowUpRight size={18} aria-hidden="true" />
            </a>
            <p>Free editor. Local projects. Your own keys.</p>
          </section>
        </div>
      </main>
      <footer className="lp-footer lp-container">
        <a
          className="lp-wordmark"
          href={publicSite ? "/" : "/welcome"}
          aria-label="Splece home"
        >
          <img
            className="lp-brand-lockup"
            src="/brand/splece-logo-white.svg"
            alt="Splece"
            width="135"
            height="36"
          />
        </a>
        {publicSite && <><a href="/privacy/">iOS privacy</a><a href="/support/">Support</a></>}
        <a href="#download">
          Desktop downloads <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
