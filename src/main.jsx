import {nextTimelineFocus, auditionAudio, auditionSource} from "../shared/timeline-focus.mjs";
import {ProviderConnectHost} from "./provider-connect";
import {SoundInspector} from "./sound-inspector";
import {mediaPose as animatedMediaPose} from "../shared/media-animation.mjs";
import {useElementsEditor,ElementsPreview,ElementsInspector,ElementsTimeline} from "./elements";
import {elementsFor,normalizeMediaTransform} from "../shared/elements.mjs";
import { setBrowserPreference } from "../shared/local-draft.mjs";
import { PhotoStory } from "./photo-story";
import { useStructureWorkflow } from "./use-structure-workflow";
import { useComposerAssistant, AssistantHeader } from "./composer-assistant";
import { editShortcut, ownsTransport, editableSelector, controlSelector, shortcutHint } from "../shared/editor-shortcuts.mjs";
import { TakeComparison } from "./take-comparison";
import { TimelinePlayhead } from "./timeline-playhead";
import { TimelineModes } from "./timeline-modes";
import { DirectionTimeline } from "./direction-timeline";
import { directionRanges } from "../shared/timeline-direction.mjs";
import "./timeline-views.css";
import { wheelZoom } from "../shared/timeline-gestures.mjs";
import { Columns2, SlidersHorizontal } from "lucide-react";
import { Notification } from "./notification";
import {lipSyncActive} from "./lip-sync";
import { RecoveryBoundary, CommittedNumber } from "./recovery-boundary";
import { isProjectOnly, setAssetProjectOnly } from "../shared/asset-scope.mjs";
import {
  submissionJournal,
  submitGenerationIntents,
} from "../shared/generation-submissions.mjs";
import {
  useSoundtrack,
  SoundtrackTimeline,
  SoundtrackPanel,
} from "./soundtrack";
import { soundtrackDirtyClips } from "../shared/soundtrack.mjs";
import { usePreviewMedia, PreviewDeck } from "./preview-media";
import { usePreviewFullscreen } from "./preview-fullscreen";
import { nextPreviewClip } from "../shared/preview-window.mjs";
import { takeWheelGesture } from "../shared/editor-polish.mjs";
import { ClipSettings } from "./clip-settings";
import { applyClipTreatment } from "../shared/clip-treatment.mjs";
import {
  insertPromptAtFrame,
  trimTimelineClip,
  copyTimelineRange,
  removeTimelineRange,
  pasteTimelineRange,
} from "../shared/timeline-editing.mjs";
import {
  timelineFrameSources,
  captureTimelineFrame,
  timelineFrameUsages,
} from "../shared/timeline-frames.mjs";
import {
  TimelineFrameAction,
  TimelineFrameMarkers,
} from "./timeline-frame-action";
import { ProjectSettings } from "./project-settings";
import { MediaDock } from "./media-dock";
import { timelineDropPreview } from "../shared/timeline-drop.mjs";
import { CreativeComposer } from "./creative-composer";
import {
  foldedTimeline,
  selectTimelineClips,
  moveTimelineSelection,
} from "../shared/timeline-selection.mjs";
import {
  fillPlannedSlot,
  editPlannedSlot,
  groupSlots,
  moveTimelineGroup,
  insertPlannedNode,
  editablePlannedSlot,
  reconcilePlannedTimeline,
  plannedNode,
  removePlannedClip,
} from "../shared/planned-timeline.mjs";
import { GroupComposer } from "./structure-editor";
import { isStructureClip, structureColor } from "../shared/structure.mjs";
import { editedStoryTiming } from "../shared/timeline-navigation.mjs";
import { isLiveJob } from "../shared/providers.mjs";
import { Connections } from "./connections";
import { HomeScreen } from "./home";
import {
  AudioPlayback,
  AudioEditor,
  AudioTimeline,
  ClipAudioShape,
} from "./audio";
import {
  detachAudio,
  copyAudio,
  splitAudio,
  audioClip,
  freeAudioLane,
} from "../shared/audio-editing.mjs";
import { draftTimelinePosition } from "../shared/timeline-navigation.mjs";
import { usePreviewPlayback } from "./preview-playback";
import { TimelineInsertions } from "./timeline-insertion";
import { TimelineGuides, TimelineRuler } from "./timeline-guides";
import { useBilling, CostPanel, GenerationCost } from "./billing";
import {
  reserveGenerationSlot,
  generationTarget,
  adoptReadyGenerations,
  consolidateGenerationSlots,
  activateSlotTake,
  currentSlotJob,
  clipJobs,
  resizeSlot,
  reorderStorySlot,
  markIndependentSegment,
  stitchTimeline,
  insertStorySlot,
} from "../shared/generation-slots.mjs";
import { ClipMixer, TakeStack, GenerationShelf } from "./timeline-ui";
import {
  generationPool,
  removeStorySlot,
  restorePoolEntry,
} from "../shared/generation-pool.mjs";
import { openClipPrompt, attachClipReference } from "../shared/clip-prompt.mjs";
import { activeDetachedGenerations } from "../shared/job-progress.mjs";
import { JobProgress } from "./job-progress";
import {
  compatibleVideoModels,
  fitVideoSettings,
  preferredVideoModel,
} from "../shared/video-selection.mjs";
import { WorkspaceHeader } from "./workspace";
import { JsonComposer, StoryPlanner } from "./authoring";
import {
  promptGroupKey,
  chooseGroupDraft,
} from "../shared/prompt-navigation.mjs";
import { beatDraft } from "../shared/authoring.mjs";
import { createRepairDraft, takeSourceIn } from "../shared/repair.mjs";
import { VideoSettings } from "./video";
import { VeniceSettings, DeepSeekSettings } from "./smart";
import { importedAsset } from "../shared/smart.mjs";
import {
  GenerationComparison,
  EpisodePicker,
  HistoryPanel,
  ExportProfile,
  TakeMismatch,
  SettingsExtras,
  JobRecovery,
} from "./advanced";
import {
  effectiveAutomation,
  reuseGeneration,
  validatePreparation,
  visibleClips,
  upgradeProject,
} from "../shared/studio.mjs";
import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import {
  Plus,
  Lock,
  Star,
  X,
  Film,
  FolderOpen,
  Settings2,
  Download,
  Upload,
  Scissors,
  Copy,
  Clipboard,
  Trash2,
  Undo2,
  Redo2,
  Magnet,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Layers,
  Image,
  UserRound,
  MapPin,
  Paperclip,
  MessageCircle,
  AudioLines,
  Volume2,
  VolumeX,
  Maximize2,
  Check,
  LoaderCircle,
  Clock3,
  ArrowUpRight,
  ArrowRight,
  PanelLeft,
  Clapperboard,
  Sparkles,
  Send,
  Info,
  RotateCcw,
  MoveHorizontal,
  StickyNote,
  GripVertical,
  Images,
  Archive,
  FileText,
  RefreshCw,
  AlertCircle,
  MousePointer2,
  Ellipsis,
  Folder,
  HardDrive,
  Speech,
  LayoutGrid,
  Search,
  SplitSquareHorizontal,
  History,
} from "lucide-react";
import {
  api,
  uid,
  tc,
  makeDraft,
  useProject,
  compile,
  defaultAutomation,
} from "./state";
import "./style.css";
import "./workspace.css";
import "./editor-chrome.css";
import "./timeline-flow.css";
import "./editor-canvas.css";
import "./creative-composer.css";
import "./sculpted.css";
import "./workspace-polish.css";
import {
  Icon,
  Modal,
  Field,
  AutoTag,
  CreateProject,
  ProjectList,
  RemarkModal,
  AssetLibrary,
  automationLabels,
} from "./components";
const takeOf = (c) => c?.takes.find((t) => t.id === c.activeTake);
function StudioApp() {
  const [firstRun, setFirstRun] = useState(null);
  const store = useProject(),
    { project: p, update, load, flush, status, undo, redo } = store;
  const structureWorkflow = useStructureWorkflow({ project:p, update, flush, undo });
  const billing = useBilling(p?.id, p?.episodeId);
  const sound = useSoundtrack(p, update, flush);
  const [soundtrackExpanded, setSoundtrackExpanded] = useState(true);
  const [audioInspector, setAudioInspector] = useState(null);
  useEffect(() => { setAudioInspector(null); }, [p?.id, p?.episodeId]);
  useEffect(() => {
    if (audioInspector && !p?.audioClips.some(c => c.id === audioInspector)) setAudioInspector(null);
  }, [audioInspector, p?.audioClips]);
  const [timelineMode, setTimelineMode] = useState("all");
  const [assistantScene, setAssistantScene] = useState(null);
  const composerBeforeDirection = useRef(false);
  const [directionComposerHost, setDirectionComposerHost] = useState(null);
  const audioFocus = timelineMode === "sound";
  const openSoundtrack = () => {
    elementEditor.close();
    setAudioInspector(null);
    setTimelineMode("sound");
    setSoundtrackExpanded(true);
    setComposerCollapsed(false);
  };
  const closeSoundtrack = () => {
    setTimelineMode("all");
  };
  const changeTimelineMode = (mode) => {
    setAudioInspector(null);
    if(mode === "elements") elementEditor.open(); else elementEditor.close();
    if (mode === "direction" && timelineMode !== "direction") {
      composerBeforeDirection.current = composerCollapsed;
      setComposerCollapsed(false);
    } else if (timelineMode === "direction" && mode !== "direction") {
      setComposerCollapsed(composerBeforeDirection.current);
    }
    if (mode === "sound") openSoundtrack();
    else setTimelineMode(mode);
  };
  const soundtrackDirty = useMemo(
    () => (p ? soundtrackDirtyClips(p).size : 0),
    [
      p?.clips,
      p?.audioClips,
      p?.drafts,
      p?.assets,
      p?.production?.voiceAssignments,
    ],
  );
  const [projects, setProjects] = useState([]),
    [models, setModels] = useState([]),
    [videoMode, setVideoMode] = useState("demo"),
    [globalVideoDefaults, setVideoDefaults] = useState({}),
    [holdToGenerate, setHoldToGenerate] = useState(
      () => localStorage.getItem("splece-hold-generate") !== "off",
    ),
    [modelFavorites, setModelFavorites] = useState(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("splece-model-favorites") || "[]",
        );
        return Array.isArray(saved)
          ? saved.filter((id) => typeof id === "string")
          : [];
      } catch {
        return [];
      }
    }),
    [quote, setQuote] = useState(null),
    [catalogTick, setCatalogTick] = useState(0),
    [jobs, setJobs] = useState([]),
    [jobsProjectId, setJobsProjectId] = useState(null),
    [poolExpanded, setPoolExpanded] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [previewRatio, setPreviewRatio] = useState("fit"),
    [comparing, setComparing] = useState(false),
    [dropAt, setDropAt] = useState(null),
    [dragItem, setDragItem] = useState(null),
    [dropPreview, setDropPreview] = useState(null),
    [revisionFlash, setRevisionFlash] = useState(null),
    [time, setPlaybackTime] = useState(0),
    [seekId, setSeekId] = useState(0),
    [playbackRepair, setPlaybackRepair] = useState(null),
    [optimizingPreview, setOptimizingPreview] = useState(false),
    [playing, setPlaying] = useState(false),
    [composerCollapsed, setComposerCollapsed] = useState(false),
    [selected, setPrimarySelected] = useState(null),
    [selectionIds, setSelectionIds] = useState([]),
    [foldState, setFoldState] = useState({ scope: "", ids: [] }),
    [selectedGroupId, setSelectedGroupId] = useState(null),
    [rangeMode, setRangeMode] = useState(false),
    [repairRange, setRepairRange] = useState(null),
    [trimPreview, setTrimPreview] = useState(null),
    [frameMenu, setFrameMenu] = useState(false),
    [view, setView] = useState("compose"),
    [workspace, setWorkspace] = useState(() =>
      window.location.hash === "#story" ? "story" : "editor",
    ),
    [home, setHome] = useState(() => window.location.hash === "#home"),
    [modal, setModal] = useState(null),
    [structureCompose, setStructureCompose] = useState(false),
    [toast, setToast] = useState(""),
    [viewport, setViewport] = useState({ left: 0, width: 0 }),
    [busy, setBusy] = useState(""),
    [zoom, setZoom] = useState(120),
    [snap, setSnap] = useState(true),
    [footerToolsOpen, setFooterToolsOpen] = useState(false),
    [inspect, setInspect] = useState(null),
    [simulation, setSimulation] = useState("normal"),
    [leftWidth, setLeftWidth] = useState(
      () => Number(localStorage.getItem("frame-left-width")) || 390,
    ),
    [timelineHeight, setTimelineHeight] = useState(() =>
      Math.max(
        240,
        Number(localStorage.getItem("splece-canvas-timeline-height")) || 260,
      ),
    ),
    [clipboard, setClipboard] = useState(null),
    [audioWaiting, setAudioWaiting] = useState(false);
  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      home
        ? "#home"
        : workspace === "story"
          ? "#story"
          : window.location.pathname,
    );
  }, [workspace, home]);
  useEffect(() => {
    setBrowserPreference("frame-left-width", leftWidth);
    setBrowserPreference("splece-canvas-timeline-height", timelineHeight);
  }, [leftWidth, timelineHeight]);
  const selectionAnchor = useRef(null);
  const foldScope = p ? `${p.id}:${p.episodeId}` : "";
  const collapsedGroups = foldState.scope === foldScope ? foldState.ids : [];
  useEffect(() => {
    let ids = [];
    try {
      ids = JSON.parse(
        localStorage.getItem("splece-folds-" + foldScope) || "[]",
      );
    } catch {}
    setFoldState({ scope: foldScope, ids: Array.isArray(ids) ? ids : [] });
    setPrimarySelected(null);
    setSelectionIds([]);
    setRepairRange(null);
    setTrimPreview(null);
    setFrameMenu(false);
    selectionAnchor.current = null;
  }, [foldScope]);
  const setSelected = (id) => {
    setPrimarySelected(id);
    setSelectionIds(id ? [id] : []);
    selectionAnchor.current = id;
  };
  const selection = new Set(
    selectionIds.filter((id) => p?.clips.some((c) => c.id === id)),
  );
  const timelineProject = trimPreview || p;
  const foldedItems = useMemo(
    () =>
      timelineProject ? foldedTimeline(timelineProject, collapsedGroups) : [],
    [timelineProject, foldState],
  );
  const frameUsages = useMemo(
    () => (timelineProject ? timelineFrameUsages(timelineProject) : []),
    [timelineProject],
  );
  function toggleGroupFold(node) {
    const ids = collapsedGroups.includes(node.id)
      ? collapsedGroups.filter((id) => id !== node.id)
      : [...collapsedGroups, node.id];
    setFoldState({ scope: foldScope, ids });
    setBrowserPreference("splece-folds-" + foldScope, JSON.stringify(ids));
  }
  function modifiedSelection(e, ids) {
    const next = selectTimelineClips(p.clips, [...selection], ids, {
      toggle: e.metaKey || e.ctrlKey,
      range: e.shiftKey,
      anchor: selectionAnchor.current,
    });
    setPrimarySelected(
      next.includes(ids.at(-1)) ? ids.at(-1) : next.at(-1) || null,
    );
    setSelectionIds(next);
    setSelectedGroupId(null);
    if (!e.shiftKey) selectionAnchor.current = ids[0];
  }
  const video = useRef(null),
    fileInput = useRef(null),
    importIntent = useRef({ kind: "footage" }),
    timeline = useRef(null),
    pendingTimelineFocus = useRef(null),
    wheelAnchor = useRef(null),
    liveZoom = useRef(zoom),
    lastWheel = useRef(null),
    submissionLock = useRef(false);
  const setTime = useCallback((value) => {
    setPlaybackTime(value);
    setSeekId((n) => n + 1);
  }, []);
  useEffect(() => {
    const id = pendingTimelineFocus.current;
    if (!id) return;
    if (selected !== id) { pendingTimelineFocus.current = null; return; }
    const tile = [...(timeline.current?.querySelectorAll("[data-clip],[data-audio-clip]") || [])]
      .find(el => (el.dataset.clip || el.dataset.audioClip) === id);
    if (tile) {
      tile.focus({ preventScroll: true });
      pendingTimelineFocus.current = null;
    }
  });
  function selectInsertedClip(clip) {
    pendingTimelineFocus.current = clip.id;
    setSelected(clip.id);
    setTime(clip.start);
    setPlaying(false);
    timeline.current?.scrollTo({ left: Math.max(0, clip.start * zoom - 100) });
  }
  useEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const wheel = (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        if (el.classList.contains("timeline-scrubbing")) return;
        const next = wheelZoom({
          zoom: liveZoom.current,
          scrollLeft: wheelAnchor.current?.left ?? el.scrollLeft,
          pointerX: e.clientX - el.getBoundingClientRect().left,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          width: el.clientWidth,
        });
        if (next.zoom !== liveZoom.current) {
          liveZoom.current = next.zoom;
          wheelAnchor.current = next;
          setZoom(next.zoom);
        }
        return;
      }
      const clip = e.target.closest("[data-clip]");
      if (
        clip &&
        p?.clips.find((c) => c.id === clip.dataset.clip)?.takes.length > 1
      )
        e.preventDefault();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [p, workspace, home]);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setSelected(null);
    setSelectedGroupId(null);
    setInspect(null);
    setComparing(false);
  }, [p?.id, p?.episodeId]);
  const draft =
    p?.drafts.find((d) => d.id === p.activeDraftId) ||
    p?.drafts.find((d) => !d.closed);
  const structurePlan = p?.storyPlans?.[p.episodeId];
  useEffect(() => {
    if (!p) return;
    const candidate = structuredClone(p);
    if (reconcilePlannedTimeline(candidate))
      update((n) => {
        reconcilePlannedTimeline(n);
      }, false);
  }, [p?.id, p?.episodeId, structurePlan]);
  useEffect(() => {
    if (playing && !audioFocus && timelineMode !== "direction") setComposerCollapsed(true);
  }, [playing, audioFocus, timelineMode]);
  const selectedGroup = structurePlan?.beats.find(
    (b) => b.id === selectedGroupId && !isStructureClip(b),
  );
  function selectStructureNode(node) {
    setComposerCollapsed(false);
    if (!node) {
      setSelectedGroupId("__root");
      return;
    }
    if (isStructureClip(node)) {
      const existing = chooseGroupDraft(
        {
          drafts: p.drafts.filter(
            (d) => d.storyBeatId === node.id && d.episodeId === p.episodeId,
          ),
        },
        p.activeDraftId,
      );
      if (existing) {
        focusDraft(existing);
        return;
      }
      const created = beatDraft(p, node, createDefaultDraft(node.start));
      update((n) => {
        n.drafts.push(created);
        n.activeDraftId = created.id;
      });
      focusDraft(created);
      setView("compose");
      return;
    }
    setSelectedGroupId(node.id);
    setSelected(p.clips.find((c) => c.structureNodeId === node.id)?.id || null);
    setSelectionIds(groupSlots(p, node.id).map((c) => c.id));
    selectionAnchor.current = groupSlots(p, node.id)[0]?.id || null;
    setPlaying(false);
    const timing = editedStoryTiming(p, jobs).get(node.id);
    if (timing?.placed) {
      setTime(timing.start);
      timeline.current?.scrollTo({
        left: Math.max(0, timing.start * zoom - 28),
        behavior: "smooth",
      });
    }
  }
  const total = Math.max(
    0,
    ...(timelineProject?.clips.map((c) => c.start + c.duration) || []),
    ...(p?.audioClips?.map((c) => c.start + c.duration) || []),
    ...(p ? elementsFor(p).map(e=>e.start+e.duration) : []),
  );
  const directionItems = useMemo(() => p ? directionRanges(p) : [], [p]);
  const timelineEnd = Math.max(total, ...directionItems.map((item) => item.end));
  const scrubEnd = timelineMode === "direction"
    ? Math.max(timelineEnd, Number(draft?.settings?.duration) || 5)
    : total;
  const fittedScope = useRef(null);
  useEffect(() => {
    const scope = p?.id + ":" + p?.episodeId;
    if (!p || !total || !viewport.width || fittedScope.current === scope)
      return;
    if (reconcilePlannedTimeline(structuredClone(p))) return;
    fittedScope.current = scope;
    setZoom(120);
  }, [p?.id, p?.episodeId, total, viewport.width]);
  const activeClip =
    p?.clips.find((c) => time >= c.start && time < c.start + c.duration) ||
    (time >= total && total > 0
      ? p?.clips.find((c) => Math.abs(c.start + c.duration - total) < 0.001)
      : null);
  const [timelineFocus,setTimelineFocus] = useState({armed:null,solo:null});
  useEffect(()=>setTimelineFocus({armed:null,solo:null}),[p?.id,p?.episodeId]);
  function focusTimeline(event,kind,id) {
    if (!event.ctrlKey && !(timelineFocus.armed?.id === id && timelineFocus.armed?.kind === kind)) {
      if(timelineFocus.armed) setTimelineFocus({armed:null,solo:null});
      return false;
    }
    event.preventDefault(); event.stopPropagation();
    setTimelineFocus(old=>nextTimelineFocus(old,{kind,id},event.ctrlKey));
    setSelected(id);
    return true;
  }
  const selectedClip = p?.clips.find((c) => c.id === selected);
  const elementEditor = useElementsEditor({project:p,update,time,onSeek:at=>{setTime(at);setPlaying(false);},onOpen:()=>{setAudioInspector(null);setComposerCollapsed(true);setPlaying(false);}});
  const removeInspectedMedia = (clip = elementEditor.item) => {
    const id = clip?.id;
    if (!id) return;
    elementEditor.finishEdit();
    update(n => {
      const current = n.clips.find(c => c.id === id);
      if (current?.plannedReservation && !current.activeTake) {
        removePlannedClip(n, id);
        if (!n.drafts.some(d => !d.closed && d.episodeId === n.episodeId)) {
          const empty = createDefaultDraft(0); n.drafts.push(empty); n.activeDraftId = empty.id;
        }
      } else removeStorySlot(n, id);
    });
    elementEditor.close(); setSelected(null); setPlaying(false);
    notice("Clip removed. Undo restores it.");
  };
  const compositionAspect = (p?.settings?.export?.aspect || '16:9').split(':').map(Number);
  const compositionRatio = compositionAspect[0] / compositionAspect[1] || 16/9;
  const mediaPose = animatedMediaPose(elementEditor.target?.type==='media' && elementEditor.item?.id===activeClip?.id ? elementEditor.item : activeClip,time);
  const selectedAudio = p?.audioClips?.find((c) => c.id === selected);
  const sourceTake = takeOf(activeClip);
  const previewEnabled =
    !!p && !home && workspace === "editor" && !poolExpanded && !comparing;
  const fullscreen = usePreviewFullscreen({ enabled: previewEnabled, scope: p?.id + "/" + p?.episodeId, onExit: () => setPlaying(false) });
  const nextClip = nextPreviewClip(
    p?.clips || [],
    activeClip,
    time,
    playing,
    previewEnabled,
  );
  const previewMedia = usePreviewMedia({
    current: sourceTake,
    next: takeOf(nextClip),
    enabled: previewEnabled,
    retry:
      playbackRepair && playbackRepair.id === sourceTake?.id
        ? playbackRepair.at
        : 0,
    scope: p?.id,
    playing,
  });
  const activeTake = previewMedia.current;
  const previewJob = activeClip
    ? currentSlotJob(activeClip, jobs, p.episodeId)
    : null;
  const previewStatus = usePreviewPlayback({
    video,
    clip: auditionSource(activeClip,timelineFocus.solo),
    take: activeTake,
    time,
    setPlaybackTime,
    playing: playing && !audioWaiting,
    setPlaying,
    seekId,
    total,
    scope: p?.id + "/" + p?.episodeId,
    enabled: previewEnabled,
  });
  const detachedGenerations = activeDetachedGenerations(jobs, p);
  const running = jobs.filter(
    (j) => !["ready", "failed", "cancelled"].includes(j.state),
  );
  const notice = (msg) => {
    setToast(msg);
  };
  useEffect(() => {
    window.addEventListener("studio-mode-changed", refreshVideoModels);
    window.addEventListener("provider-catalog-updated", refreshVideoModels);
    return () => {
      window.removeEventListener("studio-mode-changed", refreshVideoModels);
      window.removeEventListener("provider-catalog-updated", refreshVideoModels);
    };
  }, []);
  useEffect(() => {
    refreshVideoModels();
    Promise.allSettled([api("/projects"), api("/connections")]).then(([projectsResult, connectionResult]) => {
      const items = projectsResult.status === "fulfilled" ? projectsResult.value : null;
      if (items) setProjects(items);
      else notice(projectsResult.reason.message);
      const connections = connectionResult.status === "fulfilled" ? connectionResult.value : null;
      setFirstRun(!!items && !!connections && !connections.onboarding.completed && !items.length && !connections.connections.some(c => c.hasKey));
      if (!connections) notice(connectionResult.reason.message);
    });
    const last = localStorage.getItem("frame-last-project");
    if (last) load(last).catch((e) => notice(e.message));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!p) return;
    let alive = true;
    let polling = false,
      signature = "";
    const poll = () => {
      if (polling) return;
      polling = true;
      return api("/projects/" + p.id + "/jobs")
        .then((js) => {
          const nextSignature = JSON.stringify(js);
          if (alive && nextSignature !== signature) {
            signature = nextSignature;
            setJobs(js);
            setJobsProjectId(p.id);
          }
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [p?.id]);
  useEffect(() => {
    if (!p || jobsProjectId !== p.id) return;
    const candidate = structuredClone(p);
    const merged = consolidateGenerationSlots(candidate, jobs);
    const adopted = adoptReadyGenerations(candidate, jobs);
    const stitched = stitchTimeline(candidate);
    if (merged || adopted || stitched) {
      update((n) => {
        consolidateGenerationSlots(n, jobs);
        adoptReadyGenerations(n, jobs);
        stitchTimeline(n);
      }, false);
      const before = p.clips.find(
        (c) => time >= c.start && time < c.start + c.duration,
      );
      const after = candidate.clips.find((c) => c.id === before?.id);
      if (
        before &&
        after &&
        (before.start !== after.start || time >= after.start + after.duration)
      )
        setTime(
          after.start +
            Math.min(time - before.start, Math.max(0, after.duration - 1 / 24)),
        );
    }
  }, [jobs, jobsProjectId, p?.id, p?.episodeId]);
  useEffect(() => {
    const el = timeline.current;
    if (!el) return;
    const measure = () =>
      setViewport({ left: el.scrollLeft, width: el.clientWidth });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [workspace, home, p?.id]);
  useLayoutEffect(() => {
    const el = timeline.current;
    liveZoom.current = zoom;
    if (wheelAnchor.current) {
      if (el) el.scrollLeft = wheelAnchor.current.left;
      wheelAnchor.current = null;
      return;
    }
    if (el)
      el.scrollTo({
        left:
          total * zoom <= el.clientWidth
            ? 0
            : Math.max(0, time * zoom - el.clientWidth * 0.35),
      });
  }, [zoom]);
  useEffect(() => {
    if (workspace === "editor" && !home)
      timeline.current?.scrollTo({ left: Math.max(0, time * zoom - 100) });
  }, [workspace, home, p?.id]);
  useEffect(() => {
    if (!p) return;
    const intents = submissionJournal.read(p.id);
    if (!intents.length) return;
    let alive = true;
    // Reconcile receipts, never replay an unaccepted paid request on page load.
    // Accepted jobs already live in the durable server queue and resume there.
    api("/projects/" + p.id + "/jobs")
      .then((receipts) => {
        if (!alive) return;
        const accepted = new Set(receipts.map((j) => j.requestId));
        const pending = submissionJournal.read(p.id);
        const left = pending.filter(
          (intent) => !accepted.has(intent.requestId),
        );
        submissionJournal.write(p.id, left);
        if (left.length)
          notice(
            "An earlier submission has no confirmed receipt. Check generation activity before trying again. Your saved prompt is kept.",
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [p?.id]);
  const editDraft = (fn, record = true) =>
    update((n) => fn(n.drafts.find((d) => d.id === draft.id)), record);
  function createDefaultDraft(start = 0) {
    const d = makeDraft(start);
    const saved = videoDefaults[videoMode];
    const m = preferredVideoModel(models, saved?.model);
    d.settings = fitVideoSettings(saved || d.settings, m);
    return d;
  }
  const addDraft = (source, snapshot) => {
    setComposerCollapsed(false);
    setSelectedGroupId(null);
    const d = source ? structuredClone(source) : createDefaultDraft(time);
    if (!source) {
      d.automation = {};
      d.name = "New clip " + (p.drafts.length + 1);
    }
    d.id = uid();
    if (!source) d.promptGroupId = "draft:" + d.id;
    d.episodeId = p.episodeId;
    d.closed = false;
    if (source) {
      d.name = source.name + " · variation";
      d.promptGroupId = promptGroupKey(source);
      delete d.sourceGenerationId;
      d.generationSlotId = source.targetId || source.generationSlotId || null;
      d.targetId = null;
    }
    update((n) => {
      if (snapshot) {
        reuseGeneration(n, snapshot);
        return;
      }
      if (source && !source.storyBeatId) {
        const original = n.drafts.find((v) => v.id === source.id);
        if (original) original.promptGroupId = d.promptGroupId;
      }
      n.drafts.push(d);
      n.activeDraftId = d.id;
    });
    setView("compose");
    setInspect(null);
    setPlaying(false);
    setSelected(source ? generationTarget(p, source, jobs)?.id || null : null);
  };
  const detachSelectedAudio = () => {
    try {
      const next = structuredClone(p);
      const audio = detachAudio(next, selected, uid());
      update((n) => {
        n.clips = next.clips;
        n.audioClips = next.audioClips;
        n.audioLanes = next.audioLanes;
      });
      setSelected(audio.id);
      setPlaying(false);
      setTime(audio.start);
      notice(
        "Audio detached. The video’s source sound is muted; both remain editable.",
      );
    } catch (e) {
      notice(e.message);
    }
  };
  const duplicateAudio = () => {
    if (!selectedAudio) return;
    const id = uid();
    update((n) =>
      copyAudio(
        n,
        selectedAudio,
        id,
        selectedAudio.start + selectedAudio.duration,
      ),
    );
    setSelected(id);
  };
  const removeClip = () => {
    if (repairRange) {
      editRange("remove");
      return;
    }
    if (selection.size > 1) {
      notice(
        "Select one clip before deleting. Drag the selection to move it together.",
      );
      return;
    }
    if (selectedAudio) {
      update((n) => {
        n.audioClips = n.audioClips.filter((c) => c.id !== selected);
      });
      setSelected(null);
      notice("Audio removed. Undo restores it.");
      return;
    }
    if (selectedClip?.plannedReservation && !selectedClip.activeTake) {
      update(n => {
        removePlannedClip(n, selectedClip.id);
        if (!n.drafts.some(d => !d.closed && d.episodeId === n.episodeId)) {
          const empty = createDefaultDraft(0); n.drafts.push(empty); n.activeDraftId = empty.id;
        }
      });
      setSelected(null);
      setSelectedGroupId(null);
      setInspect(null);
      notice("Planned clip removed. Undo restores the prompt and its place in Structure.");
      return;
    }
    if (selected) {
      update((n) => removeStorySlot(n, selected));
      setTime(
        Math.max(0, Math.min(time, total - (selectedClip?.duration || 0))),
      );
      notice("Clip removed. Restore it from the generation pool or Undo.");
    }
    setSelected(null);
    setInspect(null);
  };
  const split = () => {
    if (selection.size > 1) {
      notice(
        "Select one clip before splitting. Drag the selection to move it together.",
      );
      return;
    }
    if (selectedAudio) {
      try {
        const next = structuredClone(p),
          id = uid();
        splitAudio(next, selected, time, id);
        update((n) => {
          n.audioClips = next.audioClips;
        });
        setSelected(id);
      } catch (e) {
        notice(e.message);
      }
      return;
    }
    const c = selectedClip || activeClip;
    if (c?.plannedReservation && !c.activeTake) {
      notice("Generate or import footage before splitting this slot.");
      return;
    }
    if (!c || time <= c.start + 0.04 || time >= c.start + c.duration - 0.04) {
      notice("Place the playhead inside a clip to split it.");
      return;
    }
    update((n) => {
      const x = n.clips.find((x) => x.id === c.id),
        delta = time - x.start;
      const second = {
        ...structuredClone(x),
        id: uid(),
        start: time,
        in: x.in + delta,
        duration: x.duration - delta,
      };
      x.duration = delta;
      markIndependentSegment(x);
      markIndependentSegment(second);
      n.clips.push(second);
    });
  };
  const copy = () => {
    if (repairRange) {
      editRange("copy");
      return;
    }
    if (selection.size > 1) {
      notice(
        "Select one clip before copying. Drag the selection to move it together.",
      );
      return;
    }
    if (
      !selectedAudio &&
      selectedClip?.plannedReservation &&
      !selectedClip.activeTake
    ) {
      notice("Generate or import footage into this slot before copying it.");
      return;
    }
    if (selectedAudio) {
      setClipboard({
        type: "audio",
        clip: structuredClone(selectedAudio),
        projectId: p.id,
      });
      notice("Audio copied");
      return;
    }
    if (selectedClip) {
      setClipboard(structuredClone(selectedClip));
      notice("Clip copied");
    }
  };
  const cut = () => {
    if (repairRange) {
      editRange("cut");
      return;
    }
    if (selection.size > 1) {
      notice(
        "Select one clip before cutting. Drag the selection to move it together.",
      );
      return;
    }
    if (
      !selectedAudio &&
      selectedClip?.plannedReservation &&
      !selectedClip.activeTake
    ) {
      notice("Edit planned clips and groups in Structure.");
      return;
    }
    if (selectedAudio) {
      copy();
      removeClip();
      return;
    }
    if (selectedClip) {
      setClipboard(structuredClone(selectedClip));
      removeClip();
    }
  };
  const paste = () => {
    if (clipboard?.type === "video-range") {
      try {
        update((n) => pasteTimelineRange(n, clipboard, time, uid));
        setRepairRange(null);
        notice("Range inserted at playhead");
      } catch (error) {
        notice(error.message);
      }
      return;
    }
    if (clipboard?.type === "audio") {
      if (clipboard.projectId !== p.id) {
        notice("Paste audio within its original project.");
        return;
      }
      const id = uid();
      update((n) => copyAudio(n, clipboard.clip, id, time));
      setSelected(id);
      return;
    }
    if (clipboard)
      update((n) =>
        insertStorySlot(
          n,
          {
            ...structuredClone(clipboard),
            id: uid(),
            start: time,
            independentSlot: true,
            generationTargets: [],
          },
          time,
        ),
      );
  };
  useEffect(() => {
    const key = (e) => {
      if (
        !p ||
        home ||
        comparing ||
        poolExpanded ||
        modal ||
        store.conflict
      )
        return;
      if (timelineMode === "direction" && e.key === "Escape" && !e.target.closest?.(editableSelector)) {
        setRepairRange(null);
        return;
      }
      if (elementEditor.handleKeyDown(e, {onRemoveMedia:removeInspectedMedia})) return;
      if (audioInspector && e.key === "Escape" && !e.target.closest?.(editableSelector)) {
        e.preventDefault(); setAudioInspector(null); return;
      }
      const command = editShortcut(e, {
        editable: !!e.target.closest?.(editableSelector),
        control: !!e.target.closest?.(controlSelector),
        editor: workspace === "editor" && !["direction","elements"].includes(timelineMode) && !elementEditor.target,
        composer: !!e.target.closest?.(".creative-composer,.composer-companion"),
        timeline: !!e.target.closest?.(".timeline-panel"),
        clip: !!e.target.matches?.("[data-audio-clip]"),
      });
      if (!command) return;
      e.preventDefault();
      if (command === "save") { act(() => { elementEditor.finishEdit(); return flush(); }); return; }
      if (command === "undo" || command === "redo") { revise(command); return; }
      if (command === "selectAll") setSelectionIds(p.clips.map(c => c.id));
      if (command === "clear") {
        setRepairRange(null); setFrameMenu(false); setSelected(null); setSelectedGroupId(null);
      }
      if (command === "copy") copy();
      if (command === "cut") cut();
      if (command === "paste") paste();
      if (command === "split") split();
      if (command === "remove") removeClip();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    const transportKey = (e) => {
      if (!ownsTransport(e, {
        blocked: !p || home || workspace !== "editor" || modal || store.conflict || comparing || poolExpanded,
        editable: !!e.target.closest?.(editableSelector),
        control: !!e.target.closest?.(controlSelector + ',[role="dialog"]'),
      })) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "keyup") return;
      if (e.code === "Space") {
        if (e.repeat) return;
        if (!playing && time >= total) setTime(0);
        setPlaying((v) => !v);
      } else {
        setPlaying(false);
        const step = e.shiftKey ? 1 : 1 / p.settings.export.fps;
        setTime((t) =>
          Math.max(
            0,
            Math.min(total, t + (e.code === "ArrowRight" ? step : -step)),
          ),
        );
      }
    };
    window.addEventListener("keydown", transportKey);
    window.addEventListener("keyup", transportKey);
    return () => {
      window.removeEventListener("keydown", transportKey);
      window.removeEventListener("keyup", transportKey);
    };
  }, [
    p?.id,
    p?.settings.export.fps,
    comparing,
    poolExpanded,
    home,
    workspace,
    modal,
    store.conflict,
    playing,
    time,
    total,
  ]);
  async function act(fn) {
    try {
      return await fn();
    } catch (e) {
      notice(e.message);
      return null;
    }
  }
  async function adoptLibraryItem(item) {
    await flush();
    const asset = await api(`/projects/${p.id}/library/adopt`, {
      libraryId: item.entry.id,
    });
    update((n) => {
      if (!n.assets.some((a) => a.id === asset.id)) n.assets.push(asset);
    });
    return asset;
  }
  async function useLibraryItem(item, at = time) {
    await act(async () => {
      if (item.entry) useDroppedAsset(await adoptLibraryItem(item), at);
      else if (item.asset) useDroppedAsset(item.asset, at);
      else restoreVideo(item.key, at);
    });
  }
  async function importFiles(files, intent = { kind: "footage" }) {
    if (!p) return;
    setBusy("Importing media · preparing smooth playback");
    for (const f of files) {
      await act(async () => {
        const form = new FormData();
        form.append("file", f);
        const r = await fetch("/api/projects/" + p.id + "/import", {
          method: "POST",
          body: form,
        });
        const m = await r.json();
        if (!r.ok) throw new Error(m.error);
        if (intent.onMedia) intent.onMedia(m);
        else {
          const asset = importedAsset(m, intent.kind);
          update((n) => n.assets.push(asset));
          if (intent.folderId) {
            const next = await api(
              "/library/organization",
              {
                id: p.id + ":" + asset.id,
                patch: { folderId: intent.folderId },
              },
              "PATCH",
            );
            window.dispatchEvent(
              new CustomEvent("splece-library-organization", { detail: next }),
            );
          }
        }
      });
    }
    setBusy("");
  }
  function importTimelineFiles(files, at = time, splitAtPlayhead = false) {
    let cursor = at;
    return importFiles(files, {kind:'footage', onMedia: m => {
      update(n => n.assets.push(importedAsset(m, m.kind === 'audio' ? 'audio' : 'footage')));
      if (splitAtPlayhead && m.kind !== 'audio') {
        const source = p.clips.find(c=>c.activeTake && cursor > c.start && cursor < c.start+c.duration);
        if (source) {
          update(n=>{
            const {slot}=insertPromptAtFrame(n,source.id,cursor,m.duration);
            slot.takes=[m];slot.activeTake=m.id;slot.in=0;slot.plannedReservation=false;
          });
        } else addMedia(m,cursor);
      } else addMedia(m,cursor);
      cursor += m.duration;
    }});
  }
  function importAtPlayhead(kind) {
    const at=time;
    importIntent.current={kind:'footage',onMedia:m=>{
      update(n=>n.assets.push(importedAsset(m,kind==='audio'?'audio':'footage')));
      if(kind==='image' && activeClip?.activeTake){
        update(n=>{const {slot}=insertPromptAtFrame(n,activeClip.id,at,m.duration);slot.takes=[m];slot.activeTake=m.id;slot.in=0;slot.plannedReservation=false;});
      } else addMedia(m,at);
    }};
    fileInput.current.multiple=false;
    fileInput.current.accept=kind==='image'?'image/png,image/jpeg,image/webp':'audio/*';
    fileInput.current.click();
  }
  function connectPhotos(beforeId,afterId,writing) {
    let target;
    update(n=>{
      const before=n.clips.find(c=>c.id===beforeId), after=n.clips.find(c=>c.id===afterId);
      if(!before || !after) throw Error('These photos moved. Choose them again.');
      const ordered=[...n.clips].sort((a,b)=>a.start-b.start);
      if(ordered[ordered.indexOf(before)+1]?.id!==after.id)throw Error('Choose neighboring photos.');
      const defaults=createDefaultDraft(before.start+before.duration);
      const result=insertPromptAtFrame(n,before.id,before.start+before.duration,defaults.settings.duration);
      const d=beatDraft(n,result.node,defaults);
      d.name='Between photos';
      result.node.title='Between photos';result.slot.intent='Between photos';
      d.scenes[0].text=writing;d.scenes[0].movement="Auto";
      d.frameOverrides={start:{mode:'manual',frame:{takeId:before.activeTake,mediaId:before.activeTake,kind:'image',time:0,timelineCapture:true}},end:{mode:'manual',frame:{takeId:after.activeTake,mediaId:after.activeTake,kind:'image',time:0,timelineCapture:true}}};
      d.automation={...d.automation,frames:true,startFrame:true,endFrame:true};
      n.drafts.push(d);n.activeDraftId=d.id;target=result.slot;
    });
    setModal(null);setSelected(target.id);setTime(target.start);setPlaying(false);setView('compose');setComposerCollapsed(false);
  }
  async function optimizePlayback() {
    if (!activeTake || optimizingPreview) return;
    const id = activeTake.id;
    setPlaying(false);
    setOptimizingPreview(true);
    await act(async () => {
      await api("/media/" + id + "/optimize-preview", {}, "POST", {
        timeoutMs: 1800000,
      });
      setPlaybackRepair({ id, at: Date.now() });
      notice(
        "Playback copy optimized locally. Original footage and timeline edits are preserved.",
      );
    });
    setOptimizingPreview(false);
  }
  function useDroppedAsset(asset, at) {
    if (
      ["footage", "audio"].includes(asset.kind) ||
      asset.media?.kind === "audio"
    ) {
      if (asset.media) addMedia(asset.media, at);
      return;
    }
    const target = p.clips.find(
      (c) => at >= c.start && at < c.start + c.duration,
    );
    update((n) =>
      attachClipReference(n, target?.id, asset.id, jobs, createDefaultDraft),
    );
    setComposerCollapsed(false);
    setSelectedGroupId(null);
    setView("compose");
    setPlaying(false);
    if (target) {
      setSelected(target.id);
      setTime(target.start);
    }
    setPoolExpanded(false);
    notice(`${asset.name} attached as a prompt reference`);
  }
  function addMedia(m, start = time) {
    if (!Number.isFinite(m.duration) || m.duration <= 0) {
      notice(
        "This media has no playable duration.",
      );
      return;
    }
    const saved = generationPool(p, jobs).find(
      (e) => e.media.id === m.id || e.clip?.takes.some((t) => t.id === m.id),
    );
    if (saved) {
      restoreVideo(saved.key, start, m.id);
      return;
    }
    if (m.kind === "audio") {
      // Reveal the new waveform without changing any clip bounds or zoom.
      setTimelineHeight((height) => Math.max(height, 320));
      const id = uid();
      update((n) => {
        const lane = freeAudioLane(n.audioClips, start, m.duration);
        n.audioClips.push({
          ...audioClip(m, id, start, lane),
          ...n.settings.audioDefaults,
        });
        n.audioLanes = Math.max(n.audioLanes, lane + 1);
      });
      selectInsertedClip({ id, start });
      return;
    }
    let inserted;
    update((n) => {
      const incoming = {
        id: uid(),
        start,
        in: 0,
        duration: m.duration,
        takes: [m],
        activeTake: m.id,
        volume: p.settings.audioDefaults?.volume ?? 1,
        mute: p.settings.audioDefaults?.mute ?? false,
        intent: "",
      };
      inserted = fillPlannedSlot(n, incoming, start, false);
      if (!inserted) {
        insertStorySlot(n, incoming, start);
        inserted = n.clips.find(c => c.id === incoming.id);
      }
    });
    if (inserted) selectInsertedClip(inserted);
  }
  function restoreVideo(key, at = time, preferredTakeId) {
    let restored;
    try {
      update((n) => {
        restored = restorePoolEntry(n, jobs, key, at, uid, preferredTakeId);
        openClipPrompt(n, restored.id, jobs);
      });
      selectInsertedClip(restored);
      setPoolExpanded(false);
      setTime(restored.start);
      setPlaying(false);
      setView("compose");
      setInspect(null);
      timeline.current?.scrollTo({
        left: Math.max(0, restored.start * zoom - 100),
        behavior: "smooth",
      });
      notice(
        "Video ready in the timeline. Its takes and prompt are preserved.",
      );
    } catch (e) {
      notice(e.message);
    }
  }
  function dragPoolVideo(e, key, suppressClick, libraryItem) {
    if (e.button !== 0) return;
    e.preventDefault();
    const origin = { x: e.clientX, y: e.clientY };
    const asset = libraryItem?.entry
      ? libraryItem.asset
      : key.startsWith("asset:")
        ? p.assets.find((a) => a.id === key.slice(6))
        : null;
    const item =
      libraryItem ||
      (asset
        ? { key, asset, media: asset.media }
        : generationPool(p, jobs).find((e) => e.key === key));
    setDragItem(item);
    let moved = false;
    const destination = (ev) => {
      const rect = timeline.current
        ?.querySelector(".timeline-content")
        ?.getBoundingClientRect();
      const viewport = timeline.current?.getBoundingClientRect();
      if (
        !rect ||
        !viewport ||
        ev.clientX < viewport.left ||
        ev.clientX > viewport.right ||
        ev.clientY < viewport.top ||
        ev.clientY > viewport.bottom
      )
        return null;
      return Math.max(0, (ev.clientX - rect.left) / zoom);
    };
    const move = (ev) => {
      if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 6)
        moved = true;
      if (!moved) return;
      const at = destination(ev);
      setDropPreview(at === null ? null : timelineDropPreview(p, item, at));
      const next = [...p.clips]
        .sort((a, b) => a.start - b.start)
        .find((c) => at < c.start + c.duration / 2);
      setDropAt(
        at === null
          ? null
          : (next?.start ??
              Math.max(0, ...p.clips.map((c) => c.start + c.duration))),
      );
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDropAt(null);
      setDropPreview(null);
      setDragItem(null);
      if (!moved) return;
      suppressClick();
      const at = destination(ev);
      if (at !== null) {
        if (item?.entry) useLibraryItem(item, at);
        else if (asset) useDroppedAsset(asset, at);
        else restoreVideo(key, at);
      } else if (
        asset &&
        document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest(".creative-composer") &&
        !["footage", "audio"].includes(asset.kind)
      )
        useDroppedAsset(asset, draft.start);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setDropAt(null);
      setDropPreview(null);
      setDragItem(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }
  async function demo() {
    setBusy("Preparing sample footage");
    await act(async () => {
      const media = await api("/projects/" + p.id + "/demo", {});
      update((n) => {
        let start = Math.max(0, ...n.clips.map((c) => c.start + c.duration));
        media.forEach((m, i) => {
          n.assets.push({
            id: uid(),
            name: m.name,
            kind: "footage",
            description: m.attribution,
            variant: "",
            media: m,
          });
          const c = {
            id: uid(),
            start,
            in: 0,
            duration: 5,
            takes: media.map((a, k) => ({ ...a, name: `Take ${k + 1}` })),
            activeTake: m.id,
            volume: 1,
            mute: false,
            intent: [
              "Morning light falls across the meadow.",
              "A quiet moment beneath the trees.",
              "A change in the forest.",
            ][i],
          };
          n.clips.push(c);
          start += 5;
        });
      });
      notice("Sample footage is ready. Scroll over a clip to switch takes.");
    });
    setBusy("");
  }
  async function generate(event, prepareOptimizer = null) {
    event?.currentTarget?.blur();
    if (event?.detail > 1 || submissionLock.current) return;
    composerAssistant.freeze();
    submissionLock.current = true;
    setSubmitting(true);
    try {
      await act(async () => {
        update((n) => reserveGenerationSlot(n, draft.id, jobs));
        let revision = await flush();
        const optimizerJobId = prepareOptimizer ? await prepareOptimizer() : null;
        revision = await flush();
        const batchId = uid();
        const intents = Array.from({ length: draft.quantity || 1 }, () => ({
          draftId: draft.id,
          requestId: uid(),
          revision,
          simulation,
          mode: videoMode,
          quoteId: quote?.id,
          ...(optimizerJobId ? { optimizerJobId } : {}),
          batchId,
        }));
        const { browserBackup } = await submitGenerationIntents({
          projectId: p.id,
          intents,
          submit: (intent) => api("/projects/" + p.id + "/jobs", intent),
          onAccepted: (j) =>
            setJobs((js) => (js.some((x) => x.id === j.id) ? js : [...js, j])),
        });
        notice(
          !browserBackup
            ? `${videoMode === "demo" ? "Sample generation" : "Generation"} queued · saved on disk. Browser recovery backup is unavailable.`
            : videoMode === "demo"
              ? "Sample generation queued"
              : "Generation queued · tracked locally after closing the browser",
        );
      });
    } finally {
      submissionLock.current = false;
      setSubmitting(false);
    }
  }
  async function exportEpisode() {
    const missing = p.clips.filter((c) => !c.activeTake);
    if (missing.length) {
      notice(
        `Fill the ${missing.length} unfilled timeline slot${missing.length === 1 ? "" : "s"} before exporting, or remove them in Structure.`,
      );
      return;
    }
    await act(async () => {
      const revision = await flush();
      const j = await api("/projects/" + p.id + "/export", { revision });
      setJobs((js) => [...js, j]);
      setModal("jobs");
    });
  }
  function selectTake(c, take) {
    setComposerCollapsed(false);
    setSelectedGroupId(null);
    try {
      update((n) => {
        const clip = n.clips.find((x) => x.id === c.id);
        activateSlotTake(n, clip, take, jobs);
        openClipPrompt(n, clip.id, jobs);
      });
    } catch (error) {
      notice(error.message);
      return;
    }
    setSelectedGroupId(null);
    setSelected(c.id);
    setTime(c.start);
    setView("compose");
    setInspect(null);
  }
  function switchTake(c, dir) {
    if (c.takes.length < 2) return;
    const idx = c.takes.findIndex((t) => t.id === c.activeTake);
    const next = Math.max(0, Math.min(c.takes.length - 1, idx + dir));
    if (next !== idx) selectTake(c, c.takes[next]);
  }
  function focusDraft(d) {
    setComposerCollapsed(false);
    setSelectedGroupId(null);
    const { clip, start, seek } = draftTimelinePosition(p, d, jobs);
    update((n) => {
      n.activeDraftId = d.id;
      const saved = n.drafts.find((x) => x.id === d.id);
      if (saved) {
        saved.closed = false;
        saved.start = start;
        if (clip) {
          saved.targetId = clip.id;
          saved.generationSlotId = clip.id;
        }
      }
    }, false);
    setSelected(clip?.id || null);
    setTime(seek);
    setInspect(null);
    setPlaying(false);
    const scroller = timeline.current;
    if (scroller) {
      const left = start * zoom,
        right = (start + (clip?.duration || 0)) * zoom;
      if (
        left < scroller.scrollLeft ||
        right > scroller.scrollLeft + scroller.clientWidth
      )
        scroller.scrollTo({ left: Math.max(0, left - 28), behavior: "smooth" });
    }
  }

  function editRange(action) {
    try {
      const copied = copyTimelineRange(p, repairRange);
      if (!copied) return;
      if (action !== "remove") setClipboard(copied);
      if (action !== "copy") {
        update((n) => removeTimelineRange(n, repairRange, uid));
        setTime(repairRange.from);
        setRepairRange(null);
        setSelected(null);
      }
      notice(
        action === "copy"
          ? "Range copied · paste at the playhead"
          : "Range removed · Undo or the asset pool restores footage",
      );
    } catch (error) {
      notice(error.message);
    }
  }
  function selectRulerRange(range) {
    setPlaying(false);
    setFrameMenu(false);
    const clip =
      range &&
      p.clips.find(
        (c) =>
          range.from >= c.start - 1e-6 &&
          range.to <= c.start + c.duration + 1e-6,
      );
    setRepairRange(range ? { ...range, clipId: clip?.id } : null);
    if (range) {
      setTime(range.from);
      setSelected(clip?.id || null);
    }
  }
  function useFrameInNewPrompt(key) {
    const source = timelineFrameSources(p).find(
      (s) => s.clip.id === activeClip?.id,
    );
    if (!source) return;
    const frame = captureTimelineFrame(
      source,
      source.min + time - source.clip.start,
    );
    const d = createDefaultDraft(source.clip.start + source.clip.duration);
    d.name = `${key === "start" ? "Start" : "End"} frame · ${tc(time)}`;
    d.episodeId = p.episodeId;
    d.closed = false;
    d.frameOverrides = {
      start: { mode: "none" },
      end: { mode: "none" },
      [key]: { mode: "manual", frame },
    };
    d.automation = {
      ...d.automation,
      frames: true,
      [key === "start" ? "startFrame" : "endFrame"]: true,
    };
    update((n) => {
      n.drafts.push(d);
      n.activeDraftId = d.id;
    });
    setComposerCollapsed(false);
    setSelectedGroupId(null);
    setSelected(null);
    setView("compose");
    setFrameMenu(false);
    setRepairRange(null);
    notice(
      `${key === "start" ? "Start" : "End"} frame attached to a new prompt`,
    );
  }
  function repairSelection() {
    if (!repairRange) return;
    try {
      const clip = p.clips.find((c) => c.id === repairRange.clipId),
        take = takeOf(clip);
      const original =
        jobs.find((j) => j.id === take?.jobId)?.snapshot.draft ||
        p.drafts.find((d) => d.targetId === clip.id);
      let created;
      update((n) => {
        created = createRepairDraft(
          n,
          clip.id,
          repairRange.from,
          repairRange.to,
          original,
          makeDraft,
          uid,
        );
      });
      setSelected(created.targetId);
      setTime(created.start);
      setRepairRange(null);
      setRangeMode(false);
      setView("compose");
      notice(
        "Repair draft created. Original footage remains as a take; choose a model supporting the selected duration.",
      );
    } catch (e) {
      notice(e.message);
    }
  }
  function panTimeline(e) {
    const middle = e.button === 1;
    if (
      !middle &&
      (e.button !== 0 ||
        e.target.closest(
          "button,input,select,textarea,.clip,.sound-clip,.ruler,.playhead,.timeline-cut-menu,[data-direction-id],.direction-band,.direction-inspector,.element-time-block,.element-trim",
        ))
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const el = timeline.current,
      start = e.clientX,
      left = el.scrollLeft;
    el.classList.add("timeline-panning");
    const move = (ev) => {
      el.scrollLeft = left + start - ev.clientX;
    };
    let panned = false;
    const track = (ev) => {
      if (Math.abs(ev.clientX - start) > 4) panned = true;
    };
    window.addEventListener("pointermove", track);
    const done = (ev) => {
      window.removeEventListener("pointermove", track);
      if (!panned && !middle && ev.type !== "pointercancel") {
        setSelected(null);
        setSelectedGroupId(null);
      }
      el.classList.remove("timeline-panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  }
  function pointerGroup(e, node) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const members = groupSlots(p, node.id);
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      modifiedSelection(
        e,
        members.map((c) => c.id),
      );
      return;
    }
    if (!members.length) {
      selectStructureNode(node);
      return;
    }
    setPlaying(false);
    const start = e.clientX,
      at = members[0].start;
    let moved = false;
    const label = e.currentTarget;
    const foldedElements = () =>
      [
        ...(timeline.current?.querySelectorAll("[data-fold-members]") || []),
      ].filter((el) =>
        JSON.parse(el.dataset.foldMembers).some((id) =>
          members.some((c) => c.id === id),
        ),
      );
    const move = (ev) => {
      if (Math.abs(ev.clientX - start) > 4) moved = true;
      if (!moved) return;
      const delta = Math.max(-at * zoom, ev.clientX - start);
      label.style.transform = `translateX(${delta}px)`;
      for (const el of foldedElements()) {
        el.style.transform = `translateX(${delta}px)`;
        el.classList.add("slot-dragging");
      }
      for (const c of members) {
        const el = timeline.current?.querySelector(`[data-clip="${c.id}"]`);
        if (el) {
          el.style.transform = `translateX(${delta}px)`;
          el.classList.add("slot-dragging");
        }
      }
    };
    const clear = () => {
      label.style.transform = "";
      for (const el of foldedElements()) {
        el.style.transform = "";
        el.classList.remove("slot-dragging");
      }
      for (const c of members) {
        const el = timeline.current?.querySelector(`[data-clip="${c.id}"]`);
        if (el) {
          el.style.transform = "";
          el.classList.remove("slot-dragging");
        }
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", clear);
    };
    const up = (ev) => {
      clear();
      if (!moved) {
        selectStructureNode(node);
        return;
      }
      let nextStart = at;
      update((n) => {
        moveTimelineGroup(
          n,
          node.id,
          Math.max(0, at + (ev.clientX - start) / zoom),
        );
        nextStart = editedStoryTiming(n).get(node.id)?.start ?? at;
      });
      setSelectedGroupId(node.id);
      setSelected(null);
      setSelectionIds(members.map((c) => c.id));
      setComposerCollapsed(false);
      setTime(nextStart);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", clear);
  }
  function insertAtCut(type, at) {
    let created, slot;
    update((n) => {
      created = insertPlannedNode(n, type, at);
      slot = n.clips.find((c) => c.structureNodeId === created.id);
      if (type === "clip") {
        const defaults = createDefaultDraft(slot.start);
        editPlannedSlot(
          n,
          slot.id,
          { duration: defaults.settings.duration },
          models,
        );
        const d = beatDraft(n, created, defaults);
        n.drafts.push(d);
        n.activeDraftId = d.id;
      }
    });
    setSelectedGroupId(type === "group" ? created.id : null);
    setSelected(slot.id);
    if (type === "clip") selectInsertedClip(slot);
    setTime(slot.start);
    setPlaying(false);
    setComposerCollapsed(false);
    setView("compose");
  }
  function pointerSelection(e) {
    e.preventDefault();
    e.stopPropagation();
    setPlaying(false);
    const ids = [...selection],
      members = p.clips
        .filter((c) => selection.has(c.id))
        .sort((a, b) => a.start - b.start);
    const start = e.clientX,
      at = members[0].start;
    let moved = false;
    const elements = () =>
      [
        ...(timeline.current?.querySelectorAll(
          "[data-clip], [data-fold-members]",
        ) || []),
      ].filter(
        (el) =>
          ids.includes(el.dataset.clip) ||
          JSON.parse(el.dataset.foldMembers || "[]").some((id) =>
            ids.includes(id),
          ),
      );
    const move = (ev) => {
      if (Math.abs(ev.clientX - start) > 4) moved = true;
      if (!moved) return;
      for (const el of elements()) {
        el.style.transform = `translateX(${Math.max(-at * zoom, ev.clientX - start)}px)`;
        el.classList.add("slot-dragging");
      }
    };
    const clear = () => {
      for (const el of elements()) {
        el.style.transform = "";
        el.classList.remove("slot-dragging");
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", clear);
    };
    const up = (ev) => {
      clear();
      if (!moved) return;
      let next = at;
      update((n) => {
        moveTimelineSelection(
          n,
          ids,
          Math.max(0, at + (ev.clientX - start) / zoom),
        );
        next = Math.min(
          ...n.clips.filter((c) => ids.includes(c.id)).map((c) => c.start),
        );
      });
      setTime(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", clear);
  }
  function pointerClip(e, c, edge) {
    if (!edge && focusTimeline(e,"video",c.id)) return;
    if (e.button !== 0) return;
    elementEditor.close();
    setAudioInspector(null);
    // preventDefault below suppresses native focus; transfer it out of writing fields.
    e.currentTarget.closest("[data-clip]")?.focus({ preventScroll: true });
    if (!edge && (e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      modifiedSelection(e, [c.id]);
      return;
    }
    if (!edge && selection.size > 1 && selection.has(c.id) && !rangeMode) {
      pointerSelection(e);
      return;
    }
    setComposerCollapsed(false);
    const node = plannedNode(p, c);
    const planned = editablePlannedSlot(c);
    if (node && !c.activeTake && !planned && !edge) {
      e.preventDefault();
      e.stopPropagation();
      selectStructureNode(node);
      setTime(c.start);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (rangeMode && !edge && c.activeTake) {
      const rect = e.currentTarget.getBoundingClientRect(),
        point = (x) =>
          Math.max(
            c.start,
            Math.min(
              c.start + c.duration,
              Math.round((c.start + (x - rect.left) / zoom) * 24) / 24,
            ),
          );
      const anchor = point(e.clientX);
      setSelectedGroupId(null);
      setSelected(c.id);
      setTime(anchor);
      const move = (ev) =>
        setRepairRange({
          clipId: c.id,
          from: Math.min(anchor, point(ev.clientX)),
          to: Math.max(anchor, point(ev.clientX)),
        });
      const up = (ev) => {
        move(ev);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    const startX = e.clientX;
    if (edge) {
      setSelected(c.id);
      setRepairRange(null);
      setFrameMenu(false);
    }
    const base = structuredClone(c);
    setPlaying(false);
    let trimAnimation = null;
    let trimDelta = 0;
    const clearPreview = () => {
      cancelAnimationFrame(trimAnimation);
      setTrimPreview(null);
      for (const el of timeline.current?.querySelectorAll("[data-clip]") ||
        []) {
        el.style.transform = "";
        el.style.removeProperty("--resize-preview");
        el.classList.remove("slot-dragging");
      }
    };
    let moved = false;
    const move = (ev) => {
      const delta = (ev.clientX - startX) / zoom;
      if (Math.abs(ev.clientX - startX) > 4) moved = true;
      let value = base.start + delta;
      if (snap) {
        const points = [
          0,
          ...p.clips
            .filter((x) => x.id !== c.id)
            .flatMap((x) => [x.start, x.start + x.duration]),
          time,
        ];
        for (const point of points)
          if (Math.abs(value - point) < 8 / zoom) {
            value = point;
            break;
          }
      }
      const el = timeline.current?.querySelector(`[data-clip="${c.id}"]`);
      if (el && moved && !edge) el.classList.add("slot-dragging");
      if (edge && moved) {
        trimDelta = delta;
        if (trimAnimation === null)
          trimAnimation = requestAnimationFrame(() => {
            trimAnimation = null;
            const preview = {
              ...p,
              ...structuredClone({
                clips: p.clips,
                drafts: p.drafts,
                storyPlans: p.storyPlans,
              }),
            };
            trimTimelineClip(
              preview,
              c.id,
              edge,
              trimDelta,
              p.settings.export.fps,
              models,
            );
            setTrimPreview(preview);
          });
      }
      if (el && !edge)
        el.style.transform = `translateX(${(Math.max(0, value) - base.start) * zoom}px)`;
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      clearPreview();
      if (!moved) {
        if (node && !c.activeTake) {
          selectStructureNode(node);
          return;
        }
        setSelectedGroupId(null);
        setSelected(c.id);
        const left =
          timeline.current
            ?.querySelector(`[data-clip="${c.id}"]`)
            ?.getBoundingClientRect().left ?? e.clientX;
        const fps = p.settings.export.fps;
        setTime(
          Math.min(
            c.start + c.duration - 1 / fps,
            c.start +
              Math.max(0, Math.round(((e.clientX - left) / zoom) * fps) / fps),
          ),
        );
        setRepairRange(null);
        update((n) => openClipPrompt(n, c.id, jobs), false);
        setView("compose");
        setInspect(null);
        return;
      }
      const delta = (ev.clientX - startX) / zoom;
      let selectedStart = c.start;
      update((n) => {
        const x = n.clips.find((x) => x.id === c.id);
        if (edge)
          trimTimelineClip(n, c.id, edge, delta, p.settings.export.fps, models);
        else {
          let start = Math.max(0, base.start + delta);
          if (snap) {
            for (const point of [
              0,
              ...n.clips
                .filter((y) => y.id !== x.id)
                .flatMap((y) => [y.start, y.start + y.duration]),
              time,
            ])
              if (Math.abs(start - point) < 8 / zoom) {
                start = point;
                break;
              }
          }
          if (planned) editPlannedSlot(n, x.id, { dropTime: start }, models);
          else reorderStorySlot(n, x.id, start);
        }
        if (node && isStructureClip(node) && !openClipPrompt(n, x.id, jobs)) {
          const created = beatDraft(
            n,
            plannedNode(n, x),
            createDefaultDraft(x.start),
          );
          n.drafts.push(created);
          n.activeDraftId = created.id;
        } else if (!node) openClipPrompt(n, x.id, jobs);
        selectedStart = x.start;
      });
      setSelectedGroupId(node && !isStructureClip(node) ? node.id : null);
      setSelected(c.id);
      setTime(selectedStart);
      setInspect(null);
      setView("compose");
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      clearPreview();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }
  function resize(e, kind) {
    const start = e.clientX,
      y = e.clientY,
      base = kind === "left" ? leftWidth : timelineHeight;
    const move = (ev) =>
      kind === "left"
        ? setLeftWidth(Math.max(300, Math.min(650, base + ev.clientX - start)))
        : setTimelineHeight(
            Math.max(310, Math.min(500, base + y - ev.clientY)),
          );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  const videoDefaults = {
    ...globalVideoDefaults,
    ...Object.fromEntries(
      Object.entries(p?.settings?.videoDefaults || {}).map(([mode, value]) => [
        mode,
        { ...globalVideoDefaults[mode], ...value },
      ]),
    ),
  };
  function revise(direction) {
    elementEditor.finishEdit();
    const at = direction === "undo" ? undo() : redo();
    if (at)
      setRevisionFlash({
        id: Date.now(),
        text: `${direction === "undo" ? "Restored" : "Reapplied"} · ${new Date(at).toLocaleString()}`,
      });
  }
  const plannedTarget = p && draft ? generationTarget(p, draft, jobs) : null;
  const plannedLength = editablePlannedSlot(plannedTarget)
    ? plannedTarget.duration
    : null;
  const generationPlacement = useMemo(
    () => (p && draft ? draftTimelinePosition(p, draft, jobs) : null),
    [p, draft, jobs],
  );
  const model = models.find((m) => m.id === draft?.settings.model);
  const composerAssistant = useComposerAssistant({project:p,draft,sceneId:assistantScene,model,
    visible:!home && workspace === "editor" && !composerCollapsed && !audioFocus && timelineMode !== "direction" && !selectedGroup && !modal && !submitting && view === "compose",flush,update});
  const prepared = useMemo(
    () => (p && draft ? compile(p, draft, model) : null),
    [p, draft, model],
  );
  const validation =
    p && draft && prepared
      ? validatePreparation(p, draft, prepared, model)
      : { errors: [], warnings: [] };
  const effective = p && draft ? effectiveAutomation(p, draft) : {};
  function refreshVideoModels() {
    setQuote(null);
    api("/video-defaults")
      .then(setVideoDefaults)
      .catch((e) => notice(e.message));
    api("/models")
      .then((r) => {
        setModels(r.models);
        setVideoMode(r.mode);
        setCatalogTick((x) => x + 1);
      })
      .catch((e) => notice(e.message));
  }
  const compatibleModels = compatibleVideoModels(models, prepared);
  const compatibleIds = compatibleModels.map((m) => m.id).join("|");
  useEffect(() => {
    if (!draft || home || !models.length) return;
    const changingProvider = !models.some((m) => m.id === draft.settings.model);
    const requested = changingProvider
      ? draft.videoSettingsByMode?.[videoMode] || {
          ...draft.settings,
          ...videoDefaults[videoMode],
          duration: draft.settings.duration,
        }
      : draft.settings;
    const nextModel = preferredVideoModel(
      compatibleModels,
      requested.model,
      videoDefaults[videoMode]?.model,
    );
    if (!nextModel) return;
    const next = fitVideoSettings(requested, nextModel);
    if (JSON.stringify(next) === JSON.stringify(draft.settings)) return;
    const changes = Object.keys(next)
      .filter((k) => next[k] !== draft.settings[k])
      .map((k) => `${k}: ${draft.settings[k] ?? "Auto"} → ${next[k]}`);
    editDraft((d) => {
      if (changingProvider) {
        d.videoSettingsByMode ??= {};
        d.videoSettingsByMode[
          d.settings.model.startsWith("demo-") ? "demo" : "venice"
        ] = { ...d.settings };
      }
      d.settings = next;
      d.settingsNotice = changes.join(" · ");
    }, false);
    if (!changingProvider) notice(changes.join(" · "));
  }, [
    draft?.id,
    home,
    compatibleIds,
    JSON.stringify(draft?.settings),
    videoMode,
    JSON.stringify(videoDefaults),
  ]);
  function changeModel(modelId) {
    const m = compatibleModels.find((x) => x.id === modelId);
    if (!m) return;
    editDraft((d) => {
      const next = fitVideoSettings(d.settings, m);
      d.settingsNotice = Object.keys(next)
        .filter((k) => next[k] !== d.settings[k])
        .map((k) => `${k}: ${d.settings[k] ?? "Auto"} → ${next[k]}`)
        .join(" · ");
      d.settings = next;
    });
  }
  async function saveVideoDefaults() {
    try {
      const saved = await api("/video-defaults", draft.settings, "PUT");
      setVideoDefaults(saved);
      notice("Favorite model and settings saved for new drafts.");
    } catch (e) {
      notice(e.message);
    }
  }
  useEffect(() => { setStructureCompose(false); }, [p?.id, p?.episodeId]);
  const renderComposer = (close) => (<CreativeComposer
                    assistant={composerAssistant}
                    key={draft.id}
                    project={p}
                    draft={draft}
                    models={models}
                    model={model}
                    prepared={prepared}
                    validation={validation}
                    effective={effective}
                    editDraft={editDraft}
                    update={update}
                    flush={flush}
                    view={view}
                    setView={setView}
                    time={time}
                    plannedLength={plannedLength}
                    onDuration={(duration) =>
                      update((n) => {
                        const d = n.drafts.find((d) => d.id === draft.id);
                        d.settings.duration = duration;
                        const target = generationTarget(n, d, jobs);
                        if (editablePlannedSlot(target))
                          editPlannedSlot(n, target.id, { duration }, models);
                      })
                    }
                    onNode={selectStructureNode}
                    openAssets={() => setModal("assets")}
                    compatibleModels={compatibleModels}
                    changeModel={changeModel}
                    saveVideoDefaults={saveVideoDefaults}
                    videoDefaults={videoDefaults}
                    videoMode={videoMode}
                    quote={quote}
                    setQuote={setQuote}
                    catalogTick={catalogTick}
                    submitting={submitting}
                    visible={(workspace === "story" ? structureCompose : !composerCollapsed) && !modal}
                    generate={generate}
                    holdToGenerate={holdToGenerate}
                    modelFavorites={modelFavorites}
                    onFavoriteModel={(id) =>
                      setModelFavorites((previous) => {
                        const next = previous.includes(id)
                          ? previous.filter((x) => x !== id)
                          : [...previous, id];
                        setBrowserPreference(
                          "splece-model-favorites",
                          JSON.stringify(next),
                        );
                        return next;
                      })
                    }
                    onSelect={focusDraft}
                    onVariant={() => addDraft(draft)}
                    onRename={(name) => editDraft((d) => (d.name = name))}
                    onClose={close}

                  />);
  if (firstRun === null) return <main className="setup-shell"><p role="status">Opening your studio…</p></main>;
  if (firstRun) return <main className="setup-shell"><Connections onboarding onChange={refreshVideoModels} onDone={({create}) => { setFirstRun(false); setHome(true); if(create) setModal("create"); }}/></main>;
  if (!p || home)
    return (
      <HomeScreen
        projects={projects}
        mode={videoMode}
        onConnectionsChange={refreshVideoModels}
        onGlobalSettings={() => setModal("global-settings")}
        onBeforeRemove={flush}
        onBeforeUpdate={flush}
        onRemoved={async (id) => {
          store.forget(id);
          setProjects(await api("/projects"));
          if (p?.id === id) setJobs([]);
        }}
        currentProject={p}
        onCreate={() => setModal("create")}
        onResume={() => setHome(false)}
        onOpen={async (id) => {
          await load(id);
          setJobs([]);
          setHome(false);
        }}
        onOpenFolder={async (folder) => {
          await flush();
          const opened = await api("/projects/open", { folder });
          await load(opened.project.id);
          setProjects(await api("/projects"));
          setJobs([]);
          setHome(false);
        }}
      >
        {modal === "create" && (
          <CreateProject
            onClose={() => setModal(null)}
            onCreate={async (body) => {
              await flush();
              const r = await api("/projects", body);
              await load(r.project.id);
              setProjects(await api("/projects"));
              setHome(false);
              setWorkspace(
                body.templateId && body.includeSample ? "editor" : "story",
              );
              setModal(null);
            }}
          />
        )}
        {modal === "global-settings" && (
          <Modal title="Global settings" wide onClose={() => setModal(null)}>
            <ProjectSettings
              beforeUpdate={flush}
              globalOnly
              project={
                p || { id: "global", settings: {}, assets: [], drafts: [] }
              }
              update={update}
              models={models}
              videoMode={videoMode}
              refreshVideoModels={refreshVideoModels}
              holdToGenerate={holdToGenerate}
              setHoldToGenerate={setHoldToGenerate}
              simulation={simulation}
              setSimulation={setSimulation}
            />
          </Modal>
        )}
        <Notification message={toast} onDismiss={() => setToast("")} />
      </HomeScreen>
    );
  return (
    <div
      className={
        "studio " +
        (workspace === "story" ? "story-shell" : "editor-shell") +
        (poolExpanded && workspace === "editor" ? " assets-expanded" : "")
      }
      style={{
        "--left": leftWidth + "px",
        "--timeline": timelineHeight + "px",
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          importFiles(e.dataTransfer.files);
        }
      }}
    >
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="video/*,image/*,audio/*"
        onChange={(e) => {
          const intent = importIntent.current;
          importIntent.current = { kind: "footage" };
          importFiles(e.target.files, intent);
          e.target.value = "";
          e.target.multiple = true;
          e.target.accept = "video/*,image/*,audio/*";
        }}
      />
      <WorkspaceHeader
        assistantControl={<AssistantHeader assistant={composerAssistant} />}
        project={p}
        billing={billing}
        onUndo={() => revise("undo")}
        onRedo={() => revise("redo")}
        canUndo={store.canUndo}
        canRedo={store.canRedo}
        revisionFlash={revisionFlash}
        workspace={workspace}
        status={status}
        jobCount={running.length + sound.runs.filter(r => ["queued", "processing"].includes(r.state)).length + sound.lip.jobs.filter(lipSyncActive).length}
        onWorkspace={(next) => {
          setPlaying(false);
          setWorkspace(next);
        }}
        onHome={() =>
          act(async () => {
            await flush();
            setProjects(await api("/projects"));
            setPlaying(false);
            setModal(null);
            setHome(true);
          })
        }
        onAssets={() => setModal("assets")}
        onTool={setModal}
      />
      {workspace === "story" ? (
        <StoryPlanner key={`${p.id}:${p.episodeId}`}
          models={models}
          jobs={jobs}
          onJobs={() => setModal("jobs")}
          composer={structureCompose ? renderComposer(() => setStructureCompose(false)) : null}
          onCompose={(d) => { focusDraft(d); setPlaying(false); setView("compose"); setStructureCompose(true); }}
          workflow={structureWorkflow}
          assistant={{...composerAssistant,flush}}
          onAssets={(assetId) => setModal({ type: "story-assets", assetId })}
          focusedBeatId={selectedGroupId || draft.storyBeatId}
          defaultSettings={videoDefaults[videoMode] || draft.settings}
          project={p}
          update={update}
          flush={flush}
          time={time}
          onOpen={(d) => {
            setWorkspace("editor");
            focusDraft(d);
            setPlaying(false);
            setView("compose");
          }}
        />
      ) : (
        <>
          <main
            className={`workspace editor-without-sidebar editor-canvas ${composerCollapsed ? "composer-collapsed" : ""} ${audioFocus ? "audio-focus" : ""}`}
            inert={poolExpanded}
            aria-hidden={poolExpanded}
          >
            <div
              className="composer-shell"
              onFocusCapture={event => { const scene = event.target.closest?.("[data-scene-id]"); if (scene) setAssistantScene(scene.dataset.sceneId); }}
              style={{
                "--pointer-x": `${Math.max(24, Math.min(leftWidth - 24, ((selectedClip || generationTarget(p, draft, jobs))?.start || 0) * zoom - viewport.left + 48))}px`,
              }}
              aria-hidden={composerCollapsed}
              inert={composerCollapsed ? true : undefined}
            >
              <aside
                className="prompt-pane"
                data-group={!!selectedGroup}
                style={{
                  "--story-kind-color":
                    structurePlan &&
                    (selectedGroup ||
                      structurePlan.beats.find(
                        (b) => b.id === draft.storyBeatId,
                      ))
                      ? structureColor(
                          structurePlan,
                          selectedGroup ||
                            structurePlan.beats.find(
                              (b) => b.id === draft.storyBeatId,
                            ),
                        )
                      : "#80aff5",
                }}
              >
                {timelineMode === "direction" ? (
                  <div className="direction-composer-host" ref={setDirectionComposerHost} />
                ) : audioFocus ? (
                  <SoundtrackPanel
                    key={p.id + p.episodeId}
                    project={p}
                    sound={sound}
                    selectedIds={[...selection]}
                    onPreviewPlay={() => setPlaying(false)}
                    timelinePlaying={playing}
                    onInspect={id => { elementEditor.close(); setAudioInspector(id); setSelected(id); setPlaying(false); setModal(null); }}
                    onSelectClip={(id) => {
                      const clip = p.clips.find(c => c.id === id);
                      if (!clip) return;
                      setSelected(id); setTime(clip.start); setPlaying(false);
                      update(n => openClipPrompt(n, id, jobs), false);
                    }}
                    range={repairRange}
                    onRange={selectRulerRange}
                    onSeek={setTime}
                    selectedAudio={selectedAudio}
                    update={update}
                    testMode={videoMode === "demo"}
                    embedded
                    onClose={closeSoundtrack}
                    onMixer={() => setModal("audio")}
                  />
                ) : selectedGroup ? (
                  <GroupComposer
                    project={p}
                    node={selectedGroup}
                    collapsed={collapsedGroups.includes(selectedGroup.id)}
                    onToggleCollapse={() => toggleGroupFold(selectedGroup)}
                    update={update}
                    onSelect={selectStructureNode}
                    onStructure={() => setWorkspace("story")}
                  />
                ) : selection.size > 1 ? (
                  <div className="group-composer selection-composer">
                    <div className="group-composer-heading">
                      <h2>
                        <Layers size={19} />
                        {selection.size} clips selected
                      </h2>
                    </div>
                    <div className="group-composer-body">
                      <p className="group-hint">
                        Drag a selected clip to move the selection together.
                        Command-click toggles clips; Shift-click selects a
                        range.
                      </p>
                      <div className="group-children">
                        {[...p.clips]
                          .filter((c) => selection.has(c.id))
                          .sort((a, b) => a.start - b.start)
                          .map((c) => (
                            <button
                              key={c.id}
                              onClick={() => {
                                const node = plannedNode(p, c);
                                if (!c.activeTake && node)
                                  selectStructureNode(node);
                                else {
                                  setSelectedGroupId(null);
                                  setSelected(c.id);
                                  setTime(c.start);
                                  update(
                                    (n) => openClipPrompt(n, c.id, jobs),
                                    false,
                                  );
                                  setView("compose");
                                }
                              }}
                            >
                              <Layers size={15} />
                              <span>
                                <b>{plannedNode(p, c)?.title || "Clip"}</b>
                                <small>
                                  {tc(c.start)}–{tc(c.start + c.duration)}
                                </small>
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          ))}
                      </div>
                      <button
                        className="group-back"
                        onClick={() => setSelected(null)}
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>
                ) : (
                  renderComposer(() => {setView("compose");setComposerCollapsed(true);})
                )}
              </aside>
              <span className="composer-pointer" aria-hidden="true" />
            </div>
            <div
              className="divider vertical"
              onPointerDown={(e) => resize(e, "left")}
            />
            <AudioPlayback
              clips={auditionAudio(p.audioClips,timelineFocus.solo)}
              time={time}
              seekId={seekId}
              onError={notice}
              onWaiting={setAudioWaiting}
              readTime={() =>
                activeClip && video.current?.readyState >= 2
                  ? activeClip.start + video.current.currentTime - activeClip.in
                  : time
              }
              playing={
                playing && previewStatus.state === "ready" && !poolExpanded
              }
            />
            {composerCollapsed && !elementEditor.target && !audioInspector && timelineMode !== "direction" && (
              <button
                className="composer-edge-reveal"
                aria-label="Open prompt composer"
                title="Open selected prompt"
                onClick={() => setComposerCollapsed(false)}
              >
                <ChevronRight size={18} />
              </button>
            )}
            <section className="viewer">
              {comparing ? <TakeComparison key={p.id} project={p} selectedClipId={selectedClip?.id || activeClip?.id} onClose={()=>setComparing(false)} onPlay={()=>setPlaying(false)} timelinePlaying={playing}/> : <>

              <div className="viewer-header">
                {timelineFocus.armed && <button onClick={()=>setTimelineFocus({armed:null,solo:null})} title="Restore normal preview">{timelineFocus.solo ? "Focus only · Exit" : "Click again to focus · Cancel"}</button>}
                <nav
                  className="preview-aspects"
                  aria-label="Preview aspect ratio"
                >
                  {[
                    ["fit", "Fit"],
                    ["16/9", "16:9"],
                    ["9/16", "9:16"],
                    ["1/1", "1:1"],
                    ["4/5", "4:5"],
                  ].map(([ratio, label]) => (
                    <button
                      key={ratio}
                      aria-label={`Preview ${label}`}
                      aria-pressed={previewRatio === ratio}
                      onClick={() => {setPreviewRatio(ratio);if(ratio!=="fit") update(n=>{n.settings.export.aspect=label;});}}
                    >
                      <i
                        style={{
                          aspectRatio: ratio === "fit" ? "16/9" : ratio,
                        }}
                      />
                      {label}
                    </button>
                  ))}
                </nav>
                <Icon icon={SlidersHorizontal} label="Frame selected footage" onClick={()=>elementEditor.inspectMedia(selectedClip || activeClip)} />
                <Icon icon={Columns2} label="Compare clips & takes" onClick={()=>{setPlaying(false);setComparing(true);}} />
                <Icon
                  icon={Maximize2}
                  label="Fullscreen preview"
                  onClick={fullscreen.open}
                />
              </div>
              <div
                ref={fullscreen.ref}
                tabIndex={-1}
                className={`screen-area${fullscreen.expanded ? " preview-expanded" : ""}`}
                data-preview-ratio={previewRatio}
                style={{ "--preview-ratio": previewRatio }}
              >
                <div className={`composition-stage ${elementEditor.items.some(e=>time>=e.start&&time<e.start+e.duration)?"has-elements":""}`} style={{"--composition-ratio":compositionRatio}}
                  onDoubleClick={(e) => {
                    if (activeTake && !e.target.closest('button,input,textarea,[data-element-id],.element-hit,.element-selection')) {
                      e.preventDefault(); setSelected(activeClip.id); elementEditor.inspectMedia(activeClip);
                    }
                  }}>
                  <div className="preview-frame" hidden={!activeTake}>
                    <PreviewDeck
                      current={activeTake ? { clip: activeClip, take: activeTake } : null}
                      next={
                        nextClip && previewMedia.next
                          ? { clip: nextClip, take: previewMedia.next }
                          : null
                      }
                      transform={mediaPose}
                      videoRef={video}
                      playing={playing}
                      enabled={previewEnabled}
                      onClick={() => setPlaying((v) => !v)}
                    />
                    {activeTake && (optimizingPreview ||
                      !activeTake.url ||
                      previewStatus.state !== "ready") && (
                      <div
                        className={
                          "preview-feedback " +
                          (previewStatus.state === "error" ? "error" : "")
                        }
                        role="status"
                      >
                        {previewStatus.state === "error" &&
                        !optimizingPreview ? (
                          <AlertCircle size={16} />
                        ) : (
                          <LoaderCircle size={16} className="spin" />
                        )}
                        <span>
                          {optimizingPreview || !activeTake.url
                            ? "Preparing smooth preview…"
                            : previewStatus.state === "error"
                              ? previewStatus.message
                              : previewStatus.state === "seeking"
                                ? "Seeking…"
                                : "Loading video…"}
                        </span>
                      </div>
                    )}
                  </div>
                {!activeTake && (
                  <div className="empty-preview">
                    <Clapperboard size={42} />
                    <h2>
                      {activeClip
                        ? previewJob
                          ? "Generation status"
                          : plannedNode(p, activeClip)?.title ||
                            "No take generated yet."
                        : p.audioClips.length
                          ? "Audio-only section"
                          : "Every story begins with a frame."}
                    </h2>
                    <p>
                      {activeClip
                        ? previewJob
                          ? "Your draft and generation record are saved locally."
                          : "This time is reserved. Open the slot to develop it whenever you’re ready."
                        : p.audioClips.length
                          ? "Your audio continues here. Add picture above it, or keep this section black in the export."
                          : "Bring in footage, or create your first scene."}
                    </p>
                    {activeClip &&
                      !previewJob &&
                      plannedNode(p, activeClip) && (
                        <button
                          className="plan-open"
                          onClick={() =>
                            selectStructureNode(plannedNode(p, activeClip))
                          }
                        >
                          <Sparkles size={15} />{" "}
                          {isStructureClip(plannedNode(p, activeClip))
                            ? "Compose this clip"
                            : "Develop this group"}
                        </button>
                      )}
                    {activeClip && previewJob && (
                      <JobProgress job={previewJob} />
                    )}
                    {!p.clips.length && (
                      <div>
                        <button onClick={() => fileInput.current.click()}>
                          <Upload size={15} /> Import footage
                        </button>
                        <button onClick={demo} disabled={!!busy}>
                          <Play size={15} /> Add sample footage
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <ElementsPreview editor={elementEditor} ratio={compositionRatio} soloId={timelineFocus.solo?.kind==="element" ? timelineFocus.solo.id : null}/>
                </div>
                {fullscreen.expanded && <div className="preview-fullscreen-controls">
                  <button aria-label={playing ? "Pause fullscreen preview" : "Play fullscreen preview"} onClick={() => {
                    if (!playing && time >= total) setTime(0);
                    setPlaying(v => !v);
                  }}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? "Pause" : "Play"}</button>
                  <span>{tc(time)} / {tc(total)}</span>
                  <button aria-label="Exit fullscreen preview" onClick={fullscreen.close}><X size={17}/> Exit fullscreen</button>
                </div>}
                {inspect && selectedClip && (
                  <div className="take-popover">
                    <header>
                      <span>
                        TAKE{" "}
                        {selectedClip.takes.findIndex(
                          (t) => t.id === selectedClip.activeTake,
                        ) + 1}{" "}
                        / {selectedClip.takes.length}
                      </span>
                      <Icon
                        icon={X}
                        label="Close take details"
                        onClick={() => setInspect(null)}
                      />
                    </header>
                    <b>
                      {takeOf(selectedClip)?.jobId
                        ? jobs.find((j) => j.id === takeOf(selectedClip).jobId)
                            ?.snapshot.model
                        : "Imported footage"}
                    </b>
                    <span>
                      {tc(selectedClip.start)} —{" "}
                      {tc(selectedClip.start + selectedClip.duration)}
                    </span>
                    <div>
                      <button
                        disabled={!takeOf(selectedClip)?.jobId}
                        onClick={() => {
                          const j = jobs.find(
                            (j) => j.id === takeOf(selectedClip).jobId,
                          );
                          if (j) addDraft(j.snapshot.draft, j.snapshot);
                        }}
                      >
                        <Copy size={14} /> Reuse prompt
                      </button>
                      <Icon
                        icon={Info}
                        label="Full generation details"
                        onClick={() =>
                          setModal({
                            type: "details",
                            job: jobs.find(
                              (j) => j.id === takeOf(selectedClip)?.jobId,
                            ),
                            media: takeOf(selectedClip),
                          })
                        }
                      />
                    </div>
                    <button
                      className="subtle"
                      onClick={() =>
                        editDraft((d) => {
                          d.targetId = selectedClip.id;
                          d.start = selectedClip.start;
                        })
                      }
                    >
                      Generate another take here <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            </>}</section>
            {!comparing && !audioInspector && <ElementsInspector key={`${elementEditor.target?.type}:${elementEditor.target?.id}`} editor={elementEditor}
              onMediaSettings={() => setModal({ type: "clip-settings", clipId: elementEditor.item?.id })}
              onRemoveMedia={removeInspectedMedia}/> }
            {!comparing && audioInspector && <SoundInspector project={p} audioId={audioInspector} update={update}
              onClose={() => setAudioInspector(null)}
              onInspect={id => { setAudioInspector(id); setSelected(id); }}
              onSeek={at => { setTime(at); setPlaying(false); }}
              onRegenerate={clip => { openSoundtrack(); setRepairRange({from:clip.start,to:clip.start+clip.duration}); sound.setFocus({ runId: clip.soundtrack?.runId, role: clip.soundtrack?.role }); }}/>}
          </main>
          <div
            className="divider horizontal"
            onPointerDown={(e) => resize(e, "timeline")}
          />
          <section className={`timeline-panel timeline-view-${timelineMode}`} data-timeline-view={timelineMode}>
            <div className="timeline-mode-rail">
              <TimelineModes value={timelineMode} onChange={changeTimelineMode} soundActive={sound.active} soundDirty={!!soundtrackDirty} />
            </div>
            <div
              className="timeline-edit-rail"
              role="toolbar"
              aria-label="Clip editing tools"
            >
              <Icon
                icon={MousePointer2}
                label="Move clips"
                active={!rangeMode}
                onClick={() => setRangeMode(false)}
              />
              <Icon
                icon={SplitSquareHorizontal}
                label="Split at playhead (S)"
                onClick={split}
              />
              <Icon
                icon={Magnet}
                label="Toggle snapping"
                active={snap}
                onClick={() => setSnap((s) => !s)}
              />
              <span className="tool-separator" />
              <Icon icon={Copy} label={`Copy clip (${shortcutHint("C", false, navigator.platform)})`} onClick={copy} />
              <Icon icon={Scissors} label={`Cut clip (${shortcutHint("X", false, navigator.platform)})`} onClick={cut} />
              <Icon
                icon={MoveHorizontal}
                label="Select range"
                active={rangeMode}
                onClick={() => {
                  setRangeMode(!rangeMode);
                  if (!rangeMode && selectedClip) {
                    const from = Math.max(
                      selectedClip.start,
                      Math.min(
                        time,
                        selectedClip.start + selectedClip.duration - 1 / 24,
                      ),
                    );
                    setRepairRange({
                      clipId: selectedClip.id,
                      from,
                      to: Math.min(
                        selectedClip.start + selectedClip.duration,
                        from + 5,
                      ),
                    });
                  }
                }}
              />
              <button
                className="icon"
                aria-label="Regenerate range"
                title="Regenerate range"
                disabled={
                  !repairRange?.clipId ||
                  repairRange.to - repairRange.from < 1 / 24
                }
                onClick={repairSelection}
              >
                <Sparkles size={16} />
              </button>
              <Icon icon={Clipboard} label={`Paste clip (${shortcutHint("V", false, navigator.platform)})`} onClick={paste} />
              <Icon icon={Trash2} label="Delete clip" onClick={removeClip} />
            </div>
            {detachedGenerations.length > 0 && (
              <div
                className="timeline-generation-jobs"
                aria-label="Active timeline generations"
              >
                {detachedGenerations.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => {
                      setTime(j.snapshot.start || 0);
                      setModal(
                        j.kind === "clip-treatment"
                          ? { type: "clip-settings", clipId: j.clipId }
                          : { type: "details", job: j, media: j.media },
                      );
                    }}
                  >
                    <span>
                      {tc(j.snapshot.start || 0)}–{tc(j.snapshot.end || 0)}
                    </span>
                    <JobProgress job={j} compact inline />
                  </button>
                ))}
              </div>
            )}
            <div className="timeline-body">
              <div
                className="timeline-scroll"
                ref={timeline}
                onPointerDownCapture={panTimeline}
                title="Drag empty space to pan · middle-drag anywhere · ⌘/Ctrl + scroll to zoom"
                onScroll={(e) =>
                  setViewport({
                    left: e.currentTarget.scrollLeft,
                    width: e.currentTarget.clientWidth,
                  })
                }
              >
                <div
                  className="timeline-content"
                  style={{
                    width: Math.max(viewport.width, (timelineEnd + 15) * zoom),
                    "--major-grid": `${10 * zoom}px`,
                  }}
                  onDragOver={(e) => {
                    if (
                      !["studio-pool", "asset", "Files"].some((type) =>
                        e.dataTransfer.types.includes(type),
                      )
                    )
                      return;
                    e.preventDefault();
                    if (timelineMode === "direction") { e.dataTransfer.dropEffect = "none"; return; }
                    e.dataTransfer.dropEffect = "copy";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const at = Math.max(0, (e.clientX - rect.left) / zoom);
                    setDropPreview(timelineDropPreview(p, dragItem || (e.dataTransfer.types.includes("Files") ? {media:{duration:5,kind:"image"}} : null), at));
                    const ordered = [...p.clips].sort(
                      (a, b) => a.start - b.start,
                    );
                    const next = ordered.find(
                      (c) => at < c.start + c.duration / 2,
                    );
                    setDropAt(
                      next?.start ??
                        Math.max(
                          0,
                          ...ordered.map((c) => c.start + c.duration),
                        ),
                    );
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setDropAt(null);
                      setDropPreview(null);
                    }
                  }}
                  onDrop={(e) => {
                    const key = e.dataTransfer.getData("studio-pool");
                    const asset = p.assets.find(
                      (a) => a.id === e.dataTransfer.getData("asset"),
                    );
                    setDropAt(null);
                    setDropPreview(null);
                    setDragItem(null);
                    if (e.dataTransfer.files.length) {
                      e.preventDefault();e.stopPropagation();
                      const rect=e.currentTarget.getBoundingClientRect();
                      importTimelineFiles(e.dataTransfer.files, Math.max(0,(e.clientX-rect.left)/zoom));
                      return;
                    }
                    if (!key && !asset) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (timelineMode === "direction") return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const at = Math.max(0, (e.clientX - rect.left) / zoom);
                    if (key) restoreVideo(key, at);
                    else useDroppedAsset(asset, at);
                  }}
                >
                  <div className="timeline-grid" aria-hidden="true" />
                  {!audioFocus && timelineMode !== "direction" &&
                    !composerCollapsed &&
                    !selectedGroupId &&
                    selection.size <= 1 &&
                    draft && (
                      <div
                        className="composer-generation-range"
                        aria-label={`Generation placement ${tc(generationPlacement.start)} to ${tc(generationPlacement.start + Number(draft.settings.duration || 0))}`}
                        style={{
                          left: generationPlacement.start * zoom,
                          width: Number(draft.settings.duration || 0) * zoom,
                        }}
                      >
                        <span>
                          {tc(generationPlacement.start)} ·{" "}
                          {draft.settings.duration}s
                        </span>
                      </div>
                    )}
                  <TimelineGuides
                    onGroupPointerDown={pointerGroup}
                    collapsedGroups={collapsedGroups}
                    onToggleCollapse={toggleGroupFold}
                    viewport={viewport}
                    project={timelineProject}
                    selectedId={selectedGroupId || draft.storyBeatId}
                    onSelect={selectStructureNode}
                    zoom={zoom}
                    onSeek={(at) => {
                      setTime(Math.min(at, total));
                      setPlaying(false);
                      const clip = p.clips.find(
                        (c) => at >= c.start && at < c.start + c.duration,
                      );
                      if (clip) {
                        setSelected(clip.id);
                        setSelectedGroupId(null);
                        update((n) => openClipPrompt(n, clip.id, jobs), false);
                      }
                    }}
                    onRemark={(value) =>
                      setModal({
                        type: "remark",
                        value: { id: uid(), ...value },
                      })
                    }
                  />
                  {repairRange && timelineMode !== "direction" && (
                    <div
                      className="range-action-bar"
                      style={{ left: viewport.left + 12 }}
                      role="toolbar"
                      aria-label="Selected range actions"
                    >
                      <span>
                        {tc(repairRange.from)} — {tc(repairRange.to)} ·{" "}
                        {(repairRange.to - repairRange.from).toFixed(2)}s
                      </span>
                      <Icon
                        icon={Copy}
                        label="Copy selected range"
                        onClick={() => editRange("copy")}
                      />
                      <Icon
                        icon={Scissors}
                        label="Cut selected range"
                        onClick={() => editRange("cut")}
                      />
                      <Icon
                        icon={Trash2}
                        label="Remove selected range"
                        onClick={() => editRange("remove")}
                      />
                      <Icon
                        icon={X}
                        label="Clear selected range"
                        onClick={() => setRepairRange(null)}
                      />
                    </div>
                  )}
                  {timelineMode !== "direction" && <div
                    className="video-lane"
                    role="listbox"
                    aria-label="Timeline clips"
                    aria-multiselectable="true"
                  >
                    <TimelineInsertions
                      clips={foldedItems}
                      zoom={zoom}
                      viewport={viewport}
                      onInsert={insertAtCut}
                      onPool={(at) => {
                        setTime(at);
                        setPoolExpanded(true);
                      }}
                    />
                    {visibleClips(
                      foldedItems,
                      viewport.left,
                      viewport.width,
                      zoom,
                    ).map((item) => {
                      if (item.type === "group")
                        return (
                          <div
                            key={item.id}
                            className={`clip take-stack folded-group ${item.members.some((c) => selection.has(c.id)) ? "contains-selection" : ""} ${item.members.every((c) => selection.has(c.id)) ? "selected" : ""}`}
                            data-fold-members={JSON.stringify(
                              item.members.map((c) => c.id),
                            )}
                            style={{
                              left: item.start * zoom,
                              width: Math.max(1, item.duration * zoom),
                              "--slot-color": structureColor(
                                structurePlan,
                                item.node,
                              ),
                            }}
                            role="option"
                            aria-selected={item.members.every((c) =>
                              selection.has(c.id),
                            )}
                            tabIndex={0}
                            aria-label={`Collapsed group: ${item.node.title}, ${item.members.length} clips`}
                            onPointerDown={(e) => {
                              if (
                                !e.metaKey &&
                                !e.ctrlKey &&
                                !e.shiftKey &&
                                selection.size > item.members.length &&
                                item.members.every((c) => selection.has(c.id))
                              )
                                pointerSelection(e);
                              else pointerGroup(e, item.node);
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.target === e.currentTarget &&
                                e.key === "Enter"
                              ) {
                                e.preventDefault();
                                e.stopPropagation();
                                if (e.metaKey || e.ctrlKey || e.shiftKey)
                                  modifiedSelection(
                                    e,
                                    groupSlots(p, item.node.id).map(
                                      (c) => c.id,
                                    ),
                                  );
                                else selectStructureNode(item.node);
                              }
                            }}
                          >
                            <Layers size={18} />
                            <b>{item.node.title}</b>
                            <small>
                              {item.members.length} clips · {tc(item.start)}–
                              {tc(item.start + item.duration)}
                            </small>
                            {item.members.some((c) =>
                              clipJobs(c, jobs, p.episodeId).some(
                                (j) =>
                                  !["ready", "failed", "cancelled"].includes(
                                    j.state,
                                  ),
                              ),
                            ) && (
                              <small className="folded-progress">
                                Generating…
                              </small>
                            )}
                            <button
                              aria-label={`Expand ${item.node.title}`}
                              title="Expand group"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => toggleGroupFold(item.node)}
                            >
                              <ChevronDown size={15} />
                            </button>
                          </div>
                        );
                      const c = item.clip;
                      const m = takeOf(c),
                        idx = c.takes.findIndex((t) => t.id === c.activeTake),
                        clipJob = currentSlotJob(c, jobs, p.episodeId);
                      return (
                        <div
                          key={c.id}
                          data-clip={c.id}
                          className={`clip take-stack ${c.plannedReservation && !m && !clipJob ? "planned-slot" : ""} ${!selectedGroupId && selection.size <= 1 && draft.targetId === c.id ? "draft-linked" : ""} ${selection.has(c.id) ? "selected" : ""} ${!m ? "pending" : ""}`}
                          style={{
                            left:
                              (c.start +
                                (dropPreview?.mode === "insert" &&
                                c.start >= dropPreview.start
                                  ? dropPreview.duration
                                  : 0)) *
                              zoom,
                            width: Math.max(1, c.duration * zoom),
                            "--slot-color": plannedNode(p, c)
                              ? structureColor(structurePlan, plannedNode(p, c))
                              : "#73a5ff",
                          }}
                          tabIndex={0}
                          role="option"
                          aria-selected={selection.has(c.id)}
                          aria-label={
                            c.plannedReservation && !m
                              ? `Open planned ${plannedNode(p, c)?.nodeType || "clip"}: ${plannedNode(p, c)?.title || "Clip"} at ${tc(c.start)}`
                              : `Clip at ${tc(c.start)}, take ${idx + 1} of ${c.takes.length}`
                          }
                          onContextMenu={e=>{if(e.ctrlKey)e.preventDefault();}}
                          onPointerDown={(e) => pointerClip(e, c)}
                          onDoubleClick={(e) => {
                            if (e.target.closest('button,.trim-handle')) return;
                            e.preventDefault(); e.stopPropagation();
                            setSelected(c.id); setSelectedGroupId(null); setInspect(null);
                            if (m) elementEditor.inspectMedia(c);
                            else { setComposerCollapsed(false); update(n => openClipPrompt(n, c.id, jobs), false); }
                          }}
                          onWheel={(e) => {
                            if (c.takes.length < 2) return;
                            if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
                              lastWheel.current = { clipId: c.id, at: Date.now(), sum: 0, consumed: true };
                              return;
                            }
                            e.stopPropagation();
                            const gesture = takeWheelGesture(
                              lastWheel.current,
                              {
                                clipId: c.id,
                                deltaY: e.deltaY,
                                deltaX: e.deltaX,
                                deltaMode: e.deltaMode,
                                at: Date.now(),
                              },
                            );
                            lastWheel.current = gesture.state;
                            if (gesture.direction)
                              switchTake(c, gesture.direction);
                          }}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget || e.repeat || e.altKey || e.isComposing) return;
                            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.shiftKey && m) {
                              e.preventDefault(); e.stopPropagation(); setSelected(c.id); elementEditor.inspectMedia(c); return;
                            }
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              if (e.metaKey || e.ctrlKey || e.shiftKey) {
                                modifiedSelection(e, [c.id]);
                                return;
                              }
                              if (!m && plannedNode(p, c)) {
                                selectStructureNode(plannedNode(p, c));
                                return;
                              }
                              setComposerCollapsed(false);
                              update(
                                (n) => openClipPrompt(n, c.id, jobs),
                                false,
                              );
                              setSelectedGroupId(null);
                              setSelected(c.id);
                              setTime(c.start);
                              setView("compose");
                              setInspect(null);
                            }
                            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                              e.preventDefault();
                              e.stopPropagation();
                              switchTake(c, e.key === "ArrowUp" ? 1 : -1);
                            }
                          }}
                        >
                          {repairRange &&
                            repairRange.to > c.start &&
                            repairRange.from < c.start + c.duration && (
                              <div
                                className="repair-highlight"
                                style={{
                                  left:
                                    Math.max(0, repairRange.from - c.start) *
                                    zoom,
                                  width:
                                    (Math.min(
                                      repairRange.to,
                                      c.start + c.duration,
                                    ) -
                                      Math.max(repairRange.from, c.start)) *
                                    zoom,
                                }}
                              />
                            )}
                          {trimPreview && selection.has(c.id) && (
                            <span className="live-trim-duration">
                              {c.duration.toFixed(2)}s
                            </span>
                          )}
                          <TimelineFrameMarkers
                            usages={frameUsages}
                            clip={c}
                            zoom={zoom}
                            onOpen={(id) =>
                              focusDraft(p.drafts.find((d) => d.id === id))
                            }
                          />
                          {m?.audio && (
                            <ClipAudioShape
                              clip={c}
                              media={m}
                              sourceIn={takeSourceIn(c, m)}
                              onChange={(patch) =>
                                update((n) => {
                                  const target = n.clips.find(
                                    (x) => x.id === c.id,
                                  );
                                  if (target) Object.assign(target, patch);
                                })
                              }
                            />
                          )}
                          <TakeStack
                            plannedTitle={plannedNode(p, c)?.title}
                            plannedType={plannedNode(p, c)?.nodeType}
                            clip={c}
                            selected={selection.has(c.id)}
                            media={m}
                            job={clipJob}
                            jobs={clipJobs(c, jobs, p.episodeId)}
                            zoom={zoom}
                            onTake={(dir) => switchTake(c, dir)}
                            onBrowse={() =>
                              setModal({ type: "takes", clipId: c.id })
                            }
                            onSettings={() =>
                              setModal({ type: "clip-settings", clipId: c.id })
                            }
                            onMute={() =>
                              update((n) => {
                                const x = n.clips.find((x) => x.id === c.id);
                                x.mute = !x.mute;
                              })
                            }
                          />
                          {(m || editablePlannedSlot(c)) && (
                            <>
                              <div
                                className="trim-handle left"
                                title="Resize from start · drag to change length"
                                onPointerDown={(e) => pointerClip(e, c, "left")}
                              />
                              <div
                                className="trim-handle right"
                                title="Resize from end · drag to change length"
                                onPointerDown={(e) =>
                                  pointerClip(e, c, "right")
                                }
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>}
                  {(timelineMode === "all" || timelineMode === "elements") && <ElementsTimeline editor={elementEditor} onFocusItem={(e,id)=>focusTimeline(e,"element",id)} zoom={zoom} focused={timelineMode === "elements"}/>}
                  {(timelineMode === "all" || timelineMode === "direction") && <DirectionTimeline
                    key={p.id + p.episodeId}
                    project={p}
                    composerHost={directionComposerHost}
                    onClose={() => changeTimelineMode("all")}
                    zoom={zoom}
                    viewport={viewport}
                    time={time}
                    range={repairRange}
                    selectedGroupId={selectedGroupId}
                    update={update}
                    onSeek={(at) => { setTime(at); setPlaying(false); }}
                    focused={timelineMode === "direction"}
                    onFocus={() => changeTimelineMode("direction")}
                  />}
                  {(timelineMode === "all" || timelineMode === "sound") && <>
                  <SoundtrackTimeline
                    project={p}
                    runs={sound.runs}
                    zoom={zoom}
                    viewport={viewport}
                    expanded={soundtrackExpanded}
                    onInspect={id => { elementEditor.close(); setAudioInspector(id); setSelected(id); setComposerCollapsed(true); setPlaying(false); }}
                    onExpand={() => setSoundtrackExpanded((v) => !v)}
                    onOpen={(target) => {
                      sound.setFocus(target);
                      openSoundtrack();
                    }}
                    update={update}
                  />
                  <AudioTimeline onFocusItem={(e,id)=>focusTimeline(e,"audio",id)}
                    project={
                      soundtrackExpanded
                        ? p
                        : {
                            ...p,
                            audioClips: p.audioClips.filter(
                              (a) => !a.soundtrack,
                            ),
                          }
                    }
                    update={update}
                    selected={selected}
                    onSelect={id => { elementEditor.close(); setSelected(id); if (audioInspector) setAudioInspector(id); }}
                    onInspect={id => { elementEditor.close(); setAudioInspector(id); setSelected(id); setComposerCollapsed(true); setPlaying(false); }}
                    zoom={zoom}
                    viewport={viewport}
                    time={time}
                    snap={snap}
                    onSeek={(at) => {
                      setTime(at);
                      setPlaying(false);
                    }}
                    onMixer={() => setModal("audio")}
                  />
                  </>}
                  {!audioFocus && !["direction", "elements"].includes(timelineMode) &&
                    activeClip?.activeTake &&
                    !playing &&
                    !repairRange && (
                      <TimelineFrameAction
                        clip={activeClip}
                        fps={p.settings.export.fps}
                        time={time}
                        zoom={zoom}
                        viewport={viewport}
                        open={frameMenu}
                        onToggle={() => setFrameMenu(!frameMenu)}
                        onUse={useFrameInNewPrompt}
                        onInsertImage={() => importAtPlayhead('image')}
                        onInsertAudio={() => importAtPlayhead('audio')}
                        onConnectImages={takeOf(activeClip)?.kind === 'image' && (()=>{
                          const ordered=[...p.clips].sort((a,b)=>a.start-b.start), next=ordered[ordered.findIndex(c=>c.id===activeClip.id)+1];
                          return next && takeOf(next)?.kind === 'image' ? ()=>setModal({type:'photo-story',beforeId:activeClip.id,afterId:next.id}) : undefined;
                        })()}

                        onInsert={() => {
                          let target;
                          update((n) => {
                            const defaults = createDefaultDraft(time);
                            const result = insertPromptAtFrame(
                              n,
                              activeClip.id,
                              time,
                              defaults.settings.duration,
                            );
                            const d = beatDraft(n, result.node, defaults);
                            d.frameOverrides = {
                              start: {
                                mode: "manual",
                                frame: result.frames.start,
                              },
                              end: { mode: "manual", frame: result.frames.end },
                            };
                            d.automation = {
                              ...d.automation,
                              frames: true,
                              startFrame: true,
                              endFrame: true,
                            };
                            const source = n.drafts.find(
                              (x) =>
                                x.targetId === activeClip.id ||
                                x.id === activeClip.sourceDraftId,
                            );
                            if (source) {
                              d.referenceIds = [...source.referenceIds];
                              d.referenceOptions = structuredClone(
                                source.referenceOptions || {},
                              );
                            }
                            n.drafts.push(d);
                            n.activeDraftId = d.id;
                            target = result.slot;
                          });
                          setTime(target.start);
                          setSelected(target.id);
                          setSelectedGroupId(null);
                          setComposerCollapsed(false);
                          setFrameMenu(false);
                          setView("compose");
                        }}
                        onDragStart={() => {
                          setComposerCollapsed(false);
                          setSelectedGroupId(null);
                          setView("compose");
                        }}
                        onAttach={(key, frame) => {
                          editDraft((d) => {
                            d.frameOverrides = {
                              ...d.frameOverrides,
                              [key]: { mode: "manual", frame },
                            };
                            d.automation = {
                              ...d.automation,
                              frames: true,
                              [key === "start" ? "startFrame" : "endFrame"]:
                                true,
                            };
                          });
                          setFrameMenu(false);
                          notice(
                            `${key === "start" ? "Start" : "End"} frame attached`,
                          );
                        }}
                      />
                    )}
                  <TimelineRuler
                    onRange={selectRulerRange}
                    maxTime={scrubEnd}
                    range={repairRange}
                    zoom={zoom}
                    viewport={viewport}
                    fps={p.settings.export.fps}
                    onSeek={(at) => {
                      setTime(Math.min(scrubEnd, at));
                      setPlaying(false);
                    }}
                  >
                    <TimelinePlayhead
                      time={time}
                      zoom={zoom}
                      fps={p.settings.export.fps}
                      maxTime={scrubEnd}
                      timeline={timeline}
                      onSeek={setTime}
                      onPause={() => setPlaying(false)}
                      onTogglePlay={() => {
                        if (!playing && time >= total) setTime(0);
                        setPlaying((value) => !value);
                      }}
                    />
                  </TimelineRuler>
                  {(dropPreview || dropAt !== null) && (
                    <div
                      className={`pool-drop-marker ${dropPreview?.mode || ""}`}
                      style={{
                        left: (dropPreview?.start ?? dropAt) * zoom,
                        width: dropPreview ? dropPreview.duration * zoom : 0,
                      }}
                    >
                      <span>
                        {dropPreview?.label || "Attach or insert here"}
                      </span>
                    </div>
                  )}
                  <div className="playhead" aria-hidden="true" style={{ left: time * zoom }} />
                </div>
              </div>
            </div>
            <footer className="timeline-footer">
              <div className="footer-info">
                {selection.size > 1 && (
                  <span className="selection-count">
                    {selection.size} selected
                  </span>
                )}
                <span className="preview-tc">
                  {tc(time)} <small>/ {tc(total)}</small>
                </span>
                <span className="footer-clip-count">
                  {p.clips.filter((c) => c.activeTake).length} clips
                  {p.clips.some((c) => !c.activeTake)
                    ? ` · ${p.clips.filter((c) => !c.activeTake).length} planned`
                    : ""}
                </span>

                {timelineMode !== "direction" && selection.size <= 1 &&
                  (selectedClip?.activeTake ||
                    editablePlannedSlot(selectedClip)) && (
                    <span className="clip-controls">
                      {selectedClip.activeTake && (
                        <>
                          <span>Source in</span>
                          <input
                            aria-label="Source in seconds"
                            type="number"
                            min="0"
                            step="0.1"
                            value={selectedClip.in}
                            onChange={(e) => {
                              const value = Math.max(0, +e.target.value),
                                m = takeOf(selectedClip);
                              if (
                                !m ||
                                value + selectedClip.duration <= m.duration
                              )
                                update(
                                  (n) =>
                                    (n.clips.find((c) => c.id === selected).in =
                                      value),
                                );
                            }}
                          />
                        </>
                      )}
                      <span>Duration</span>
                      <CommittedNumber
                        key={selectedClip.id}
                        aria-label="Clip duration"
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={selectedClip.duration}
                        onCommit={(n) => {
                          const value = Math.max(0.1, n),
                            m = takeOf(selectedClip);
                          if (!m || selectedClip.in + value <= m.duration)
                            update((n) =>
                              editablePlannedSlot(selectedClip)
                                ? editPlannedSlot(
                                    n,
                                    selected,
                                    { duration: value },
                                    models,
                                  )
                                : resizeSlot(
                                    n,
                                    n.clips.find((c) => c.id === selected),
                                    value,
                                  ),
                            );
                        }}
                      />
                    </span>
                  )}
              </div>
              <div
                className="footer-transport"
                aria-label="Playhead controls"
                title="Space: play/pause · ←/→: one frame · Shift+←/→: one second"
              >
                <Icon
                  icon={SkipBack}
                  label="Go to start"
                  onClick={() => {
                    setTime(0);
                    setPlaying(false);
                  }}
                />
                <Icon
                  icon={ChevronLeft}
                  label="Previous frame"
                  onClick={() => {
                    setPlaying(false);
                    setTime((t) => Math.max(0, t - 1 / p.settings.export.fps));
                  }}
                />
                <Icon
                  icon={playing ? Pause : Play}
                  label={playing ? "Pause" : "Play timeline"}
                  className="play-control"
                  onClick={() => {
                    if (time >= total) setTime(0);
                    setPlaying((v) => !v);
                  }}
                />
                <Icon
                  icon={ChevronRight}
                  label="Next frame"
                  onClick={() => {
                    setPlaying(false);
                    setTime((t) =>
                      Math.min(total, t + 1 / p.settings.export.fps),
                    );
                  }}
                />
                <Icon
                  icon={SkipForward}
                  label="Go to end"
                  onClick={() => {
                    setTime(total);
                    setPlaying(false);
                  }}
                />
              </div>
              <div className="footer-utility-wrap" data-open={footerToolsOpen}>
                <button
                  className="icon footer-tools-toggle"
                  aria-label="Timeline tools"
                  aria-expanded={footerToolsOpen}
                  onClick={() => setFooterToolsOpen((v) => !v)}
                >
                  <Settings2 size={17} />
                </button>
                <div
                  className="footer-utilities"
                  role="toolbar"
                  aria-label="Timeline utilities"
                >
                  <Icon
                    icon={Archive}
                    label="All prompt drafts"
                    onClick={() => setModal("drafts")}
                  />
                  <span className="tool-separator" />
                  <ClipMixer
                    clip={selectedClip}
                    canDetach={!!takeOf(selectedClip)?.audio}
                    onDetach={detachSelectedAudio}
                    change={(fn) =>
                      update((n) => {
                        const c = n.clips.find((c) => c.id === selected);
                        if (c) fn(c);
                      })
                    }
                    onAudio={() => setModal("audio")}
                  />
                  <Icon
                    icon={Maximize2}
                    label="Fit entire timeline"
                    onClick={() => {
                      setZoom(
                        Math.max(
                          0.1,
                          Math.min(
                            240,
                            (viewport.width - 32) / Math.max(1, total),
                          ),
                        ),
                      );
                      timeline.current?.scrollTo({ left: 0 });
                    }}
                  />
                  <Icon
                    icon={ZoomOut}
                    label="Zoom out"
                    onClick={() => setZoom((z) => Math.max(0.1, z / 1.3))}
                  />
                  <input
                    aria-label="Timeline zoom"
                    type="range"
                    min="0.1"
                    step="0.1"
                    max="240"
                    value={zoom}
                    onChange={(e) => setZoom(+e.target.value)}
                  />
                  <Icon
                    icon={ZoomIn}
                    label="Zoom in"
                    onClick={() => setZoom((z) => Math.min(240, z * 1.3))}
                  />
                </div>
              </div>
              <button
                className="library-open-button"
                aria-label="Media Library"
                aria-expanded={poolExpanded}
                title="Open Media Library"
                onClick={() => {
                  setPlaying(false);
                  setPoolExpanded((v) => !v);
                }}
              >
                <Images size={20} />
                <Plus size={10} />
              </button>
            </footer>
          </section>
          <div className="assets-workspace-sheet" aria-hidden={!poolExpanded}>
            {poolExpanded && (
              <MediaDock
                project={p}
                jobs={jobs}
                onClose={() => setPoolExpanded(false)}
                onManage={() => setModal("assets")}
                onCreate={(kind, folderId) =>
                  setModal({ type: "story-assets", createKind: kind, folderId })
                }
                onEdit={(assetId) =>
                  setModal({ type: "story-assets", assetId })
                }
                onDrag={dragPoolVideo}
                onUse={useLibraryItem}
                onImport={(kind, folderId) => {
                  importIntent.current = { kind, folderId };
                  fileInput.current.accept =
                    kind === "audio"
                      ? "audio/*"
                      : kind === "footage"
                        ? "video/*,audio/*"
                        : "image/*";
                  fileInput.current.click();
                }}
                onScope={(item) =>
                  update((n) => {
                    let asset = n.assets.find(
                      (a) =>
                        a.id === item.asset?.id ||
                        a.media?.id === item.media?.id,
                    );
                    if (!asset) {
                      asset = {
                        id: item.job ? "generation-" + item.job.id : uid(),
                        name: item.name,
                        kind: item.kind,
                        media: item.media,
                        generated: !!item.job,
                      };
                      n.assets.push(asset);
                    }
                    setAssetProjectOnly(asset, !isProjectOnly(asset));
                  })
                }
              />
            )}
          </div>
        </>
      )}
      {busy && (
        <div className="busy">
          <LoaderCircle className="spin" size={16} />
          {busy}
        </div>
      )}
      <Notification message={toast} onDismiss={() => setToast("")} />
      {store.conflict && (
        <Modal title="Your draft is safe" onClose={() => {}}>
          <p>{store.conflict}</p>
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(p, null, 2)], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "recovered-project.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Download browser draft
          </button>
          <button onClick={() => act(store.mergeConflict)}>
            Keep both versions as separate drafts
          </button>
          <button onClick={() => act(store.reload)}>Reload disk version</button>
        </Modal>
      )}
      {modal === "create" && (
        <CreateProject
          onClose={() => setModal(null)}
          onCreate={async (body) => {
            await flush();
            const r = await api("/projects", body);
            await load(r.project.id);
            setWorkspace(
              body.templateId && body.includeSample ? "editor" : "story",
            );
            setModal(null);
            setJobs([]);
          }}
        />
      )}
      {modal === "projects" && (
        <Modal title="Projects" onClose={() => setModal(null)}>
          <p className="muted">{p.folder}</p>
          {p.episodes?.some((e) => e.id !== p.episodeId) && (
            <details>
              <summary>Legacy episode data</summary>
              <p>
                Access timelines saved before Structure groups replaced
                episodes.
              </p>
              <EpisodePicker
                project={p}
                update={update}
                createDraft={createDefaultDraft}
              />
            </details>
          )}
          <button
            onClick={() =>
              act(async () => {
                await flush();
                const folder = (await api("/folder", {})).path;
                const opened = await api("/projects/open", { folder });
                await load(opened.project.id);
                setModal(null);
              })
            }
          >
            <FolderOpen size={15} /> Open project folder
          </button>
          <button
            onClick={() =>
              act(async () => {
                await flush();
                await api("/projects/" + p.id + "/backup", {});
                notice("Portable checkpoint saved in the project folder.");
              })
            }
          >
            Save portable checkpoint
          </button>
          <button className="primary" onClick={() => setModal("create")}>
            <Plus size={16} /> New project
          </button>
          <ProjectList
            onOpen={async (id) => {
              await load(id);
              setJobs([]);
              setTime(0);
              setSelected(null);
              setModal(null);
            }}
          />
        </Modal>
      )}
      {modal?.type === 'photo-story' && (()=>{
        const before=p.clips.find(c=>c.id===modal.beforeId),after=p.clips.find(c=>c.id===modal.afterId);
        return before && after && <Modal title="Connect photos" onClose={()=>setModal(null)}><PhotoStory project={p} before={takeOf(before)} after={takeOf(after)} flush={flush} onCreate={writing=>connectPhotos(before.id,after.id,writing)}/></Modal>;
      })()}
      {modal?.type === "clip-settings" &&
        p.clips.some((c) => c.id === modal.clipId) && (
          <ClipSettings
            project={p}
            clip={p.clips.find((c) => c.id === modal.clipId)}
            jobs={jobs}
            flush={flush}
            onJob={(j) => setJobs((js) => [...js, j])}
            onApply={(media, signature) =>
              update((n) =>
                applyClipTreatment(n, modal.clipId, media, signature),
              )
            }
            onClose={() => setModal(null)}
          />
        )}
      {(modal === "assets" || modal?.type === "story-assets") && (
        <RecoveryBoundary onClose={() => setModal(null)}><AssetLibrary
          generated={generationPool(p, jobs)
            .filter((entry) => entry.job)
            .map((entry) => ({
              id: entry.key,
              poolKey: entry.key,
              job: entry.job,
              kind: "footage",
              name: entry.name,
              media: entry.media,
              description: "AI generated · prompt and settings preserved",
            }))}
          onInspect={(asset) =>
            setModal({ type: "details", job: asset.job, media: asset.media })
          }
          manageOnly={workspace === "story"}
          initialAssetId={modal?.assetId}
          initialKind={modal?.createKind}
          initialFolderId={modal?.folderId}
          project={p}
          draft={draft}
          update={update}
          onClose={() => setModal(null)}
          onImport={(kind, onMedia) => {
            importIntent.current = { kind, onMedia };
            fileInput.current.accept =
              kind === "audio"
                ? "audio/*"
                : kind === "footage"
                  ? "video/*,image/png,image/jpeg,image/webp"
                  : "image/*";
            fileInput.current.click();
          }}
          onAddMedia={(m) => {
            addMedia(m);
            setModal(null);
          }}
          onDemo={demo}
        /></RecoveryBoundary>
      )}
      {modal === "costs" && (
        <Modal
          title="Project costs & balances"
          wide
          onClose={() => setModal(null)}
        >
          <CostPanel
            billing={billing}
            project={p}
            onSeek={(at) => {
              setModal(null);
              setWorkspace("editor");
              setTime(at);
              setPlaying(false);
            }}
          />
        </Modal>
      )}
      {(modal === "settings" || modal === "connections") && (
        <Modal title="Project settings" wide onClose={() => setModal(null)}>
          <ProjectSettings
              beforeUpdate={flush}
            project={p}
            update={update}
            models={models}
            videoMode={videoMode}
            refreshVideoModels={refreshVideoModels}
            holdToGenerate={holdToGenerate}
            setHoldToGenerate={setHoldToGenerate}
            simulation={simulation}
            setSimulation={setSimulation}
            initialTab={modal === "connections" ? "connections" : "prompting"}
          />
        </Modal>
      )}
      {modal === "history" && (
        <Modal
          title="Project revision history"
          wide
          onClose={() => setModal(null)}
        >
          <HistoryPanel project={p} update={update} />
        </Modal>
      )}
      {modal === "soundtrack" && (
        <Modal
          title="Soundtrack"
          className="soundtrack-modal"
          onClose={() => setModal(null)}
        >
          <SoundtrackPanel
            update={update}
            project={p}
            sound={sound}
            selectedIds={[...selection]}
                    onPreviewPlay={() => setPlaying(false)}
                    timelinePlaying={playing}
                    onInspect={id => { elementEditor.close(); setAudioInspector(id); setSelected(id); setPlaying(false); setModal(null); }}
                    onSelectClip={(id) => {
                      const clip = p.clips.find(c => c.id === id);
                      if (!clip) return;
                      setSelected(id); setTime(clip.start); setPlaying(false);
                      update(n => openClipPrompt(n, id, jobs), false);
                    }}
            range={repairRange}
            onRange={selectRulerRange}
            onSeek={setTime}
            testMode={videoMode === "demo"}
            onClose={() => setModal(null)}
            onMixer={() => setModal("audio")}
          />
        </Modal>
      )}
      {modal === "audio" && (
        <Modal title="Audio mixer" wide onClose={() => setModal(null)}>
          <AudioEditor
            key={p.id + p.episodeId}
            project={p}
            update={update}
            time={time}
            flush={flush}
            notice={notice}
            onImport={() => {
              setModal(null);
              importIntent.current = {
                kind: "footage",
                onMedia: (media) => {
                  const id = uid();
                  update((n) => {
                    if (n.id !== p.id) return;
                    n.assets.push(importedAsset(media, "footage"));
                    if (media.audio) {
                      const lane = freeAudioLane(
                        n.audioClips,
                        time,
                        media.duration,
                      );
                      n.audioClips.push(audioClip(media, id, time, lane));
                      n.audioLanes = Math.max(n.audioLanes, lane + 1);
                    }
                  });
                  if (media.audio) {
                    setSelected(id);
                    notice("Audio added at the playhead.");
                  } else
                    notice("Saved to the library. This file has no audio.");
                },
              };
              fileInput.current.click();
            }}
          />
        </Modal>
      )}
      {modal === "export" && (
        <Modal title="Export video" onClose={() => setModal(null)}>
          <ExportProfile project={p} update={update} onExport={exportEpisode} />
        </Modal>
      )}
      {modal?.type === "mismatch" && (
        <Modal title="Take duration mismatch" onClose={() => setModal(null)}>
          <TakeMismatch
            clip={modal.clip}
            take={modal.take}
            onApply={(fields) => {
              update((p) => {
                Object.assign(
                  p.clips.find((c) => c.id === modal.clip.id),
                  fields,
                );
                openClipPrompt(p, modal.clip.id, jobs);
              });
              setSelected(modal.clip.id);
              setTime(modal.clip.start);
              setView("compose");
              setInspect(null);
              setModal(null);
            }}
          />
        </Modal>
      )}
      {modal === "jobs" && (
        <Modal title="Jobs & exports" onClose={() => setModal(null)} wide>
          <div className="jobs-summary">
            {running.length + sound.runs.filter(r => ["queued", "processing"].includes(r.state)).length + sound.lip.jobs.filter(lipSyncActive).length} active{" "}
            <span>
              {jobs.some((j) => isLiveJob(j))
                ? "Provider estimates saved per job · final billing with your provider"
                : "No charge"}
            </span>
          </div>
          {sound.lip.jobs.map(job=><button className="job-row" key={job.id} onClick={()=>{setModal(null);setWorkspace("editor");openSoundtrack();sound.setFocus({role:"dialogue"});}}><AudioLines size={20}/><span><b>Lip-sync</b><small>{job.state} · {job.stage}</small></span></button>)}
          {sound.runs.map(run => <button className="job-row" key={run.id} onClick={() => { setModal(null); setWorkspace("editor"); openSoundtrack(); sound.setFocus({runId:run.id,role:run.units[0]?.role}); }}><AudioLines size={20} /><span><b>Soundtrack · {[...new Set(run.units.map(u => u.role))].join(" / ")}</b><small>{run.state} · {run.units.find(u => u.state === "processing")?.stage || `${run.units.filter(u => u.state === "ready").length}/${run.units.length} ready`}</small></span></button>)}
          {[...jobs].reverse().map((j) => (
            <div className="job-row" key={j.id}>
              {j.media ? (
                <img alt="Generation preview" src={j.media.thumbnail} />
              ) : (
                <div className="job-icon">
                  {j.kind === "export" ? (
                    <Download size={22} />
                  ) : (
                    <Layers size={22} />
                  )}
                </div>
              )}
              <div>
                <b>
                  {j.kind === "export"
                    ? "Video export"
                    : j.kind === "clip-treatment"
                      ? "Clip speed / reverse"
                      : j.snapshot.draft.name}
                </b>
                <small>
                  {j.state} · {new Date(j.createdAt).toLocaleTimeString()}
                </small>
                <JobProgress job={j} />
                <JobRecovery
                  job={j}
                  onAction={(url, body) => act(() => api(url, body))}
                />
                <small>
                  {j.snapshot.model ||
                    (j.kind === "clip-treatment"
                      ? "Local processing"
                      : "Export")}{" "}
                  ·{" "}
                  {j.snapshot.start !== undefined
                    ? tc(j.snapshot.start) + "–" + tc(j.snapshot.end)
                    : ""}{" "}
                  ·{" "}
                  {Math.floor(
                    ((j.completedAt || Date.now()) - j.createdAt) / 1000,
                  )}
                  s elapsed
                </small>
              </div>
              {j.kind === "export" && j.state === "ready" ? (
                <a className="button" href={"/api/exports/" + j.id}>
                  <Download size={15} /> Download MP4
                </a>
              ) : (
                <Icon
                  icon={Info}
                  label="Inspect job"
                  onClick={() =>
                    setModal(
                      j.kind === "clip-treatment"
                        ? { type: "clip-settings", clipId: j.clipId }
                        : { type: "details", job: j, media: j.media },
                    )
                  }
                />
              )}
              {["queued", "running"].includes(j.state) &&
                (!isLiveJob(j) || j.state === "queued") && (
                  <Icon
                    icon={X}
                    label="Cancel queued job"
                    onClick={() =>
                      act(() => api("/jobs/" + j.id + "/cancel", {}))
                    }
                  />
                )}
              {["failed", "interrupted"].includes(j.state) &&
                (!isLiveJob(j) || j.providerJobId) && (
                  <Icon
                    icon={RotateCcw}
                    label="Resume job"
                    onClick={() =>
                      act(() => api("/jobs/" + j.id + "/retry", {}))
                    }
                  />
                )}
            </div>
          ))}
          {!jobs.length && <p className="muted">No jobs yet.</p>}
        </Modal>
      )}
      {modal === "drafts" && (
        <Modal title="Closed prompts" onClose={() => setModal(null)}>
          {p.drafts
            .filter((d) => d.closed && d.episodeId === p.episodeId)
            .map((d) => (
              <button
                className="restore-row"
                key={d.id}
                onClick={() => {
                  focusDraft(d);
                  setModal(null);
                }}
              >
                <FileText size={17} />
                {d.name}
                <RotateCcw size={15} />
              </button>
            ))}
          {!p.drafts.some((d) => d.closed && d.episodeId === p.episodeId) && (
            <p className="muted">No closed drafts.</p>
          )}
        </Modal>
      )}
      {modal?.type === "rename" && (
        <Modal title="Rename prompt" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update(
                (n) =>
                  (n.drafts.find((d) => d.id === modal.id).name =
                    modal.name || "Untitled scene"),
              );
              setModal(null);
            }}
          >
            <input
              autoFocus
              value={modal.name}
              onChange={(e) => setModal({ ...modal, name: e.target.value })}
            />
            <button className="primary">Save name</button>
          </form>
        </Modal>
      )}
      {modal?.type === "remark" && (
        <RemarkModal
          value={modal.value}
          lanes={p.remarkLanes}
          onClose={() => setModal(null)}
          onSave={(r) => {
            update((n) => {
              const i = n.remarks.findIndex((x) => x.id === r.id);
              if (i >= 0) n.remarks[i] = r;
              else n.remarks.push(r);
            });
            setModal(null);
          }}
          onDelete={() => {
            update(
              (n) =>
                (n.remarks = n.remarks.filter((r) => r.id !== modal.value.id)),
            );
            setModal(null);
          }}
        />
      )}
      {modal?.type === "takes" &&
        (() => {
          const clip = p.clips.find((c) => c.id === modal.clipId);
          return (
            <Modal title="Generation takes" onClose={() => setModal(null)} wide>
              <div className="take-gallery">
                {clip &&
                  [...clip.takes].reverse().map((take, i) => {
                    const job = jobs.find((j) => j.id === take.jobId);
                    return (
                      <button
                        key={take.id}
                        className={take.id === clip.activeTake ? "active" : ""}
                        onClick={() => {
                          selectTake(clip, take);
                          setModal(null);
                        }}
                      >
                        <img
                          src={take.thumbnail}
                          alt={job?.snapshot?.draft?.name || "Video take"}
                        />
                        <span>
                          <b>
                            Take {clip.takes.length - i}
                            {take.id === clip.activeTake ? " · Selected" : ""}
                          </b>
                          <small>
                            {job?.snapshot?.draft?.name || take.name}
                          </small>
                          <small>
                            {take.duration.toFixed(1)}s ·{" "}
                            {job?.snapshot?.model || "Local footage"}
                          </small>
                        </span>
                      </button>
                    );
                  })}
              </div>
              {clip &&
                clipJobs(clip, jobs, p.episodeId)
                  .filter((j) => j.state !== "ready")
                  .map((j) => (
                    <button
                      className="take-attempt"
                      key={j.id}
                      onClick={() =>
                        setModal(
                          j.kind === "clip-treatment"
                            ? { type: "clip-settings", clipId: j.clipId }
                            : { type: "details", job: j, media: j.media },
                        )
                      }
                    >
                      <span>
                        {j.snapshot?.draft?.name || "Generation attempt"}
                      </span>
                      <JobProgress job={j} compact inline />
                    </button>
                  ))}
            </Modal>
          );
        })()}
      {modal?.type === "compare" && (
        <Modal title="Compare generations" wide onClose={() => setModal(null)}>
          <GenerationComparison
            jobs={jobs}
            onReuse={(j) => {
              addDraft(j.snapshot.draft, j.snapshot);
              setModal(null);
            }}
          />
        </Modal>
      )}
      {modal?.type === "details" && (
        <Modal title="Generation record" onClose={() => setModal(null)} wide>
          {modal.job && (
            <JobProgress
              job={jobs.find((j) => j.id === modal.job.id) || modal.job}
            />
          )}
          {modal.media && (
            <img className="detail-poster" src={modal.media.thumbnail} />
          )}
          {modal.job?.kind === "generation" ? (
            <>
              <div className="details-grid">
                <Field label="Provider">
                  <span>{modal.job.snapshot.provider}</span>
                </Field>
                <Field label="Model">
                  <span>{modal.job.snapshot.model}</span>
                </Field>
                <Field label="Settings">
                  <span>
                    {Object.entries(modal.job.snapshot.draft.settings)
                      .filter(([k]) => k !== "model")
                      .map(([k, v]) => v)
                      .join(" · ")}
                  </span>
                </Field>
                <Field label="Cost">
                  {billing.report?.records.find(
                    (r) => r.key === "video:" + modal.job.id,
                  ) ? (
                    <GenerationCost
                      record={billing.report.records.find(
                        (r) => r.key === "video:" + modal.job.id,
                      )}
                    />
                  ) : (
                    <span>
                      {modal.job.snapshot.price?.amount ?? "Unknown"}{" "}
                      {modal.job.snapshot.price?.unit} ·{" "}
                      {modal.job.actualCharge
                        ? "charged"
                        : "estimate; final billing with your provider"}
                    </span>
                  )}
                </Field>
                <Field label="Submission range">
                  <span>
                    {tc(modal.job.snapshot.start)} →{" "}
                    {tc(modal.job.snapshot.end)}
                  </span>
                </Field>
              </div>
              <div className="detail-actions">
                <Icon
                  label="Compare generations"
                  icon={SplitSquareHorizontal}
                  onClick={() => setModal({ type: "compare" })}
                />
                <button
                  className="primary"
                  onClick={() => {
                    addDraft(modal.job.snapshot.draft, modal.job.snapshot);
                    setModal(null);
                  }}
                >
                  <Copy size={15} /> Reuse prompt
                </button>
                {modal.media &&
                  !p.clips.some((c) =>
                    c.takes.some((t) => t.id === modal.media.id),
                  ) && (
                    <button
                      onClick={() => {
                        addMedia(modal.media);
                        setModal(null);
                      }}
                    >
                      Add to timeline
                    </button>
                  )}
              </div>
              {modal.job.snapshot.requestPayloadStored && (
                <a href={`/api/jobs/${modal.job.id}/receipt`} download>
                  Download complete submission receipt
                </a>
              )}
              <h3>Exact prepared prompt</h3>
              <pre className="exact-prompt">
                {modal.job.snapshot.compiled.text}
              </pre>
              <details>
                <summary>All saved inputs, references & job metadata</summary>
                <pre className="exact-prompt">
                  {JSON.stringify(modal.job, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <>
              <p>{modal.media?.name || "Local render job"}</p>
              <p className="muted">
                {modal.media?.attribution ||
                  "Imported media has no generation prompt."}
              </p>
              <pre className="exact-prompt">
                {JSON.stringify(modal.media || modal.job, null, 2)}
              </pre>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

export default function App() {
  return <><StudioApp /><ProviderConnectHost /></>;
}
