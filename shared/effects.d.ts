export type MediaKind = "image" | "video";
export type EffectIntent = {
  effectId: string;
  version?: number;
  target: { kind: "clip" | "asset"; id: string };
  settings: Record<string, string | number | boolean>;
  placement?: "insert" | "replace" | "fill";
  range?: { from: number; to: number };
  insertion?: {
    at: number;
    previousClipId?: string | null;
    nextClipId?: string | null;
  };
  references?: {
    role: string;
    mediaId?: string;
    target?: { kind: "clip" | "asset"; id: string };
    edge?: "first" | "last" | "time";
    time?: number;
  }[];
};
export type EffectDefinition = {
  id: string;
  version: number;
  name: string;
  category: string;
  description: string;
  inputs: MediaKind[];
  output: "same-kind" | MediaKind;
  referenceRoles: string[];
  limits: {
    maxDuration: number;
    maxInputEdge: number;
    maxOutputEdge: number;
    maxUploadBytes: number;
  };
  settings: Record<
    string,
    {
      type: string;
      enum: (number | string | boolean)[];
      default: number | string | boolean;
    }
  >;
  models: Record<MediaKind, string>;
  stages: {
    id: string;
    dependsOn: string[];
    output: string;
    billable: boolean;
  }[];
};
export type PreparedEffectIntent = EffectIntent & {
  version: number;
  episodeId: string;
  source: {
    mediaId: string;
    kind: MediaKind;
    in: number;
    duration: number;
    start?: number;
    clipIn?: number;
    visual?: unknown;
    lipSync?: { audioId: string; [key: string]: unknown };
  };
};
export type EffectStage = {
  id: string;
  dependsOn: string[];
  output: string;
  billable: boolean;
  state:
    | "queued"
    | "processing"
    | "submitting"
    | "submission_uncertain"
    | "ready"
    | "failed";
  artifact?: string;
  snapshot?: string;
  providerJobId?: string;
  error?: string;
  terminal?: boolean;
};
export type EffectEstimate = {
  amount: number;
  basis: string;
  note?: string;
  expires: number;
};
export type EffectJob = {
  id: string;
  projectId: string;
  input: PreparedEffectIntent;
  signature: string;
  executionMode: "test" | "live";
  model: string;
  createdAt: number;
  state: "queued" | "processing" | "needs_attention" | "ready" | "cancelled";
  stages: EffectStage[];
  estimate: EffectEstimate;
  media?: {
    id: string;
    name: string;
    kind: MediaKind;
    url: string;
    duration: number;
    [key: string]: unknown;
  };
};
export const effectDefinitions: readonly EffectDefinition[];
export function prepareEffectIntent(
  project: unknown,
  intent: EffectIntent,
): PreparedEffectIntent;
export function effectSignature(input: PreparedEffectIntent): string;
export function effectActive(job: EffectJob): boolean;
export function applyEffect(project: unknown, job: EffectJob): void;
export function saveEffectAsset(project: unknown, job: EffectJob): void;
export function revertEffect(
  project: unknown,
  target: EffectIntent["target"],
): void;
export function effectCostRecord(job: EffectJob): Record<string, unknown>;
