import React, { useState } from "react";
import { Shuffle, ArrowUpRight } from "lucide-react";
import {
  inferScene,
  inferDirection,
  sceneForDesk,
  sceneKey,
  suggestLooks,
} from "../shared/scene-sketch.mjs";
export function LookExplorer({ desk, concept, onCommit }) {
  const [seed, setSeed] = useState(0);
  const suggestions =
    seed || !desk.lookIdeas.length
      ? suggestLooks({ text: concept, format: desk.format }, seed)
      : desk.lookIdeas;
  const apply = (value) => {
    const context = { text: concept, format: desk.format, lookText: value };
    const { scene, direction } = inferDirection(context);
    const current = sceneForDesk(desk, concept);
    onCommit({
      lookText: value,
      look: direction.look,
      ...(!desk.manualControls.includes("realism") ? {realism:direction.realism} : {}),
      ...(!desk.manualControls.some(k=>["palette","customColors"].includes(k)) ? {customColors:scene.colors} : {}),
      scene: {
        ...current,
        medium: scene.medium,
        atmosphere: scene.atmosphere,
        style: value,
        colors: scene.colors,
      },
      sceneSource: sceneKey(context),
    });
  };
  return (
    <div className="desk-open-look">
      <label htmlFor="desk-look-language">
        Describe the look. Mix anything.
      </label>
      <textarea
        id="desk-look-language"
        dir="auto"
        value={desk.lookText}
        maxLength={1200}
        rows={2}
        placeholder="Whiteboard sketches with a glossy 3D object… or Van Gogh brushwork, pastel neon and glitter."
        onChange={(e) => apply(e.target.value)}
      />
      <div className="desk-look-suggestions-head">
        <span>A few starting points</span>
        <button type="button" onClick={() => setSeed((n) => n + 1)}>
          <Shuffle size={14} />
          More ideas
        </button>
      </div>
      <div className="desk-look-suggestions">
        {suggestions.map((look, i) => {
          const scene = inferScene(concept, desk.format, look.description),
            colors = scene.colors;
          return (
            <button
              key={`${seed}-${i}-${look.label}`}
              type="button"
              aria-pressed={desk.lookText === look.description}
              onClick={() => apply(look.description)}
            >
              <span
                className={`desk-material-swatch medium-${scene.medium}`}
                style={{
                  "--look-a": colors[0],
                  "--look-b": colors[1],
                  "--look-c": colors[2],
                }}
              >
                <i />
                <i />
                <i />
              </span>
              <span>
                <b>{look.label}</b>
                <ArrowUpRight size={14} />
              </span>
            </button>
          );
        })}
      </div>
      <p className="desk-hint">
        Suggestions are starting points. Your own description becomes the visual
        direction.
      </p>
    </div>
  );
}
