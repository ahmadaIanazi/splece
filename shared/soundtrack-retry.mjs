// Shared failure labels also recognise older saved jobs that only stored text.
export function soundFailure(value = {}) {
  const message =
    typeof value === "string" ? value : value.error || value.message || "";
  const code =
    value.errorCode ||
    value.code ||
    (/content checker|content.?policy|flagged by|content.?moderation/i.test(
      message,
    )
      ? "content_policy"
      : /422|validation/i.test(message)
        ? "validation"
        : "request_failed");
  const fields =
    value.errorFields ||
    value.fields ||
    ["prompt", "video_url"].filter((f) => message.includes(`body.${f}`));
  return {
    code,
    fields,
    message,
    terminal:
      !!value.terminal || ["content_policy", "validation"].includes(code),
  };
}

// The documented MMAudio request contract. No invented provider options.
export function validateSoundInput(input) {
  const fields = [
    "video_url",
    "prompt",
    "negative_prompt",
    "duration",
    "seed",
    "num_steps",
    "cfg_strength",
    "mask_away_clip",
  ];
  const fail = (field, reason) => {
    throw Object.assign(Error(`Sound input · ${field}: ${reason}`), {
      code: "validation",
      fields: [field],
      terminal: true,
    });
  };
  for (const key of Object.keys(input || {}))
    if (!fields.includes(key)) fail(key, "unsupported model option");
  for (const key of ["video_url", "prompt"])
    if (typeof input?.[key] !== "string" || !input[key].trim())
      fail(key, "required text value");
  if (
    !/^https?:\/\//.test(input.video_url) &&
    !/^data:video\/mp4;base64,[A-Za-z0-9+/]+=*$/.test(input.video_url)
  )
    fail("video_url", "use a hosted video or an MP4 data URI");
  for (const [key, min, max, integer] of [
    ["duration", 1, 30, false],
    ["num_steps", 4, 50, true],
    ["cfg_strength", 0, 20, false],
    ["seed", 0, 65535, true],
  ]) {
    if (input[key] === undefined || (key === "seed" && input[key] === null))
      continue;
    if (
      !Number.isFinite(input[key]) ||
      input[key] < min ||
      input[key] > max ||
      (integer && !Number.isInteger(input[key]))
    )
      fail(
        key,
        `must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`,
      );
  }
  if (
    input.negative_prompt !== undefined &&
    typeof input.negative_prompt !== "string"
  )
    fail("negative_prompt", "must be text");
  if (
    input.mask_away_clip !== undefined &&
    typeof input.mask_away_clip !== "boolean"
  )
    fail("mask_away_clip", "must be true or false");
  return input;
}

// Safe to repeat reads/downloads, never an unconfirmed submission.
export function transientSoundRead(error) {
  return !error?.terminal && /timeout|timed out|aborted|fetch failed|network|429|\b50[234]\b/i.test(String(error?.message || error || ""));
}
