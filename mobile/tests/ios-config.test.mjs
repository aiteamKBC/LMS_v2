import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const mobileRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
// Resolve the actual SDK dependencies through the installed Expo package.
const expoRequire=createRequire(require.resolve('expo/package.json'));
const {getPrebuildConfigAsync}=expoRequire('@expo/prebuild-config');
const {compileModsAsync}=expoRequire('@expo/config-plugins');
let introspection;
function inspectConfig(){
 return introspection??=(async()=>{
  const previousOffline=process.env.EXPO_OFFLINE;
  const nativePaths=['ios','ios/Podfile','ios/Podfile.lock'].map(name=>path.join(mobileRoot,name));
  const existed=nativePaths.map(name=>fs.existsSync(name));
  const gradlePath=path.join(mobileRoot,'android/app/build.gradle');
  const nativeAndroid=fs.readFileSync(gradlePath,'utf8');
  process.env.EXPO_OFFLINE='1';
  try{
   // Same installed prebuild/plugin pipeline as expo config --type introspect.
   // Introspection removes dangerous mods and evaluates native output in memory.
   const config=await getPrebuildConfigAsync(mobileRoot,{platforms:['ios','android']});
   const exp=await compileModsAsync(config.exp,{
    projectRoot:mobileRoot,introspect:true,platforms:['ios','android'],
    assertMissingModProviders:false,
   });
   assert.deepEqual(nativePaths.map(name=>fs.existsSync(name)),existed,'introspection must not create an iOS project');
   assert.equal(fs.readFileSync(gradlePath,'utf8'),nativeAndroid,'introspection must not rewrite native Android configuration');
   const plist=exp._internal?.modResults?.ios?.infoPlist;
   assert(plist&&typeof plist==='object','assert the evaluated Info.plist, not source app.json');
   return{exp,plist,nativeAndroid};
  }finally{
   if(previousOffline===undefined)delete process.env.EXPO_OFFLINE;
   else process.env.EXPO_OFFLINE=previousOffline;
  }
 })();
}

test('evaluated iOS plugins preserve both dictation usage descriptions',async()=>{
 const {plist}=await inspectConfig();
 // A raw app.json assertion misses the previous expo-audio microphonePermission:false
 // override, which removed this key while the source Info.plist still contained it.
 assert.equal(plist.NSMicrophoneUsageDescription,'Allow KBC Learn to hear the answers you choose to dictate.');
 assert.equal(plist.NSSpeechRecognitionUsageDescription,'Allow KBC Learn to turn your spoken answers into text.');
});

test('evaluated iOS output has KBC branding, bundle identity and a valid build number',async()=>{
 const {exp,plist}=await inspectConfig();
 assert.equal(plist.CFBundleDisplayName,'KBC Learn');
 assert.equal(exp.ios.bundleIdentifier,'com.kentbusinesscollege.learn');
 assert(plist.CFBundleURLTypes.some(row=>row.CFBundleURLSchemes?.includes('com.kentbusinesscollege.learn')));
 assert.match(plist.CFBundleVersion,/^[1-9]\d*$/);
 assert.equal(plist.CFBundleVersion,exp.ios.buildNumber);
 assert.equal(plist.CFBundleShortVersionString,exp.version);
});

test('evaluated iOS plugins use audio-only background modes without remote notifications',async()=>{
 const {plist}=await inspectConfig();
 assert.deepEqual(plist.UIBackgroundModes,['audio']);
});

test('evaluated iOS transport settings preserve HTTPS while allowing local development networking',async()=>{
 const {plist}=await inspectConfig();
 assert.equal(plist.NSAppTransportSecurity?.NSAllowsArbitraryLoads,false);
 assert.equal(plist.NSAppTransportSecurity?.NSAllowsLocalNetworking,true);
});

test('iOS preparation preserves the existing native Android identity and release metadata',async()=>{
 const {exp,nativeAndroid}=await inspectConfig();
 const applicationId=nativeAndroid.match(/\bapplicationId\s+["']([^"']+)["']/)?.[1];
 const versionName=nativeAndroid.match(/\bversionName\s+["']([^"']+)["']/)?.[1];
 const versionCode=nativeAndroid.match(/\bversionCode\s+(\d+)/)?.[1];
 assert.equal(applicationId,'com.kentbusinesscollege.learn.lmscandidate');
 assert.equal(exp.android.package,applicationId);
 assert(versionCode,'native Android version code exists');
 assert.equal(exp.android.versionCode,Number(versionCode));
 assert(versionName,'native Android version name exists');
 assert.equal(exp.version,versionName);
});

