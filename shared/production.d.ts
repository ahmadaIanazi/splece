/** Future production operations attach to stable identities, not group depth or display names.
 * These contracts reserve storage; they do not enable rendering or paid generation. */
export type StructureNodeType = "group" | "clip";
export interface StructureNode {
  id: string;
  nodeType: StructureNodeType;
  parentId: string;
  title: string;
  description: string;
  /** Legacy display hint only; never determines legal parentage. */
  kind?: "act" | "chapter" | "scene" | "generation";
  label?: string;
  start: number;
  duration: number;
  end: number;
  childNodeType?: StructureNodeType;
}
export type ProductionTarget =
  | { type: "project"; projectId: string }
  | { type: "group" | "clip"; episodeId: string; nodeId: string }
  | { type: "placement"; episodeId: string; placementId: string }
  | { type: "take"; mediaId: string };
export type CueAnchor =
  | { type: "absolute"; seconds: number }
  | {
      type: "placement";
      placementId: string;
      edge: "start" | "end";
      offset: number;
    }
  | { type: "source"; mediaId: string; sourceSeconds: number };
export interface TransitionOperation {
  id: string;
  episodeId: string;
  fromPlacementId: string;
  toPlacementId: string;
  method: "local" | "generated";
  duration: number;
  timing: "overlap" | "insert";
  sourceTakeIds: [string, string];
  jobId?: string;
  resultMediaId?: string;
  revision: number;
  status: "draft" | "approved" | "needs-review";
}
export interface EffectOperation {
  id: string;
  target: ProductionTarget;
  effectId: string;
  order: number;
  enabled: boolean;
  parameters: Record<string, unknown>;
  revision: number;
}
export interface AudioPlan {
  id: string;
  kind?: "soundtrack";
  episodeId: string;
  revision: number;
  /** Persisted before acknowledging result delivery; undo never replays a job. */
  receipts?: string[];
  cues: {
    id: string;
    anchor: CueAnchor;
    duration: number;
    role: "dialogue" | "music" | "ambience" | "effect";
    mediaId?: string;
    jobId?: string;
    status?: "ready" | "needs-review";
    sources?: SoundtrackSource[];
  }[];
}
export interface SoundtrackSource {
  clipId: string;
  mediaId: string;
  start: number;
  in: number;
  duration: number;
}
export interface Dependency {
  id: string;
  source: ProductionTarget;
  dependentId: string;
  sourceRevision: number;
  reason: "picture" | "script" | "voice" | "reference" | "timing";
}
export interface ProductionState {
  /** Local, explicit character-to-face assignments. Normalized coordinates, clip-relative seconds. */
  faceAssignments?: Record<string, {
    source: {mediaId:string;in:number;duration:number;speed:number;reverse:boolean};
    characters?: Record<string, {time:number;point:[number,number];box:{x:number;y:number;w:number;h:number}}>;
    lines: Record<string, {speaker:string;lineIdentity:string;time:number;point:[number,number];box?:{x:number;y:number;w:number;h:number}}>;
  }>;
  /** Stable fal speech voice names, keyed by character asset ID; descriptions remain on assets. */
  voiceAssignments?: Record<string, string>;
  schemaVersion: 1;
  transitions: TransitionOperation[];
  effects: EffectOperation[];
  audioPlans: AudioPlan[];
  dependencies: Dependency[];
}
