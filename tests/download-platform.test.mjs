import test from 'node:test';import assert from 'node:assert/strict';import {downloadDevice} from '../shared/download-platform.mjs';
test('desktop download recommendations distinguish Windows, Mac, Linux and unknown systems',()=>{
 for(const [platform,expected] of [['Win32','windows'],['MacIntel','mac'],['Linux x86_64','linux'],['','unknown']])assert.equal(downloadDevice({platform}).platform,expected==='unknown'?null:expected);
 assert.equal(downloadDevice({userAgent:'Mozilla/5.0 (X11; CrOS x86_64)',platform:'Linux x86_64'}).platform,null);
});
test('mobile visitors never receive a desktop OS recommendation, including desktop-mode iPad',()=>{
 for(const device of [{userAgent:'Android Linux Mobile'},{userAgent:'iPhone'},{platform:'MacIntel',maxTouchPoints:5},{userAgentData:{platform:'Android',mobile:true}}])assert.deepEqual(downloadDevice(device),{mobile:true,platform:null});
 assert.deepEqual(downloadDevice({userAgentData:{platform:'Windows',mobile:false}}),{mobile:false,platform:'windows'});
});
