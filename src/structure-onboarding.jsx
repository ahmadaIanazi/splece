import React from "react";
import {
  Check,
  Users,
  MapPin,
  Package,
  ArrowUpRight,
  ImagePlus,
  Layers,
  Clapperboard,
} from "lucide-react";
import { isStructureClip } from "../shared/structure.mjs";
import "./structure-onboarding.css";

export function StoryNextSteps({
  project,
  plan,
  onOpenAsset,
  onWorld,
  onGroup,
  busy,
}) {
  const ids = new Set([
    ...(plan.setup?.castIds || []),
    ...(plan.setup?.assetIds || []),
    ...plan.beats.flatMap((n) => [
      ...(n.characterIds || []),
      ...(n.assetIds || []),
      n.locationId,
    ]),
  ]);
  const assets = project.assets.filter((a) => ids.has(a.id));
  const clips = plan.beats.filter(isStructureClip);
  const first = plan.beats.find((n) => !isStructureClip(n));
  return (
    <section className="story-next-steps" aria-label="Your story, next steps">
      <nav aria-label="Story progress">
        <span data-complete={!!plan.beats.length}>
          <Check aria-hidden="true" size={14} />
          Outline ready
        </span>
        <span>
          <Users aria-hidden="true" size={14} />
          {assets.filter((a) => a.kind === "character").length}{" "}
          {assets.filter((a) => a.kind === "character").length === 1
            ? "character"
            : "characters"}{" "}
          saved
        </span>
        <span>
          <Clapperboard aria-hidden="true" size={14} />
          {clips.length
            ? `${clips.length} planned clips`
            : "Next · plan your clips"}
        </span>
      </nav>
      <div className="story-next-heading">
        <div>
          <h2>
            {busy
              ? "Your story is taking shape"
              : clips.length
                ? "Your story, ready to shape"
                : "Your outline is ready"}
          </h2>
          <details className="story-overview-synopsis">
            <summary>Read story synopsis</summary>
            <p>{plan.synopsis || plan.setup?.concept || plan.brief}</p>
          </details>
        </div>
        {first && (
          <button type="button" onClick={() => onGroup(first)}>
            <Layers aria-hidden="true" size={16} />
            Explore outline
            <ArrowUpRight aria-hidden="true" size={14} />
          </button>
        )}
      </div>
      <header>
        <div>
          <h3>Your cast & places</h3>
          <p>
            Saved in this project. Open a profile to edit it or add its first
            image.
          </p>
        </div>
        <button type="button" onClick={onWorld}>
          Story world
          <ArrowUpRight aria-hidden="true" size={14} />
        </button>
      </header>
      <div className="story-cast-grid">
        {assets.slice(0, 8).map((asset) => {
          const Icon =
            asset.kind === "character"
              ? Users
              : asset.kind === "location"
                ? MapPin
                : Package;
          const image =
            asset.media?.thumbnail ||
            (asset.media?.kind === "image" ? asset.media.url : null);
          return (
            <button
              type="button"
              key={asset.id}
              onClick={() => onOpenAsset(asset.id)}
              aria-label={`Open ${asset.name}`}
            >
              <span className="story-cast-image">
                {image ? (
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    width="42"
                    height="46"
                  />
                ) : (
                  <Icon aria-hidden="true" size={25} />
                )}
              </span>
              <span>
                <b>{asset.name}</b>
                <small>
                  {image ? "Reference ready" : "Written profile · add image"}
                </small>
              </span>
              <ImagePlus aria-hidden="true" size={16} />
            </button>
          );
        })}
        {!assets.length && (
          <p className="story-cast-empty">
            Choose a character or place below to create its profile. You can
            also bring one from your library.
          </p>
        )}
      </div>
      <p className="story-next-caption">
        {clips.length
          ? "Your planned clips are in the timeline below. Choose one to develop its writing."
          : "Next, use “Develop all clips” above to turn the outline into planned shots. Images can come later."}
      </p>
    </section>
  );
}
