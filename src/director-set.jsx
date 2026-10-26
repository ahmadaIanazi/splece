import React, { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Plane, Vector3 } from "three";

const garmentColors = {
  sage: "#87a995",
  blue: "#799fc8",
  rose: "#bc8c9d",
  sand: "#b9a383",
};
function Draggable({ children, onMove, onEnd, position }) {
  const dragging = useRef(false),
    plane = new Plane(new Vector3(0, 1, 0), -0.15);
  return (
    <group
      position={position}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        e.target.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        e.stopPropagation();
        const p = e.ray.intersectPlane(plane, new Vector3());
        if (p) onMove(p);
      }}
      onPointerUp={(e) => {
        if (dragging.current) {
          e.stopPropagation();
          onEnd();
          dragging.current = false;
          e.target.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        dragging.current = false;
        onEnd();
      }}
    >
      {children}
    </group>
  );
}
function StageObjects({ desk }) {
  const nodes = desk.sceneGraph?.nodes || [];
  if (!nodes.length) return null;
  return nodes.map((n) => (
    <group
      key={n.id}
      position={[n.x, n.y, n.z]}
      scale={n.scale}
      rotation={[0, (n.turn * Math.PI) / 180, 0]}
    >
      {n.role === "environment" ? (
        <mesh position={[0, 0.65, 0]}>
          <boxGeometry args={[3, 1.3, 0.15]} />
          <meshStandardMaterial
            color={desk.previewScene?.colors?.[1] || "#536477"}
            transparent
            opacity={0.5}
          />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 0.75, 0]} castShadow>
            {["person", "group", "zombie"].includes(n.kind) ? (
              <cylinderGeometry args={[0.25, 0.35, 1.5, 12]} />
            ) : n.kind === "bottle" ? (
              <boxGeometry args={[0.7, 1.5, 0.55]} />
            ) : (
              <icosahedronGeometry args={[0.7, 0]} />
            )}
            <meshStandardMaterial
              color={desk.previewScene?.colors?.[2] || "#a7bcc7"}
            />
          </mesh>
          {["person", "group", "zombie"].includes(n.kind) && (
            <mesh position={[0, 1.75, 0]}>
              <sphereGeometry args={[0.25, 16, 12]} />
              <meshStandardMaterial
                color={n.kind === "zombie" ? "#839b82" : "#b6aaa0"}
              />
            </mesh>
          )}
        </>
      )}
    </group>
  ));
}
function Stage({ desk, onPreview, onCommit }) {
  const subject = desk.previewScene?.subject || "abstract";
  const person = ["person", "group", "zombie"].includes(subject);
  const last = useRef({}),
    turn = useRef(null);
  const rad = ((desk.orbit - 50) / 100) * Math.PI * 2;
  const lightRad = (desk.sun / 100) * Math.PI;
  const move = (patch) => {
    last.current = patch;
    onPreview(patch);
  };
  return (
    <>
      <ambientLight intensity={0.5 + desk.softness / 200} />
      <directionalLight
        position={[Math.cos(lightRad) * 4, 3 + Math.sin(lightRad) * 3, -2]}
        intensity={desk.light === "silhouette" ? 1.1 : 2}
        castShadow
        shadow-mapSize={[512, 512]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[3.5, 48]} />
        <meshStandardMaterial color="#333b3f" roughness={1} />
      </mesh>
      <gridHelper
        args={[6, 12, "#647171", "#465052"]}
        position={[0, 0.015, 0]}
      />
      {desk.sceneGraph?.nodes?.length ? (
        <StageObjects desk={desk} />
      ) : (
        <>
          <group
            rotation={[0, (desk.turn * Math.PI) / 180, 0]}
            onPointerDown={(e) => {
              e.stopPropagation();
              turn.current = { x: e.clientX, value: desk.turn };
              e.target.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (turn.current) {
                e.stopPropagation();
                move({
                  turn:
                    (turn.current.value +
                      (e.clientX - turn.current.x) * 2 +
                      720) %
                    360,
                });
              }
            }}
            onPointerUp={(e) => {
              if (turn.current) {
                onCommit(last.current);
                turn.current = null;
                e.target.releasePointerCapture(e.pointerId);
              }
            }}
          >
            {person ? (
              <>
                <mesh position={[0, 1.05, 0]} castShadow>
                  <cylinderGeometry
                    args={[
                      0.27,
                      desk.garment === "abaya" || desk.garment === "dress"
                        ? 0.48
                        : 0.29,
                      1.35,
                      24,
                    ]}
                  />
                  <meshStandardMaterial
                    color={garmentColors[desk.garmentColor]}
                  />
                </mesh>
                <mesh position={[0, 1.99, 0]} castShadow>
                  <sphereGeometry args={[0.27, 24, 16]} />
                  <meshStandardMaterial
                    color={subject === "zombie" ? "#839b82" : "#b6aaa0"}
                  />
                </mesh>
                {(desk.previewScene?.covered ||
                  /hijab|حجاب/i.test(desk.facts.wardrobe)) && (
                  <mesh position={[0, 2.04, -0.06]}>
                    <sphereGeometry args={[0.3, 24, 16, 0, Math.PI * 1.6]} />
                    <meshStandardMaterial
                      color={garmentColors[desk.garmentColor]}
                    />
                  </mesh>
                )}
                {[-0.18, 0.18].map((x) => (
                  <mesh key={x} position={[x, 0.2, 0]} castShadow>
                    <capsuleGeometry args={[0.09, 0.25, 4, 8]} />
                    <meshStandardMaterial color="#252c35" />
                  </mesh>
                ))}
              </>
            ) : (
              <group position={[0, 0.9, 0]}>
                <mesh castShadow>
                  {subject === "bottle" ? (
                    <boxGeometry args={[0.8, 1.4, 0.6]} />
                  ) : subject === "car" || subject === "shoe" ? (
                    <boxGeometry args={[1.8, 0.6, 0.8]} />
                  ) : subject === "food" ? (
                    <cylinderGeometry args={[0.5, 0.4, 0.8, 24]} />
                  ) : (
                    <icosahedronGeometry args={[0.8, 0]} />
                  )}
                  <meshStandardMaterial
                    color={desk.previewScene?.colors?.[2] || "#a7bcc7"}
                    roughness={0.45}
                  />
                </mesh>
                {subject === "bottle" && (
                  <mesh position={[0, 0.85, 0]}>
                    <boxGeometry args={[0.5, 0.3, 0.5]} />
                    <meshStandardMaterial
                      color={desk.previewScene?.colors?.[1] || "#536477"}
                    />
                  </mesh>
                )}
              </group>
            )}
          </group>
        </>
      )}
      <Draggable
        position={[Math.sin(rad) * 2.5, 0.55, Math.cos(rad) * 2.5]}
        onMove={(p) =>
          move({
            orbit: Math.max(
              0,
              Math.min(100, 50 + (Math.atan2(p.x, p.z) / Math.PI) * 50),
            ),
            path: [],
          })
        }
        onEnd={() => onCommit(last.current)}
      >
        <group rotation={[0, rad, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.6, 0.35, 0.35]} />
            <meshStandardMaterial color="#9dbdf3" />
          </mesh>
          <mesh position={[0, 0, -0.25]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.25, 16]} />
            <meshStandardMaterial color="#364259" />
          </mesh>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.04, 0.12, 0.6, 8]} />
            <meshStandardMaterial color="#78858c" />
          </mesh>
        </group>
      </Draggable>
      <Draggable
        position={[Math.cos(lightRad) * 3, 0.35, -Math.sin(lightRad) * 2]}
        onMove={(p) =>
          move({ sun: Math.max(0, Math.min(100, (1 - p.x / 3) * 50)) })
        }
        onEnd={() => onCommit(last.current)}
      >
        <mesh>
          <sphereGeometry args={[0.17, 16, 12]} />
          <meshStandardMaterial
            color="#f5dc9e"
            emissive="#e7bd63"
            emissiveIntensity={0.6}
          />
        </mesh>
      </Draggable>
    </>
  );
}
export default function VirtualSet(props) {
  return (
    <div
      className="desk-3d"
      aria-label={
        props.desk.sceneGraph?.nodes?.length
          ? "Miniature set: drag the blue camera or golden lamp"
          : "Miniature set: drag the blue camera or golden lamp; drag the subject to turn it"
      }
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        shadows
        camera={{ position: [5, 4.5, 6], fov: 44 }}
        gl={{ powerPreference: "low-power", antialias: true }}
        onCreated={({ camera }) => camera.lookAt(0, 0.7, 0)}
        fallback={<p>Use the 2D controls below on this device.</p>}
      >
        <Stage {...props} />
      </Canvas>
      <span>
        {props.desk.sceneGraph?.nodes?.length
          ? "Drag the camera or lamp · spatial sketch"
          : "Drag the camera, lamp or subject · sketch only"}
      </span>
    </div>
  );
}
