import { PerspectiveCamera, Vector3 } from "three";
// One world and camera for all SVG billboards; no WebGL or animation loop needed.
export function stageCamera(desk, width = 800, height = 450) {
  const orbit = ((desk.orbit - 50) * Math.PI) / 50;
  const elevation = ((50 - desk.angle) * Math.PI) / 180;
  const distance = 8.5;
  const camera = new PerspectiveCamera(
    52 - desk.lens * 0.23,
    width / height,
    0.1,
    50,
  );
  camera.position.set(
    Math.sin(orbit) * distance * Math.cos(elevation),
    1.2 + Math.sin(elevation) * distance,
    Math.cos(orbit) * distance * Math.cos(elevation),
  );
  camera.lookAt(0, 1.2, 0);
  camera.updateMatrixWorld();
  return camera;
}
export function projectNode(node, camera, width = 800, height = 450) {
  const p = new Vector3(node.x, node.y, node.z);
  const bottom = p.clone().project(camera),
    top = p
      .clone()
      .add(new Vector3(0, 2 * node.scale, 0))
      .project(camera);
  return {
    x: ((bottom.x + 1) * width) / 2,
    y: ((1 - bottom.y) * height) / 2,
    scale: Math.max(
      0.05,
      Math.min(4, (Math.abs(bottom.y - top.y) * height) / 2 / 180),
    ),
    depth: p.distanceToSquared(camera.position),
    visible: bottom.z > -1 && bottom.z < 1,
  };
}
export function dragOnStage(node, dx, dy, desk) {
  const rad = ((desk.orbit - 50) * Math.PI) / 50;
  return {
    x: node.x + dx * Math.cos(rad) + dy * Math.sin(rad),
    z: node.z - dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

// Fit the ensemble, not each object: relative scale/order survive reframing.
// The environment remains a backdrop even when the camera crosses behind it.
export function frameScene(nodes, desk, width = 800, height = 450) {
  const camera = stageCamera(desk),
    raw = nodes.map((node) => ({ node, p: projectNode(node, camera) }));
  const actors = raw.filter(
    ({ node, p }) => node.role !== "environment" && p.visible,
  );
  const cast = actors.length ? actors : raw;
  const minX = Math.min(...cast.map(({ p }) => p.x - 75 * p.scale)),
    maxX = Math.max(...cast.map(({ p }) => p.x + 75 * p.scale));
  const minY = Math.min(...cast.map(({ p }) => p.y - 180 * p.scale)),
    maxY = Math.max(...cast.map(({ p }) => p.y));
  const fit = cast.length
    ? Math.min(
        (width * 0.84) / Math.max(1, maxX - minX),
        (height * 0.67) / Math.max(1, maxY - minY),
      )
    : 1;
  const scale = desk.manualControls?.includes("lens")
    ? Math.min(1, fit)
    : Math.min(1.8, fit);
  const centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  return raw.map(({ node, p }) => ({
    node,
    p:
      node.role === "environment"
        ? {
            ...p,
            x: width / 2,
            y: cast.length
              ? Math.min(height * 0.69, height * 0.48 + (maxY - centerY) * scale + 18)
              : height * 0.69,
            scale: Math.min(width / 530, (height * 0.58) / 220),
            visible: true,
          }
        : {
            ...p,
            x: width / 2 + (p.x - centerX) * scale,
            y: height * 0.48 + (p.y - centerY) * scale,
            scale: p.scale * scale,
          },
  }));
}
