import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';

const helperPath = 'src/components/realtimeJourney.ts';
let journey = {};
if (fs.existsSync(helperPath)) {
  const result = await build({ entryPoints: [helperPath], bundle: true, write: false, format: 'esm', platform: 'node' });
  journey = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const api = name => { assert.equal(typeof journey[name], 'function', name + ' behavior is missing'); return journey[name]; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('deadline rejects a stalled attempt, aborts work, and clears timer after success', async () => {
  const start = api('startBoundedLoad');
  let signal;
  const stalled = start(s => { signal = s; return new Promise(() => {}); }, 15);
  await assert.rejects(stalled.promise, /timed out/i);
  assert.equal(signal.aborted, true);
  const success = start(async () => 'ready', 15);
  assert.equal(await success.promise, 'ready');
  await sleep(25);
  assert.equal(success.signal.aborted, false);
});
test('cancel interrupts pending work and retry reuses only completed resources', async () => {
  const start = api('startBoundedLoad'), cache = api('createResourceCache')();
  let downloads = 0;
  assert.equal(await cache.load('ok', async () => ++downloads), 1);
  assert.equal(await cache.load('ok', async () => ++downloads), 1);
  await assert.rejects(cache.load('fail', async () => { throw Error('download'); }));
  assert.equal(await cache.load('fail', async () => 'retry'), 'retry');
  const attempt = start(() => new Promise(() => {}), 1000);
  attempt.cancel();
  await assert.rejects(attempt.promise, /cancel/i);
  assert.equal(attempt.signal.aborted, true);
});
test('explicit invalid-data retry evicts stale successes and late old completions', async () => {
  const cache = api('createResourceCache')();
  assert.equal(await cache.load('metadata', async () => 'old-source-hash'), 'old-source-hash');
  let release;
  const oldDownload = cache.load('binary', () => new Promise(resolve => { release = resolve; }));
  assert.equal(typeof cache.invalidate, 'function', 'completed resource invalidation is missing');
  cache.invalidate();
  assert.equal(await cache.load('metadata', async () => 'fixed-source-hash'), 'fixed-source-hash');
  assert.equal(await cache.load('binary', async () => 'fixed-binary'), 'fixed-binary');
  release('obsolete-binary');
  await oldDownload;
  assert.equal(await cache.load('binary', async () => 'unexpected-download'), 'fixed-binary');
});
test('failed work aborts its remaining concurrent requests', async () => {
  const attempt = api('startBoundedLoad')(async () => { throw Error('decode failed'); }, 1000);
  await assert.rejects(attempt.promise, /decode failed/);
  assert.equal(attempt.signal.aborted, true);
});
test('cleanup before the attempt starts does not initiate expensive work', async () => {
  let launched = false;
  const attempt = api('startBoundedLoad')(async () => { launched = true; }, 1000);
  attempt.cancel();
  await assert.rejects(attempt.promise, /cancel/i);
  assert.equal(launched, false);
});
test('latest direct chapter request snaps even to the current in-flight destination', () => {
  const request = api('requestNavigation'), apply = api('applyNavigation');
  let state = { chapter: 'paper-a', instant: false, id: 0 };
  state = request(state, 'paper-c', false);
  const cinematic = apply(state, 123, { 'paper-c': 288 }, false);
  assert.equal(cinematic.frame, 123); assert.equal(cinematic.flight.to, 288);
  const repeated = request(state, 'paper-c', true);
  assert.ok(repeated.id > state.id);
  assert.deepEqual(apply(repeated, 180, { 'paper-c': 288 }, false), { frame: 288, flight: null });
  const latest = request(repeated, 'paper-a', true);
  assert.equal(apply(latest, 200, { 'paper-a': 109 }, false).frame, 109);
  assert.deepEqual(apply(state, 180, { 'paper-c': 288 }, true), { frame: 288, flight: null });
});

// Read actual GLB POSITION data and every ancestor transform; no Box3 approximation.
const glb = fs.readFileSync('public/assets/realtime/room.glb');
const jsonLength = glb.readUInt32LE(12);
const model = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
const binary = glb.subarray(28 + jsonLength);
const subjects = new Map();
function visit(index, parent) {
  const node = model.nodes[index], local = new Matrix4();
  if (node.matrix) local.fromArray(node.matrix);
  else local.compose(new Vector3().fromArray(node.translation ?? [0,0,0]),
    new Quaternion().fromArray(node.rotation ?? [0,0,0,1]), new Vector3().fromArray(node.scale ?? [1,1,1]));
  const world = parent.clone().multiply(local);
  const name = (node.name ?? '').replaceAll('_', ' ');
  if (node.mesh != null && (/hero surface|Monitor warm display/.test(name))) {
    const points = [];
    for (const primitive of model.meshes[node.mesh].primitives) {
      const accessor = model.accessors[primitive.attributes.POSITION], view = model.bufferViews[accessor.bufferView];
      assert.equal(accessor.componentType, 5126);
      const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = view.byteStride ?? 12;
      for (let n=0; n<accessor.count; n++) points.push(new Vector3(
        binary.readFloatLE(offset+n*stride), binary.readFloatLE(offset+n*stride+4), binary.readFloatLE(offset+n*stride+8)).applyMatrix4(world));
    }
    subjects.set(name, points);
  }
  for (const child of node.children ?? []) visit(child, world);
}
for (const root of model.scenes[model.scene ?? 0].nodes) visit(root, new Matrix4());
const scene = JSON.parse(fs.readFileSync('public/assets/realtime/scene.json'));
const chapterSubjects = Object.entries(scene.stops).filter(([chapter]) => chapter !== 'intro').map(([chapter, frame], i) =>
  ({ chapter, frame, points: [...subjects.entries()].find(([name]) => chapter === 'screen' ? name.includes('Monitor warm display') : name.includes('Paper ' + String.fromCharCode(65+i)))[1] }));
function cameraFor(sample, width, height, projection) {
  const camera = new PerspectiveCamera(projection.fov, width/height, .025, 55);
  camera.position.fromArray(sample.position); camera.quaternion.fromArray(sample.quaternion);
  camera.zoom = projection.zoom;
  if (projection.offsetY) camera.setViewOffset(width,height,0,projection.offsetY,width,height);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return camera;
}
function bounds(camera, points, width, height) {
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for (const point of points) {
    const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
    assert.ok(depth > .025);
    const p = point.clone().project(camera), x=(p.x+1)*width/2,y=(1-p.y)*height/2;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  return {left,right,top,bottom};
}
test('native landscape and portrait preserve all authored camera stops exactly', () => {
  const projection = api('cameraProjection');
  for (const [width,height] of [[1920,1080],[816,1456]]) for (const frame of Object.values(scene.stops)) {
    const sample = scene.camera.frames.find(s=>s.frame===frame), lens=width>=height?sample.landscapeLens:sample.portraitLens;
    const p=projection(width,height,lens,scene.camera.sensorWidth,frame,scene.stops);
    const native=2*Math.atan(scene.camera.sensorWidth/(2*lens*(width/height)))*180/Math.PI;
    assert.ok(Math.abs(p.fov-native)<1e-8); assert.equal(p.zoom,1); assert.equal(p.offsetY,0);
  }
});
test('actual six hero meshes and monitor fit narrow tablet and compact landscape', () => {
  const projection=api('cameraProjection');
  for (const [width,height] of [[390,844],[1024,768],[844,390]]) for (const {chapter,frame,points} of chapterSubjects) {
    const sample=scene.camera.frames.find(s=>s.frame===frame),lens=width>=height?sample.landscapeLens:sample.portraitLens;
    const p=projection(width,height,lens,scene.camera.sensorWidth,frame,scene.stops);
    const b=bounds(cameraFor(sample,width,height,p),points,width,height);
    const margin=width===390?16:width===1024?12:24;
    assert.ok(b.left>=margin-1 && b.right<=width-margin+1,chapter+' horizontal '+JSON.stringify(b));
    assert.ok(b.top>= (height===390?63:0) && b.bottom<= (height===390?307:height),chapter+' vertical '+JSON.stringify(b));
  }
});
test('short-wide camera adaptation is continuous along final travel and native aspect resize', () => {
  const projection=api('cameraProjection');
  let previous=projection(844,390,36,36,541,scene.stops);
  for(let frame=542;frame<=654;frame++) {
    const sample=scene.camera.frames.find(s=>s.frame===frame);
    const next=projection(844,390,sample.landscapeLens,36,frame,scene.stops);
    assert.ok(Math.abs(next.zoom-previous.zoom)<.005); assert.ok(Math.abs(next.offsetY-previous.offsetY)<.3);
    previous=next;
  }
  const native=projection(16/9*390,390,36,36,109,scene.stops);
  const near=projection(16/9*390+.1,390,36,36,109,scene.stops);
  assert.ok(Math.abs(near.zoom-native.zoom)<1e-5);
});
