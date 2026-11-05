import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  FolderOpen,
  Folder,
  Search,
  ArrowRight,
  ChevronLeft,
  BookOpen,
  Info,
  Film,
  Sparkles,
  Users,
  AudioLines,
  HardDrive,
  LoaderCircle,
  X,
  Plug,
  MoreHorizontal,
  EyeOff,
  Trash2,
  Settings,
  Eye,
  LayoutGrid,
  List,
  ArrowUpRight,
} from "lucide-react";
import { version } from "../package.json";
import { api } from "./state";
import { Modal } from "./components";
import "./home.css";
import "./project-templates.css";
import { AppUpdates } from "./updates";
import { Connections } from "./connections";
import {
  HomeCover,
  HomeTemplates,
  ProjectMeta,
  ProjectDuration,
} from "./home-cards";
import { homeProjectView } from "../shared/home-projects.mjs";

const guides = [
  {
    title: "Your first film",
    icon: Film,
    description: "From a new project to your first cut.",
    steps: [
      "Create a project and give it a name. Splece keeps its media, generation records and exports together in a local folder.",
      "Open Plan in the main sidebar to shape your idea with chat. Your scenes and clips appear below, with the preview always beside you. You can also start in a blank studio.",
      "Click a planning card to open its composer, or choose Composer in the sidebar to start from scratch. Return to Plan whenever you want to reshape the story.",
      "Choose references and settings, review the prepared prompt, then generate. Use Offline mode while learning; it does not spend AI credits.",
    ],
  },
  {
    title: "Characters & references",
    icon: Users,
    description: "Build a consistent cast and visual world.",
    steps: [
      "Open Assets to add characters, locations, props and footage. Imported files are copied into the project.",
      "Give characters a description, a default image and additional poses or clothing references. Voice identity describes their language and delivery.",
      "Use @ in the composer to attach an asset. Review which images are attached and what each reference controls before generating.",
      "Model capabilities differ. Review any changes to resolution, duration or reference support when switching models.",
    ],
  },
  {
    title: "Prompts & generations",
    icon: Sparkles,
    description: "Shape the scene, then compare your takes.",
    steps: [
      "Describe the action in the composer. Camera options can stay on Auto. Add spoken dialogue explicitly when the scene needs it.",
      "Prepared prompt shows the final text and automatic injections. Smart AI creates an editable writing variation, keeping your original and automatic injections intact.",
      "Use the JSON view to copy or import a structured scene. Your drafts are saved as you work.",
      "Regenerate a story slot to create another take. Scroll vertically over the clip to switch versions; click a clip to reopen its prompt.",
    ],
  },
  {
    title: "Editing & sound",
    icon: AudioLines,
    description: "Cut the picture and shape its soundtrack.",
    steps: [
      "Drag video slots to reorder the story. Trim their edges, or put the playhead inside a clip and press S to split.",
      "Select a video, open Clip sound & audio mixer in the bottom toolbar, and choose Detach audio. The video sound is muted to prevent doubling.",
      "Move and trim waveform clips independently. Copy, paste, duplicate, adjust fades, or open the mixer to match levels and crossfade neighboring clips.",
      "Space plays or pauses when focus is outside writing and interactive controls. Arrow keys move one frame; Shift + arrow moves one second. Undo is ⌘Z on Mac or Ctrl+Z elsewhere.",
    ],
  },
  {
    title: "Export & local projects",
    icon: HardDrive,
    description: "Finish your movie and keep your work portable.",
    steps: [
      "Export uses the selected takes, trims and audio edits. Choose an aspect ratio, resolution and frame rate, then render locally.",
      "Jobs & exports shows rendering progress and the finished MP4 download. Local exports do not use AI credits.",
      "Project tools can save a portable checkpoint. Keep the whole project folder together, including its media.",
      "Use Open Project on this screen to reopen a Splece project folder. The local server must stay running for background generation jobs to continue.",
    ],
  },
];
export function HomeScreen({
  projects,
  onCreate,
  onOpen,
  onOpenFolder,
  currentProject,
  onConnectionsChange,
  onGlobalSettings,
  onRemoved,
  onBeforeRemove,
  onBeforeUpdate,
  onResume,
  mode,
  children,
}) {
  const [page, setPage] = useState("projects"),
    [query, setQuery] = useState(""),
    [guide, setGuide] = useState(null),
    [opening, setOpening] = useState(null),
    [error, setError] = useState(""),
    [folderDialog, setFolderDialog] = useState(false),
    [folder, setFolder] = useState(""),
    [catalog, setCatalog] = useState(projects),
    [loaded, setLoaded] = useState(false),
    [showHidden, setShowHidden] = useState(false),
    [sort, setSort] = useState("recent"),
    [view, setView] = useState("grid"),
    [idea, setIdea] = useState(""),
    [aspect, setAspect] = useState("16:9"),
    [previewId, setPreviewId] = useState(null),
    [removing, setRemoving] = useState(null),
    [removeMode, setRemoveMode] = useState("keep"),
    [confirmation, setConfirmation] = useState("");
  const previewTimer = useRef(null);
  useEffect(() => {
    let alive = true;
    api("/home/projects")
      .then((v) => {
        if (alive) setCatalog(v);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [projects]);
  useEffect(() => {
    const stop = () => {
      clearTimeout(previewTimer.current);
      setPreviewId(null);
    };
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", stop);
    motion.addEventListener("change", stop);
    return () => {
      clearTimeout(previewTimer.current);
      document.removeEventListener("visibilitychange", stop);
      motion.removeEventListener("change", stop);
    };
  }, []);
  useEffect(() => {
    clearTimeout(previewTimer.current);
    setPreviewId(null);
  }, [page, query, showHidden, view]);
  const previewProps = (id) => ({
    onPointerEnter: (e) => {
      if (
        e.pointerType !== "mouse" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      clearTimeout(previewTimer.current);
      previewTimer.current = setTimeout(() => setPreviewId(id), 250);
    },
    onPointerLeave: () => {
      clearTimeout(previewTimer.current);
      setPreviewId(null);
    },
  });
  const refresh = async () => setCatalog(await api("/home/projects"));
  const open = async (id) => {
    setOpening(id);
    setError("");
    try {
      await onOpen(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setOpening(null);
    }
  };
  const launch = ({ template, concept, shape } = {}) => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("splece-project-start") || "{}",
      );
      const patch = template
        ? {
            templateId: template.id,
            format: template.format,
            aspect: template.aspect,
            creativeDirection: template.direction,
            includeSample: true,
          }
        : concept !== undefined
          ? {
              concept,
              aspect: shape,
              templateId: "",
              format: "blank",
              creativeDirection: {},
              includeSample: false,
            }
          : {};
      localStorage.setItem(
        "splece-project-start",
        JSON.stringify({ ...saved, ...patch }),
      );
    } catch {
      setError(
        "Your browser could not keep this starting point. Choose it in New project.",
      );
    }
    onCreate();
  };
  const {
    resume,
    projects: list,
    hiddenCount,
  } = homeProjectView(catalog, {
    currentId: currentProject?.id,
    query,
    hidden: showHidden,
    sort,
  });
  const firstTime = loaded && !catalog.length;
  const navigate = (id) => {
    setPage(id);
    setGuide(null);
    setError("");
  };
  const menu = (p) => (
    <details className="home-project-menu">
      <summary aria-label={`Manage project ${p.name}`}>
        <MoreHorizontal size={17} />
      </summary>
      <div>
        <button
          onClick={async (e) => {
            e.currentTarget.closest("details").open = false;
            try {
              await api(
                "/projects/" + p.id + "/visibility",
                { hidden: !p.hidden },
                "PATCH",
              );
              await refresh();
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          {p.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          {p.hidden ? "Show on Home" : "Hide from Home"}
        </button>
        <button
          onClick={(e) => {
            e.currentTarget.closest("details").open = false;
            setRemoving(p);
            setRemoveMode("keep");
            setConfirmation("");
            setError("");
          }}
        >
          <Trash2 size={14} /> Remove project…
        </button>
      </div>
    </details>
  );
  return (
    <main className="home-app home-refresh">
      <section className="home-window" aria-label="Splece Home">
        <aside className="home-identity">
          <div className="home-brand">
            <img src="/splece.svg" alt="" />
            <span>
              Splece<small>Your ideas, in motion.</small>
            </span>
          </div>
          <nav aria-label="Home navigation">
            {[
              ["projects", Folder, "Projects"],
              ["templates", LayoutGrid, "Templates"],
              ["learn", BookOpen, "Learn"],
            ].map(([id, Icon, label]) => (
              <button
                key={id}
                aria-label={label}
                title={label}
                aria-current={page === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="home-sidebar-bottom">
            <button
              className="home-settings-link"
              aria-label="Settings"
              title="Settings"
              aria-current={
                ["settings", "connections", "about"].includes(page)
                  ? "page"
                  : undefined
              }
              onClick={() => navigate("settings")}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>
            <span className="home-storage-note">
              <HardDrive size={13} />
              <span>Saved on your computer</span>
            </span>
          </div>
        </aside>
        <section className="home-content">
          <header className="home-toolbar">
            <h1>
              {
                {
                  projects: "Projects",
                  templates: "Templates",
                  learn: "Learn",
                  settings: "Settings",
                  connections: "Connections",
                  about: "About Splece",
                }[page]
              }
            </h1>
            <div className="home-toolbar-actions">
              {page === "projects" && (
                <button
                  className="home-open-action"
                  aria-label="Open project folder"
                  title="Open project folder"
                  onClick={() => {
                    setFolderDialog(true);
                    setError("");
                  }}
                >
                  <FolderOpen size={16} />
                  <span>Open project…</span>
                </button>
              )}
              <button className="primary" onClick={() => launch()}>
                <Plus size={17} /> New project
              </button>
            </div>
          </header>
          <div className="home-scroll">
            {error && (
              <p role="alert" className="home-error">
                {error}
              </p>
            )}
            {page === "projects" && (
              <>
                {firstTime ? (
                  <section className="home-first-project">
                    <span className="home-eyebrow">
                      A little idea. A whole world.
                    </span>
                    <h2>Make something move.</h2>
                    <p>Start with an idea, or make a template your own.</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        launch({ concept: idea, shape: aspect });
                      }}
                    >
                      <label htmlFor="home-idea">
                        What do you want to make?
                      </label>
                      <textarea
                        id="home-idea"
                        placeholder="A story, a product, a moment…"
                        value={idea}
                        onChange={(e) => setIdea(e.target.value)}
                      />
                      <div>
                        <div
                          className="home-format-choices"
                          role="group"
                          aria-label="Video shape"
                        >
                          {[
                            ["9:16", "Portrait"],
                            ["1:1", "Square"],
                            ["16:9", "Landscape"],
                          ].map(([value, label]) => (
                            <button
                              type="button"
                              key={value}
                              aria-pressed={aspect === value}
                              onClick={() => setAspect(value)}
                            >
                              {label} <span>{value}</span>
                            </button>
                          ))}
                        </div>
                        <button type="submit">
                          Start project <ArrowRight size={15} />
                        </button>
                      </div>
                    </form>
                  </section>
                ) : (
                  <>
                    <div className="home-library-toolbar">
                      <label className="home-search">
                        <Search size={16} />
                        <input
                          aria-label="Search projects"
                          placeholder="Find a project…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {query && (
                          <button
                            aria-label="Clear search"
                            onClick={() => setQuery("")}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <select
                        aria-label="Sort projects"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="recent">Last edited</option>
                        <option value="name">Name</option>
                      </select>
                      <div
                        className="home-view-switch"
                        role="group"
                        aria-label="Project view"
                      >
                        <button
                          aria-label="Grid view"
                          aria-pressed={view === "grid"}
                          onClick={() => setView("grid")}
                        >
                          <LayoutGrid size={16} />
                        </button>
                        <button
                          aria-label="List view"
                          aria-pressed={view === "list"}
                          onClick={() => setView("list")}
                        >
                          <List size={16} />
                        </button>
                      </div>
                      {(hiddenCount > 0 || showHidden) && (
                        <button
                          className="home-hidden-filter"
                          aria-pressed={showHidden}
                          onClick={() => setShowHidden(!showHidden)}
                        >
                          <EyeOff size={14} />
                          {showHidden
                            ? "Back to projects"
                            : `Hidden from Home (${hiddenCount})`}
                        </button>
                      )}
                    </div>
                    {resume && (
                      <section
                        className="home-continue"
                        aria-label="Continue where you left off"
                      >
                        <button
                          disabled={!!opening}
                          onClick={() =>
                            resume.id === currentProject?.id
                              ? onResume()
                              : open(resume.id)
                          }
                          {...previewProps(resume.id)}
                        >
                          <span className="home-continue-art">
                            <HomeCover
                              title={resume.name}
                              cover={resume.summary?.cover}
                              previewing={previewId === resume.id}
                            />
                            <ProjectDuration summary={resume.summary} />
                          </span>
                          <span className="home-continue-copy">
                            <small>Jump back in</small>
                            <b>{resume.name}</b>
                            <ProjectMeta project={resume} />
                          </span>
                          <span className="home-continue-action">
                            {opening === resume.id ? "Opening…" : "Continue"}
                            <ArrowRight size={17} />
                          </span>
                        </button>
                        {menu(resume)}
                      </section>
                    )}
                    {(list.length > 0 || query || showHidden) && (
                      <div className="home-section-heading">
                        <h2>
                          {showHidden
                            ? "Hidden from Home"
                            : query
                              ? "Search results"
                              : "Your projects"}
                        </h2>
                        <span>
                          {list.length}
                          {query ? " found" : ""}
                        </span>
                      </div>
                    )}
                    <div className="home-project-grid" data-view={view}>
                      {list.map((p) => (
                        <article className="home-project-card" key={p.id}>
                          <button
                            className="home-project-open"
                            disabled={!!opening}
                            onClick={() => open(p.id)}
                            aria-label={`Open ${p.name}`}
                            {...previewProps(p.id)}
                          >
                            <span className="home-project-art">
                              <HomeCover
                                title={p.name}
                                cover={p.summary?.cover}
                                previewing={previewId === p.id}
                              />
                              <ProjectDuration summary={p.summary} />
                            </span>
                            <span className="home-project-info">
                              <b>{p.name}</b>
                              <ProjectMeta project={p} />
                              {opening === p.id && <small>Opening…</small>}
                            </span>
                          </button>
                          {menu(p)}
                        </article>
                      ))}
                    </div>
                    {!loaded && !catalog.length && (
                      <p className="home-status" role="status">
                        Opening your projects…
                      </p>
                    )}
                    {loaded && !list.length && !resume && (
                      <div className="home-empty">
                        <FolderOpen size={32} />
                        <h3>
                          {query
                            ? "No matching projects"
                            : showHidden
                              ? "No hidden projects"
                              : "Your projects are tucked away"}
                        </h3>
                        <p>
                          {query
                            ? "Try a different name."
                            : "Bring a project back to Home whenever you like."}
                        </p>
                        <button
                          onClick={() => {
                            setQuery("");
                            setShowHidden(!showHidden && hiddenCount > 0);
                          }}
                        >
                          {query
                            ? "Clear search"
                            : showHidden
                              ? "Back to projects"
                              : "Show hidden projects"}
                        </button>
                      </div>
                    )}
                  </>
                )}
                {!query && !showHidden && loaded && (
                  <>
                    <div className="home-section-heading home-inspiration-heading">
                      <h2>
                        {firstTime
                          ? "Pick a starting point"
                          : "Try something new"}
                      </h2>
                      <button onClick={() => navigate("templates")}>
                        All templates <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <HomeTemplates
                      onChoose={(template) => launch({ template })}
                      previewId={previewId}
                      previewProps={previewProps}
                    />
                  </>
                )}
              </>
            )}
            {page === "templates" && (
              <>
                <p className="home-page-intro">
                  A starting point, ready to make your own.
                </p>
                <HomeTemplates
                  full
                  onChoose={(template) => launch({ template })}
                  previewId={previewId}
                  previewProps={previewProps}
                />
              </>
            )}
            {page === "settings" && (
              <div className="home-settings-page">
                <p className="home-page-intro">Your workspace, your way.</p>
                <button onClick={onGlobalSettings}>
                  <Settings size={22} />
                  <span>
                    <b>Workspace preferences</b>
                    <small>Defaults for new projects and generation.</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
                <button onClick={() => navigate("connections")}>
                  <Plug size={22} />
                  <span>
                    <b>Connections</b>
                    <small>Manage your providers and API keys.</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
                <AppUpdates beforeCheck={onBeforeUpdate} />
                <button onClick={() => navigate("about")}>
                  <Info size={22} />
                  <span>
                    <b>About Splece</b>
                    <small>
                      Version {version} · Your local creative workspace.
                    </small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              </div>
            )}
            {["connections", "about"].includes(page) && (
              <button
                className="home-back"
                onClick={() => navigate("settings")}
              >
                <ChevronLeft size={15} /> Settings
              </button>
            )}
            {page === "connections" && (
              <Connections onChange={onConnectionsChange} />
            )}
            {page === "learn" && (
              <div className="home-learning">
                {guide === null ? (
                  <>
                    <p className="home-intro">
                      A few short guides to help you find your flow.
                    </p>
                    {guides.map((g, i) => (
                      <button
                        className="home-guide"
                        key={g.title}
                        onClick={() => setGuide(i)}
                      >
                        <g.icon size={21} />
                        <span>
                          <b>{g.title}</b>
                          <small>{g.description}</small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </>
                ) : (
                  <article className="home-lesson">
                    <button
                      className="home-back"
                      onClick={() => setGuide(null)}
                    >
                      <ChevronLeft size={14} /> All guides
                    </button>
                    <h3>{guides[guide].title}</h3>
                    <ol>
                      {guides[guide].steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <button
                      className="home-next"
                      onClick={() =>
                        guide < guides.length - 1
                          ? setGuide(guide + 1)
                          : setGuide(null)
                      }
                    >
                      {guide < guides.length - 1
                        ? "Next guide"
                        : "Back to guides"}
                      <ArrowRight size={14} />
                    </button>
                  </article>
                )}
              </div>
            )}
            {page === "about" && (
              <div className="home-about">
                <img src="/splece.svg" width="50" height="50" alt="" />
                <h3>From an idea to the final cut.</h3>
                <p>
                  Plan a story, direct AI generations, compare takes, and edit
                  your film in one workspace.
                </p>
                <dl>
                  <div>
                    <dt>Local by design</dt>
                    <dd>
                      Projects, imported assets and exports live on your
                      computer. Your browser is the studio window; the local
                      server keeps it running.
                    </dd>
                  </div>
                  <div>
                    <dt>Connected when you choose</dt>
                    <dd>
                      Online AI requests use your configured providers and may
                      spend credits. Prompts and selected references are sent to
                      those providers. Offline mode lets you explore without AI
                      usage.
                    </dd>
                  </div>
                  <div>
                    <dt>Free and open source</dt>
                    <dd>
                      Original code licensed under Apache 2.0. Commercial reuse
                      is welcome, with attribution notices preserved. The Splece
                      name and logo remain reserved for the official project.
                    </dd>
                  </div>
                </dl>
                <p><a href="https://github.com/ahmadaIanazi" target="_blank" rel="noreferrer">Created by Ahmad Alanazi · @ahmadaIanazi ↗</a></p>
                <p><a href="https://github.com/ahmadaIanazi/splece" target="_blank" rel="noreferrer">Source code · ahmadaIanazi/splece ↗</a></p>
                <span className="home-about-version">Splece · {version}</span>
              </div>
            )}
          </div>
        </section>
      </section>
      {removing && (
        <Modal title="Remove project" onClose={() => setRemoving(null)}>
          <div className="project-removal">
            <h3>{removing.name}</h3>
            <label>
              <input
                type="radio"
                name="remove-mode"
                checked={removeMode === "keep"}
                onChange={() => setRemoveMode("keep")}
              />{" "}
              Remove from Splece · keep all files
            </label>
            <label>
              <input
                type="radio"
                name="remove-mode"
                checked={removeMode === "files"}
                onChange={() => setRemoveMode("files")}
              />{" "}
              Delete project and its files
            </label>
            <p className="muted">
              {removeMode === "files"
                ? "Permanently deletes this project's folder, media and exports. Shared library copies and other projects are kept."
                : "Removes this project from the list. Open its folder later to restore it."}
            </p>
            {removeMode === "files" && (
              <input
                aria-label="Confirm project name"
                placeholder="Type the project name"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              disabled={
                !!opening ||
                (removeMode === "files" && confirmation !== removing.name)
              }
              onClick={async () => {
                setOpening(removing.id);
                try {
                  await onBeforeRemove?.();
                  await api(
                    "/projects/" + removing.id,
                    {
                      files: removeMode === "files",
                      confirmName: confirmation,
                    },
                    "DELETE",
                  );
                  await onRemoved?.(removing.id);
                  await refresh();
                  setRemoving(null);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setOpening(null);
                }
              }}
            >
              <Trash2 size={15} />
              {opening
                ? "Removing…"
                : removeMode === "files"
                  ? "Permanently delete"
                  : "Remove from Splece"}
            </button>
          </div>
        </Modal>
      )}
      {folderDialog && (
        <Modal
          title="Open project folder"
          className="home-open-dialog"
          onClose={() => setFolderDialog(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setOpening("folder");
              setError("");
              try {
                await onOpenFolder(folder);
                setFolderDialog(false);
              } catch (e) {
                setError(e.message);
              } finally {
                setOpening(null);
              }
            }}
          >
            <p>Choose a folder containing an existing Splece project.</p>
            <label>
              Project folder
              <div className="home-folder-input">
                <input
                  autoFocus
                  aria-label="Existing project folder"
                  required
                  value={folder}
                  placeholder="/Users/you/Movies/My project"
                  onChange={(e) => setFolder(e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Browse project folders"
                  onClick={async () => {
                    try {
                      setFolder((await api("/folder", {})).path);
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  <FolderOpen size={17} />
                </button>
              </div>
            </label>
            {error && (
              <p role="alert" className="home-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={!!opening}>
              {opening ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <FolderOpen size={15} />
              )}{" "}
              Open project
            </button>
          </form>
        </Modal>
      )}
      {children}
    </main>
  );
}
