import test from "node:test";
import assert from "node:assert/strict";
import {isAppleMobile, iosDownload} from "../shared/ios-download.mjs";
test("iOS entry includes desktop-mode iPad without claiming Android or macOS",()=>{
  assert.ok(isAppleMobile({platform:"MacIntel",maxTouchPoints:5}));
  assert.ok(isAppleMobile({userAgent:"iPhone"}));
  assert.equal(isAppleMobile({platform:"MacIntel",maxTouchPoints:0}),false);
  assert.equal(isAppleMobile({userAgent:"Android Mobile"}),false);
});
test("unpublished, unrelated and non-Apple URLs never enable an iOS install CTA",()=>{
  for (const v of [null, {}, "", "https://apps.apple.com/app/id123", "https://testflight.apple.com.example/join/ABCDEFGH","https://testflight.apple.com/join/","https://example.com/beta"]) assert.equal(iosDownload(v),null);
  assert.equal(iosDownload("https://apps.apple.com/us/app/splece/id6829883680").label,"Download on the App Store");
  assert.equal(iosDownload("https://testflight.apple.com/join/AbCd1234").label,"Join the TestFlight beta");
});
