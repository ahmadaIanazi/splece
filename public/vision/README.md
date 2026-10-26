# Local face detection

BlazeFace short-range float16 v1, from Google MediaPipe:
https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite

MediaPipe model and package: Apache-2.0. Face detection locates faces; it does not identify people. Splece runs it locally, in a worker, only while choosing a speaker. No image is sent to Google.
The pinned @mediapipe/tasks-vision package supplies the WASM runtime; `scripts/prepare-vision.mjs` copies it during dev/build.
