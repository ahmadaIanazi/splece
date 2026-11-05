import { GenerationQualitySettings } from "./generation-quality";
import { AddonSettings } from "./addons";
import { FolderSettings } from "./folder-settings";
import { AppUpdates } from "./updates";
import { ProjectVisuals } from "./project-visuals";
import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  Plug,
  Package,
  Workflow,
  Film,
  AudioLines,
  Download,
  SlidersHorizontal,
  FlaskConical,
  Globe,
  Folder,
  RotateCcw,
  Check,
} from "lucide-react";
import { api } from "./state";
import { Connections } from "./connections";
import { DeepSeekSettings, VeniceSettings } from "./smart";
import { SettingsExtras } from "./advanced";
import { resolveProjectDefaults } from "../shared/settings-defaults.mjs";
import { modelTitle } from "../shared/composer-presentation.mjs";
const WorkflowSettings = lazy(() => import("./workflow-canvas").then(m => ({default:m.WorkflowSettings})));
const settingLabels = {
  specs: "General specifications",
  characters: "Character details",
  background: "Background & continuity",
  remarks: "Timeline notes",
  frames: "Frame guidance",
  startFrame: "Start frame",
  endFrame: "End frame",
  camera: "Camera direction",
  dialogue: "Dialogue",
  enhance: "Prompt enhancement",
  aspect: "Aspect ratio",
  resolution: "Resolution",
  duration: "Duration",
  fps: "Frame rate",
};
const tabs = [
  ["project", "Project", Film],
  ["prompting", "Advanced prompts", SlidersHorizontal],
  ["workflows", "Workflows", Workflow],
  ["video", "Video", Film],
  ["audio", "Audio", AudioLines],
  ["exports", "Exports", Download],
  ["folders", "Folders", Folder],
  ["connections", "Connections", Plug],
  ["addons", "Add-ons", Package],
  ["test", "Preview tools", FlaskConical],
  ["updates", "Updates", RotateCcw],
];
export function ProjectSettings({
  project,
  update,
  models,
  videoMode,
  refreshVideoModels,
  holdToGenerate,
  setHoldToGenerate,
  simulation,
  setSimulation,
  initialTab = "project",
  globalOnly = false,
  beforeUpdate,
}) {
  const [tab, setTab] = useState(initialTab),
    [scope, setScope] = useState(globalOnly ? "global" : "project"),
    [defaults, setDefaults] = useState(null),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    api("/studio/defaults")
      .then((value) => {
        try {
          const pending = JSON.parse(
            localStorage.getItem("splece-defaults-draft") || "null",
          );
          if (pending) {
            setDefaults(pending);
            setDirty(true);
            setMessage("Unsaved global settings restored");
            return;
          }
        } catch {}
        setDefaults(value);
      })
      .catch((e) => setMessage(e.message));
  }, []);
  useEffect(() => {
    if (dirty && defaults)
      localStorage.setItem("splece-defaults-draft", JSON.stringify(defaults));
  }, [dirty, defaults]);
  const settings = scope === "global" ? defaults : project.settings;
  const change = (fn) => {
    if (scope === "global") {
      setDefaults((old) => {
        const p = { settings: structuredClone(old) };
        fn(p);
        return p.settings;
      });
      setDirty(true);
    } else
      update((p) => {
        p.settings.inherit = (p.settings.inherit || []).filter(
          (g) => g !== tab,
        );
        fn(p);
      });
  };
  async function save() {
    try {
      const value = await api("/studio/defaults", defaults, "PUT");
      setDefaults(value);
      setDirty(false);
      localStorage.removeItem("splece-defaults-draft");
      update(
        (p) => {
          p.settings = resolveProjectDefaults(p.settings, value);
        },
        true,
        true,
      );
      setMessage("Global defaults saved");
    } catch (e) {
      setMessage(e.message);
    }
  }
  const inheritance = project.settings.inherit?.includes(tab);
  return (
    <div className="settings-layout">
      <nav aria-label="Settings sections">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <section className="settings-content">
        {!["project", "connections", "test", "updates", "folders", "addons"].includes(tab) && (
          <div className="settings-scope">
            <div
              className="sculpted-segments"
              role="group"
              aria-label="Settings scope"
            >
              {!globalOnly && (
                <button
                  aria-pressed={scope === "project"}
                  onClick={() => setScope("project")}
                >
                  <Folder size={13} />
                  This project
                </button>
              )}
              <button
                aria-pressed={scope === "global"}
                onClick={() => setScope("global")}
              >
                <Globe size={13} />
                Global defaults
              </button>
            </div>
            {scope === "project" && defaults && (
              <button
                className="text-action"
                title="Use global defaults for this section"
                onClick={() =>
                  update(
                    (p) => {
                      p.settings.inherit = [
                        ...new Set([...(p.settings.inherit || []), tab]),
                      ];
                      p.settings = resolveProjectDefaults(p.settings, defaults);
                    },
                    true,
                    true,
                  )
                }
              >
                <RotateCcw size={13} />
                {inheritance ? "Inherited" : "Reset to global"}
              </button>
            )}
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {tab === "project" ? <section className="settings-project-summary"><h2>{globalOnly ? "Studio defaults" : project.name}</h2><p>Everything for your project, in one place.</p><div className="settings-project-cards">{[["video","Video", "Generation defaults & format"],["audio","Sound","Voices, levels & mixing"],["exports","Export","Quality & frame rate"],["folders","Files","Project folder & storage"],["connections","Connections","Connections & providers"]].map(([id,label,detail])=><button key={id} onClick={()=>setTab(id)}><strong>{label}</strong><small>{detail}</small></button>)}</div></section> : tab === "folders" ? <FolderSettings project={globalOnly ? null : project} /> : tab === "updates" ? <AppUpdates beforeCheck={beforeUpdate} /> : tab === "connections" ? (
          <>
            <p className="muted">
              Connections are shared across projects. Keys stay on this
              computer.
            </p>
            <Connections onChange={refreshVideoModels} />

          </>
        ) : tab === "addons" ? <AddonSettings /> : tab === "test" ? (
          <>
            <label className="field">
              <span>Sample preview behavior</span>
              <select
                value={simulation}
                onChange={(e) => setSimulation(e.target.value)}
              >
                {[
                  ["normal", "Normal"],
                  ["slow", "Slow"],
                  ["failure", "Failed generation"],
                  ["uncertain", "Response lost"],
                  ["rate-limit", "Rate limit"],
                  ["offline", "Temporary outage"],
                  ["download-failure", "Download failure"],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Local fixtures only. No credits spent in Offline mode.
            </p>
          </>
        ) : (
          settings && (
            <>
              <p className="settings-inheritance">
                {scope === "global"
                  ? "Defaults for new projects and projects using inheritance."
                  : inheritance
                    ? "Using global defaults. Editing creates a project override."
                    : "Project overrides · other projects are unchanged."}
              </p>
              {tab === "workflows" && <Suspense fallback={<p>Opening workflows…</p>}><WorkflowSettings {...{project,settings,change,scope,dirty,models}} onSave={save} onNavigate={setTab} /></Suspense>}
              {tab === "prompting" && (
                <>
                  <ProjectVisuals project={project} settings={settings} change={change} global={scope === "global"} />
                  <label className="field">
                    <span>System prompt</span>
                    <textarea
                      rows={4}
                      value={settings.systemPrompt || ""}
                      onChange={(e) =>
                        change(
                          (p) => (p.settings.systemPrompt = e.target.value),
                        )
                      }
                    />
                  </label>
                  <div className="settings-switches">
                    {Object.entries(settings.automation || {}).map(
                      ([key, value]) => (
                        <label className="composer-switch-row" key={key}>
                          <span>{settingLabels[key] || key}</span>
                          <input
                            type="checkbox"
                            role="switch"
                            checked={value}
                            onChange={(e) =>
                              change(
                                (p) =>
                                  (p.settings.automation[key] =
                                    e.target.checked),
                              )
                            }
                          />
                          <i />
                        </label>
                      ),
                    )}
                  </div>
                  <details>
                    <summary>Templates & voice deliveries</summary>
                    <SettingsExtras
                      hideConcurrency
                      hideHistory={scope === "global"}
                      project={{
                        ...project,
                        settings: {
                          ...settings,
                          templateVersions: settings.templateVersions || [],
                        },
                      }}
                      update={change}
                    />
                  </details>
                </>
              )}
              {tab === "video" && (
                <>
                  <GenerationQualitySettings value={settings.generationPresets} models={models} onChange={value=>change(p=>{p.settings.generationPresets=value;})}/>
                  <label className="field">
                    <span>Concurrent jobs</span>
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={settings.concurrency || 3}
                      onChange={(e) =>
                        change(
                          (p) =>
                            (p.settings.concurrency = Math.max(
                              1,
                              Math.min(12, Number(e.target.value)),
                            )),
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    <span>
                      Default model · {videoMode === "demo" ? "Offline" : "Online"}
                    </span>
                    <select
                      aria-label="Default video model"
                      value={settings.videoDefaults?.[videoMode]?.model || ""}
                      onChange={(e) =>
                        change((p) => {
                          p.settings.videoDefaults ??= {};
                          if (e.target.value)
                            p.settings.videoDefaults[videoMode] = {
                              model: e.target.value,
                            };
                          else delete p.settings.videoDefaults[videoMode];
                        })
                      }
                    >
                      <option value="">Use favorite model</option>
                      {models.map((m) => (
                        <option value={m.id} key={m.id}>
                          {modelTitle(m)} · {m.provider || "Offline"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const values = settings.videoDefaults?.[videoMode] || {},
                      model = models.find((m) => m.id === values.model);
                    return (
                      model &&
                      ["aspect", "resolution", "duration"].map((key) => (
                        <label className="field" key={key}>
                          <span>{settingLabels[key] || key}</span>
                          <select
                            value={values[key] ?? ""}
                            onChange={(e) =>
                              change((p) => {
                                if (e.target.value === "")
                                  delete p.settings.videoDefaults[videoMode][
                                    key
                                  ];
                                else
                                  p.settings.videoDefaults[videoMode][key] =
                                    key === "duration"
                                      ? Number(e.target.value)
                                      : e.target.value;
                              })
                            }
                          >
                            <option value="">Model default</option>
                            {(
                              model[
                                {
                                  aspect: "aspects",
                                  resolution: "resolutions",
                                  duration: "durations",
                                }[key]
                              ] || []
                            ).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))
                    );
                  })()}
                  {models.find(
                    (m) => m.id === settings.videoDefaults?.[videoMode]?.model,
                  )?.audioConfigurable && (
                    <label className="composer-switch-row">
                      <span>Generate audio by default</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={
                          settings.videoDefaults?.[videoMode]?.audio ?? true
                        }
                        onChange={(e) =>
                          change((p) => {
                            p.settings.videoDefaults[videoMode].audio =
                              e.target.checked;
                          })
                        }
                      />
                      <i />
                    </label>
                  )}
                  <label className="composer-switch-row">
                    <span>
                      Hold to generate
                      <small>Shared safety preference for this browser</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={holdToGenerate}
                      onChange={(e) => {
                        setHoldToGenerate(e.target.checked);
                        localStorage.setItem(
                          "splece-hold-generate",
                          e.target.checked ? "on" : "off",
                        );
                      }}
                    />
                    <i />
                  </label>
                </>
              )}
              {tab === "audio" && (
                <>
                  <label className="field">
                    <span>
                      New imported audio & footage volume ·{" "}
                      {Math.round((settings.audioDefaults?.volume ?? 1) * 100)}%
                    </span>
                    <input
                      aria-label="Default audio volume"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.audioDefaults?.volume ?? 1}
                      onChange={(e) =>
                        change(
                          (p) =>
                            (p.settings.audioDefaults = {
                              mute: false,
                              ...p.settings.audioDefaults,
                              volume: Number(e.target.value),
                            }),
                        )
                      }
                    />
                  </label>
                  <label className="composer-switch-row">
                    <span>Mute new imports</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={settings.audioDefaults?.mute || false}
                      onChange={(e) =>
                        change(
                          (p) =>
                            (p.settings.audioDefaults = {
                              volume: 1,
                              ...p.settings.audioDefaults,
                              mute: e.target.checked,
                            }),
                        )
                      }
                    />
                    <i />
                  </label>
                  <p className="muted">
                    Existing clips keep their mix. Adjust individual clips in
                    the timeline mixer.
                  </p>
                </>
              )}
              {tab === "exports" && (
                <>
                  {[
                    ["aspect", ["16:9", "9:16", "1:1"]],
                    ["resolution", ["480p", "720p", "1080p"]],
                    ["fps", [24, 25, 30, 60]],
                  ].map(([key, values]) => (
                    <label className="field" key={key}>
                      <span>{settingLabels[key] || key}</span>
                      <select
                        value={settings.export?.[key]}
                        onChange={(e) =>
                          change(
                            (p) =>
                              (p.settings.export[key] =
                                key === "fps"
                                  ? Number(e.target.value)
                                  : e.target.value),
                          )
                        }
                      >
                        {values.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <p className="muted">H.264 video · AAC audio · MP4</p>
                </>
              )}
            </>
          )
        )}
        {dirty && (
          <div className="settings-save">
            <button className="primary" onClick={save}>
              <Check size={15} />
              Save global defaults
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
