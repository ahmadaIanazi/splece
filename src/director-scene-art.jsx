import React, { useId } from "react";
import { SceneObjects } from "./director-scene-objects.jsx";
import { sceneForDesk } from "../shared/scene-sketch.mjs";

function Figure({ colors, zombie, covered, silhouette, energy }) {
  const [bg, surroundings, main, accent = main] = colors;
  return (
    <g>
      <path
        d="M-28 0L-22-58H22L28 0M-20-56L-33-119Q0-142 33-119L20-56Z"
        fill={silhouette ? bg : main}
      />
      <path
        d={`M-27-111L-${52 + energy / 8}-${zombie ? 100 : 68}M27-111L${52 + energy / 8}-${zombie ? 112 : 70}`}
        fill="none"
        stroke={silhouette ? bg : main}
        strokeWidth="15"
        strokeLinecap="round"
      />
      <ellipse
        cy="-156"
        rx="25"
        ry="31"
        fill={silhouette ? bg : zombie ? surroundings : "#b6aaa0"}
      />
      {covered ? (
        <path
          d="M-27-155Q-32-202 0-197Q34-196 28-155L40-116Q0-101-40-116ZM-18-160Q0-182 18-160V-150Q0-126-18-150Z"
          fill={main}
          fillRule="evenodd"
        />
      ) : (
        <path
          d="M-25-159Q-26-192 0-191Q28-188 25-159L15-171L0-169L-14-173Z"
          fill={surroundings}
        />
      )}
      {!silhouette && (
        <g stroke={zombie ? accent : bg} strokeWidth="3" fill="none">
          <path d="M-13-156h7m12 0h7" />
          <path d={zombie ? "M-10-137l8-4 6 5 6-4" : "M-5-139q5 4 10 0"} />
        </g>
      )}
      <path
        d="M-26 0h23M5 0h26"
        stroke={surroundings}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </g>
  );
}
function Subject({ scene, desk, material }) {
  const c = scene.colors,
    [bg, secondary, base, accent = base] = c;
  const main = desk.realism > 60 && material ? `url(#${material})` : base;
  const edge = scene.medium === "chalk" || scene.medium === "ink";
  const common = {
    stroke: edge ? main : "none",
    strokeWidth: edge ? 3 : 0,
    strokeLinejoin: "round",
  };
  switch (scene.subject) {
    case "person":
    case "group":
    case "zombie":
      return (
        <g>
          {Array.from(
            {
              length:
                scene.subject === "group" || scene.subject === "zombie"
                  ? scene.count
                  : 1,
            },
            (_, i) => (
              <g
                key={i}
                transform={`translate(${(i - (scene.count - 1) / 2) * (scene.subject === "person" ? 0 : 82)} ${(i % 2) * 8}) scale(${i % 2 ? 0.87 : 1}) rotate(${scene.subject === "zombie" ? (i % 2 ? -9 : 7) : 0})`}
              >
                <Figure
                  colors={c}
                  zombie={scene.subject === "zombie"}
                  covered={scene.covered}
                  silhouette={desk.light === "silhouette"}
                  energy={desk.energy}
                />
              </g>
            ),
          )}
        </g>
      );
    case "bottle":
      return (
        <g {...common}>
          <path
            d="M-44-170Q-49-155-55-147V-18Q-55-7-43-6H43Q55-7 55-18V-147Q49-155 44-170Z"
            fill={main}
          />
          <path d="M-33-171V-203H33V-171" fill={secondary} />
          <path d="M-31-202H30M-33-187H33" stroke={accent} strokeWidth="3" />
          <rect
            x="-40"
            y="-127"
            width="80"
            height="68"
            rx="2"
            fill={bg}
            opacity=".8"
          />
          <path d="M-24-104H24M-13-90H13" stroke={accent} strokeWidth="3" />
          <path
            d="M-43-147V-29Q-43-17-30-18"
            fill="none"
            stroke="white"
            opacity=".45"
            strokeWidth="6"
          />
          <path
            d="M42-145V-20"
            stroke={secondary}
            opacity=".5"
            strokeWidth="6"
          />
        </g>
      );
    case "shoe":
      return (
        <g {...common} transform="rotate(-12)">
          <path
            d="M-116-42L-107-113Q-73-67-35-96L11-74Q47-49 102-40Q124-35 120-15H-119Z"
            fill={main}
          />
          <path d="M-121-23H121V-7Q18 5-121-5Z" fill={accent} />
          <path
            d="M-48-79L-28-55M-25-74L-8-50M-2-64L14-45"
            stroke={bg}
            strokeWidth="5"
          />
          <path
            d="M-91-59Q-57-23 24-28"
            fill="none"
            stroke={secondary}
            strokeWidth="11"
          />
        </g>
      );
    case "car":
      return (
        <g {...common}>
          <path
            d="M-132-39L-120-86L-72-93L-38-131H43L85-91L128-77L140-37Z"
            fill={main}
          />
          <path d="M-57-94L-28-121H37L67-94Z" fill={bg} />
          <path d="M5-121V-94" stroke={main} strokeWidth="6" />
          <path d="M-120-74H-96M109-66H132" stroke={accent} strokeWidth="8" />
          {[-85, 86].map((x) => (
            <g key={x}>
              <circle cx={x} cy="-36" r="26" fill={bg} />
              <circle cx={x} cy="-36" r="13" fill={secondary} />
            </g>
          ))}
        </g>
      );
    case "robot":
      return (
        <g {...common}>
          <rect x="-45" y="-121" width="90" height="88" rx="15" fill={main} />
          <rect
            x="-36"
            y="-191"
            width="72"
            height="57"
            rx="15"
            fill={secondary}
          />
          <path
            d="M0-191V-210M-45-103L-69-61M45-103L69-61M-22-33V-6M22-33V-6"
            stroke={main}
            strokeWidth="14"
            strokeLinecap="round"
          />
          <circle cy="-213" r="7" fill={accent} />
          <path d="M-19-163h11M8-163h11" stroke={accent} strokeWidth="8" />
          <circle cy="-78" r="18" fill={bg} />
        </g>
      );
    case "food":
      return (
        <g {...common}>
          <ellipse cy="-12" rx="106" ry="16" fill={secondary} />
          <path d="M-61-128L-45-27Q0-5 45-27L61-128Z" fill={main} />
          <ellipse cy="-128" rx="61" ry="14" fill={accent} />
          <path
            d="M55-112Q109-116 87-67Q76-49 50-57"
            fill="none"
            stroke={main}
            strokeWidth="13"
          />
          <path
            d="M-22-161Q-40-183-17-207M15-156Q38-181 19-208"
            stroke={secondary}
            strokeWidth="5"
            fill="none"
            opacity=".6"
          />
        </g>
      );
    case "plant":
      return (
        <g {...common}>
          <path d="M-47-73L-34 0H34L47-73Z" fill={secondary} />
          <path
            d="M0-72V-203M0-135L-45-168M0-102L47-142"
            stroke={main}
            strokeWidth="7"
            fill="none"
          />
          {[
            [-40, -166, -35],
            [34, -145, 30],
            [-5, -204, 15],
          ].map(([x, y, r], i) => (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx="20"
              ry="37"
              fill={i === 2 ? accent : main}
              transform={`rotate(${r} ${x} ${y})`}
            />
          ))}
        </g>
      );
    case "animal":
      return (
        <g {...common}>
          <ellipse cy="-63" rx="59" ry="56" fill={main} />
          <circle cx="31" cy="-140" r="38" fill={main} />
          <path
            d="M-1-157L4-192L28-174M43-172L71-188L66-149"
            fill={secondary}
          />
          <path
            d="M-51-64Q-107-112-83-140"
            stroke={main}
            strokeWidth="19"
            fill="none"
          />
          <path d="M7-120L14-15M42-111L48-15" stroke={main} strokeWidth="18" />
          <circle cx="24" cy="-146" r="3" fill={bg} />
          <circle cx="48" cy="-146" r="3" fill={bg} />
        </g>
      );
    default:
      return (
        <g {...common}>
          <path d="M0-192L80-145V-54L0-7L-80-54V-145Z" fill={main} />
          <path
            d="M0-192V-99L80-145M0-99L-80-145M0-99V-7"
            fill="none"
            stroke={accent}
            strokeWidth="2"
          />
          <path d="M0-99L80-145V-54L0-7Z" fill={secondary} opacity=".65" />
          <ellipse
            cy="-100"
            rx="122"
            ry="25"
            fill="none"
            stroke={accent}
            strokeWidth="4"
            transform="rotate(-25)"
          />
        </g>
      );
  }
}
function Environment({ scene }) {
  const [bg, secondary, main, accent = main] = scene.colors;
  switch (scene.setting) {
    case "city":
      return (
        <g>
          {[60, 130, 180, 275, 450, 540, 615, 700, 755].map((x, i) => (
            <g key={x}>
              <rect
                x={x - 25}
                y={310 - ((i % 3) + 1) * 53}
                width={42 + (i % 2) * 27}
                height={((i % 3) + 1) * 53}
                fill={secondary}
                opacity={0.3 + (i % 3) * 0.15}
              />
              {Array.from({ length: 4 }, (_, j) => (
                <path
                  key={j}
                  d={`M${x - 13} ${290 - j * 17}h5m9 0h5`}
                  stroke={accent}
                  opacity=".5"
                  strokeWidth="4"
                />
              ))}
            </g>
          ))}
        </g>
      );
    case "forest":
      return (
        <g>
          {[40, 110, 200, 300, 510, 590, 680, 760].map((x, i) => (
            <g
              key={x}
              transform={`translate(${x} 320) scale(${0.7 + (i % 3) * 0.23})`}
              opacity={0.3 + (i % 3) * 0.17}
            >
              <path
                d="M0 0V-220M0-150L-50-190M0-112L55-162M0-190L28-229"
                stroke={secondary}
                strokeWidth="10"
                fill="none"
              />
              {!scene.night && (
                <path d="M0-243L-57-123H57Z" fill={main} opacity=".5" />
              )}
            </g>
          ))}
        </g>
      );
    case "room":
    case "classroom":
      return (
        <g fill={secondary} opacity=".5">
          <path
            d="M0 0H800V320H0ZM72 85V255H225V85ZM534 75V211H726V75Z"
            fillRule="evenodd"
          />
          <path d="M147 85V255M72 169H225" stroke={main} strokeWidth="5" />
          {scene.setting === "classroom" && (
            <g stroke={main} strokeWidth="6">
              <path d="M557 105H690M557 129H667M557 153H705" />
              <path d="M45 319H211M120 319V365" />
            </g>
          )}
        </g>
      );
    case "coast":
      return (
        <g>
          <path d="M0 242Q200 230 400 247T800 240V345H0Z" fill={secondary} />
          {[265, 287, 310].map((y) => (
            <path
              key={y}
              d={`M0 ${y}q100-10 200 0t200 0t200 0t200 0`}
              fill="none"
              stroke={main}
              opacity=".45"
            />
          ))}
          <path d="M0 340Q300 302 800 358V450H0Z" fill={main} opacity=".3" />
        </g>
      );
    case "mountains":
    case "desert":
      return (
        <g fill={secondary}>
          <path
            d={
              scene.setting === "desert"
                ? "M0 310Q160 130 350 287Q550 157 800 305V450H0Z"
                : "M0 310L150 103L280 273L408 154L559 303L695 118L800 290V450H0Z"
            }
            opacity=".5"
          />
          <path d="M0 356Q200 242 420 320T800 350V450H0Z" opacity=".7" />
        </g>
      );
    case "space":
      return (
        <g fill={secondary}>
          <circle cx="660" cy="145" r="68" />
          <ellipse
            cx="660"
            cy="145"
            rx="105"
            ry="18"
            fill="none"
            stroke={main}
            strokeWidth="4"
            transform="rotate(-28 660 145)"
          />
          <circle cx="142" cy="89" r="25" fill={accent} opacity=".7" />
        </g>
      );
    default:
      return (
        <g>
          <circle cx="630" cy="205" r="130" fill={secondary} opacity=".22" />
          <path
            d="M70 323V158Q70 83 147 83H228V323Z"
            fill={secondary}
            opacity=".2"
          />
          <path d="M0 330H800" stroke={main} strokeOpacity=".15" />
        </g>
      );
  }
}
export function SceneArt({ desk, concept = "", scene: given, reference, graph, imageReferences, mode = "test", selected, onSelect, onPreviewNode, onCommitNode }) {
  const id = useId().replaceAll(":", ""),
    scene = given || sceneForDesk(desk, concept);
  const colors =
    scene.colors.length >= 3
      ? scene.colors
      : ["#233e53", "#698a97", "#d6d7c4", "#e7a969"];
  const actual = { ...scene, colors },
    [bg, secondary, main, accent = main] = colors;
  const ratio = (desk.aspect || "16:9").split(":").map(Number);
  const frameHeight = 800 * ratio[1] / ratio[0];
  const zoom = 0.65 + desk.lens / 145,
    sketch = ["chalk", "ink"].includes(scene.medium);
  return (
    <svg
      viewBox={`0 0 800 ${frameHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className="desk-scene-art"
      role={onSelect ? "group" : "img"}
      aria-label={`${scene.label || scene.subject}: ${scene.subject} in ${scene.setting}, ${scene.medium} illustration`}
      style={{ background: bg, filter: `saturate(${0.25 + desk.saturation / 75})` }}
    >
      <defs>
        <linearGradient id={`${id}-material`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={main} />
          <stop offset=".4" stopColor={main} />
          <stop offset="1" stopColor={secondary} />
        </linearGradient>
        <linearGradient id={`${id}-sky`} x2="0" y2="1">
          <stop stopColor={bg} />
          <stop offset="1" stopColor={secondary} />
        </linearGradient>
        <radialGradient id={`${id}-light`}>
          <stop
            stopColor={desk.light === "neon" ? accent : desk.light === "golden" ? "#efbb83" : "#d5e3f2"}
            stopOpacity={desk.light === "silhouette" ? ".15" : ".5"}
          />
          <stop offset="1" stopColor={main} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-edge`}>
          <stop offset=".4" stopColor={bg} stopOpacity="0" />
          <stop
            offset="1"
            stopColor={bg}
            stopOpacity={scene.medium === "cinema" ? ".3" : ".1"}
          />
        </radialGradient>
        <pattern
          id={`${id}-paper`}
          width="17"
          height="13"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M2 3h2M10 8h3"
            stroke={main}
            strokeOpacity=".12"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <g transform={`scale(1 ${frameHeight/450})`}>
      <rect width="800" height="450" fill={sketch ? bg : `url(#${id}-sky)`} />
      {!graph?.nodes?.some(n => n.role === "environment") && <Environment scene={actual} />}
      {scene.night && (
        <rect width="800" height="450" fill="#050a16" opacity=".28" />
      )}
      {scene.night && (
        <circle
          cx={80 + desk.sun * 6.4}
          cy="85"
          r="24"
          fill={main}
          opacity=".7"
        />
      )}
      <ellipse
        cx={80 + desk.sun * 6.4}
        cy={scene.night ? 100 : 40}
        rx={150 + desk.softness * 3}
        ry={230 + desk.softness}
        fill={`url(#${id}-light)`}
      />
      <path
        d={`M${80 + desk.sun * 6.4} 0L${140 + desk.sun * 3} 450H${400 + desk.sun * 4}Z`}
        fill={main}
        opacity={desk.light === "rim" ? 0.04 : 0.075}
      />
      <ellipse
        cx={400 + (50 - desk.sun)}
        cy="366"
        rx={90 + desk.softness}
        ry={10 + desk.softness / 5}
        fill={bg}
        opacity=".45"
      />
      </g>
      {graph?.nodes?.length ? <SceneObjects frameHeight={frameHeight} graph={graph} imageReferences={imageReferences} desk={desk} scene={actual} mode={mode} selected={selected} onSelect={onSelect} onPreviewNode={onPreviewNode} onCommitNode={onCommitNode}
        fallbackEnvironment={node => <Environment scene={{...actual, setting:node.kind}} />}
        fallbackSubject={node => <Subject scene={{...actual,subject:node.kind,count:1,covered:/hijab|حجاب/i.test(node.design)}} desk={desk} material={`${id}-material`} />}
      /> : <>      <g
        transform={`translate(${400 + (desk.orbit - 50) * 1.3} ${frameHeight*.65 + (desk.angle - 50) * 0.22}) scale(${zoom}) rotate(${(desk.angle - 50) * 0.065})`}
      >
        {reference && ["person", "group"].includes(scene.subject) ? (
          <image
            href={reference}
            x="-66"
            y="-215"
            width="132"
            height="215"
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <Subject scene={actual} desk={desk} material={`${id}-material`} />
        )}
      </g>
</>}
      <g pointerEvents="none" transform={`scale(1 ${frameHeight/450})`}>
      {scene.medium === "paint" && (
        <g fill="none" strokeLinecap="round">
          {Array.from({ length: 30 }, (_, i) => (
            <path
              key={i}
              d={`M${(i * 37) % 800} ${(i * 61) % 440}q20 -14 36 2`}
              stroke={i % 2 ? accent : main}
              strokeWidth={4 + (i % 4)}
              opacity=".16"
            />
          ))}
        </g>
      )}
      {["ink", "chalk", "paint", "collage"].includes(scene.medium) && (
        <rect width="800" height="450" fill={`url(#${id}-paper)`} />
      )}
      {scene.atmosphere === "mist" &&
        [240, 295, 345].map((y, i) => (
          <path
            key={y}
            d={`M0 ${y}q180 -20 380 2t420 0`}
            fill="none"
            stroke={main}
            strokeWidth={30 + i * 7}
            opacity=".09"
          />
        ))}
      {scene.atmosphere === "rain" && (
        <g stroke={main} strokeOpacity=".25">
          {Array.from({ length: 45 }, (_, i) => (
            <path key={i} d={`M${(i * 97) % 800} ${(i * 73) % 450}l-8 23`} />
          ))}
        </g>
      )}
      {["stars", "glitter"].includes(scene.atmosphere) && (
        <g fill={accent}>
          {Array.from({ length: 42 }, (_, i) => (
            <g
              key={i}
              transform={`translate(${((i * 137) % 790) + 5} ${((i * 83) % 430) + 5})`}
            >
              <circle r={(i % 3) + 1} opacity=".65" />
              {i % 5 === 0 && <path d="M0-7L2-2L7 0L2 2L0 7L-2 2L-7 0L-2-2Z" />}
            </g>
          ))}
        </g>
      )}
      <rect width="800" height="450" fill={`url(#${id}-edge)`} />
      {scene.medium === "cinema" && (
        <g fill={bg} opacity=".65">
          <rect width="800" height="20" />
          <rect y="430" width="800" height="20" />
        </g>
      )}
      </g>
    </svg>
  );
}
