import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
let detectorReady;
self.onmessage = async ({ data: { id, bitmap } }) => {
  try {
    detectorReady ??= (async () =>
      FaceDetector.createFromOptions(
        await FilesetResolver.forVisionTasks("/vision/wasm"),
        {
          baseOptions: {
            modelAssetPath: "/vision/blaze-face.tflite",
            delegate: "CPU",
          },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        },
      ))();
    const detector = await detectorReady;
    const { detections } = detector.detect(bitmap);
    self.postMessage({
      id,
      faces: detections.map((d) => ({
        x: d.boundingBox.originX / bitmap.width,
        y: d.boundingBox.originY / bitmap.height,
        w: d.boundingBox.width / bitmap.width,
        h: d.boundingBox.height / bitmap.height,
        confidence: d.categories[0]?.score,
      })),
    });
  } catch {
    self.postMessage({
      id,
      error:
        "Detection is unavailable. Click directly on the speaker’s face instead.",
    });
  } finally {
    bitmap.close();
  }
};
