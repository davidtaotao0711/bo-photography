import test from 'node:test';
import assert from 'node:assert/strict';
import * as canvas from '../src/utils/gallery-canvas.js';
import { readFileSync } from 'node:fs';
import { arrangeCanvasRows, canvasRectStyle, isGalleryKey, normalizeCanvasRect, resolveCanvasLayout, snapCanvasRect, validateCanvasLayout } from '../src/utils/gallery-canvas.js';

const photos = ['a', 'b', 'c', 'd'].map((id) => ({ id, image: `${id}.jpg`, orientation: 'landscape' }));
const original = { version: 1, items: [
  { photoId: 'a', x: 50, y: 10, width: 280, height: 180 },
  { photoId: 'b', x: 370, y: 10, width: 280, height: 420 },
  { photoId: 'c', x: 690, y: 10, width: 280, height: 180 },
] };

test('saved editor rectangles are exactly the public rectangles at any desktop width', () => {
  const editor = resolveCanvasLayout(original, photos.slice(0, 3));
  const publicPage = resolveCanvasLayout(JSON.parse(JSON.stringify(original)), photos.slice(0, 3));
  assert.deepEqual(editor, publicPage);
  for (const viewport of [600, 845, 1325, 1920]) {
    for (const rect of editor.items) {
      const style = Object.fromEntries(canvasRectStyle(rect, editor.height).split(';').map((part) => part.split(':')));
      const actualX = parseFloat(style.left) / 100 * viewport;
      const actualY = parseFloat(style.top) / 100 * viewport * editor.height / 1000;
      assert.ok(Math.abs(actualX - rect.x * viewport / 1000) < 1e-8);
      assert.ok(Math.abs(actualY - rect.y * viewport / 1000) < 1e-8);
    }
  }
});

test('row counts 1 through 6 retain order, natural proportions and aligned tops', () => {
  const items = Array.from({ length: 13 }, (_, i) => ({ photoId: String(i), width: 300, height: i % 2 ? 450 : 200 }));
  for (let count = 1; count <= 6; count++) {
    const result = arrangeCanvasRows(items, count, 24, 40);
    assert.deepEqual(result.map((item) => item.photoId), items.map((item) => item.photoId));
    result.forEach((item, i) => {
      assert.equal(item.y, result[Math.floor(i / count) * count].y);
      assert.ok(Math.abs(item.height / item.width - items[i].height / items[i].width) < 0.0001);
      assert.ok(item.x + item.width <= 1000.02);
    });
  }
});

test('new/deleted photos never repack the remaining saved composition', () => {
  const result = resolveCanvasLayout(original, photos.filter((photo) => photo.id !== 'b'));
  assert.deepEqual(result.items.slice(0, 2), [original.items[0], original.items[2]]);
  assert.equal(result.items[2].photoId, 'd');
  assert.ok(result.items[2].y > original.items[0].y + original.items[0].height);
});

test('snapping exposes canvas center and neighbouring top/edge guides', () => {
  const nearCenter = snapCanvasRect({ x: 348, y: 73, width: 300, height: 200 }, [], 6);
  assert.equal(nearCenter.rect.x, 350);
  assert.ok(nearCenter.guides.some((guide) => guide.axis === 'x' && guide.value === 500));
  const neighbour = snapCanvasRect({ x: 52, y: 13, width: 200, height: 150 }, [original.items[0]], 5);
  assert.equal(neighbour.rect.x, 50);
  assert.equal(neighbour.rect.y, 10);
  const far = snapCanvasRect({ x: 319, y: 73, width: 300, height: 200 }, [], 5);
  assert.deepEqual(far.guides, []);
});

test('normalization and API validation reject invalid geometry and duplicate IDs', () => {
  assert.deepEqual(validateCanvasLayout(original), original);
  for (const item of [{ ...original.items[0], width: -1 }, { ...original.items[0], x: Infinity }, { ...original.items[0], y: -10 }]) {
    assert.throws(() => validateCanvasLayout({ version: 1, items: [item] }));
  }
  assert.throws(() => validateCanvasLayout({ version: 1, items: [original.items[0], original.items[0]] }));
  assert.equal(normalizeCanvasRect({ ...original.items[0], x: 999 }).x, 720);
});

test('ordinary layout keys cannot write Home, Entrance or Portrait Books', () => {
  ['category:street:selected', 'category:nature:archive', 'category:portrait:all', 'series:kashgar-livestock-market'].forEach((key) => assert.ok(isGalleryKey(key)));
  ['home', 'featured', 'portfolio-entrance', 'portrait-book:black-bob', 'category:portrait:selected', '__proto__'].forEach((key) => assert.equal(isGalleryKey(key), false));
});

test('crop and focal point survive save/reload without changing the source photo', () => {
  const item = { ...original.items[0], crop: true, focalX: 21, focalY: 76 };
  const saved = validateCanvasLayout({ version: 1, items: [item] });
  assert.deepEqual(saved.items[0], item);
  const image = canvas.canvasImageLayout(item, { layout: { crop: false } });
  assert.equal(image.fit, 'cover');
  assert.equal(image.focalX, 21);
});

test('removing a photo from this page does not append it again or mutate its library record', () => {
  const layout = { version: 1, items: original.items.slice(1), hiddenPhotoIds: ['a'] };
  const resolved = resolveCanvasLayout(layout, photos.slice(0, 3));
  assert.deepEqual(resolved.items.map((item) => item.photoId), ['b', 'c']);
  assert.deepEqual(resolved.hiddenPhotoIds, ['a']);
  assert.equal(photos[0].id, 'a');
});

test('proportional resize snaps its bottom edge and displays a horizontal guide', () => {
  const item = { photoId: 'a', x: 10, y: 20, width: 200, height: 300 };
  const result = canvas.resizeCanvasRect(item, 19, 28, [{ x: 600, y: 500, width: 200, height: 350 }], { threshold: 5 });
  // The peer's bottom is 850, top is 500: use a closer peer top at 350.
  const close = canvas.resizeCanvasRect(item, 19, 28, [{ x: 600, y: 350, width: 200, height: 350 }], { threshold: 5 });
  assert.equal(close.rect.y + close.rect.height, 350);
  assert.ok(close.guides.some((guide) => guide.axis === 'y' && guide.value === 350));
  assert.equal(result.rect.x, item.x);
  assert.ok(Math.abs(close.rect.height / close.rect.width - 1.5) < 0.001);
});

test('crop frame can resize height independently and pan stays inside the photograph', () => {
  const item = { photoId: 'a', x: 10, y: 20, width: 200, height: 300, crop: true, focalX: 50, focalY: 50 };
  const resized = canvas.resizeCanvasRect(item, 0, -60, [], { free: true, snap: false });
  assert.equal(resized.rect.width, 200);
  assert.equal(resized.rect.height, 240);
  const panned = canvas.panCanvasCrop(item, 10000, 10000, 2);
  assert.equal(panned.focalX, 0);
  assert.ok(panned.focalY >= 0 && panned.focalY <= 100);
});

test('held arrow-key acceleration is gradual, bounded and resets at a new press', () => {
  assert.equal(canvas.canvasNudgeStep(0), 1);
  assert.ok(canvas.canvasNudgeStep(900) > canvas.canvasNudgeStep(200));
  assert.ok(canvas.canvasNudgeStep(2500) > canvas.canvasNudgeStep(900));
  assert.ok(canvas.canvasNudgeStep(100000, true) <= 80);
  assert.equal(canvas.canvasNudgeStep(0), 1);
});

test('the actual editor keyboard handler accelerates repeats and creates one undo step per hold', () => {
  const source = readFileSync(new URL('../src/scripts/gallery-canvas-editor.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function keyboard(event) {');
  const handler = source.slice(start, source.indexOf('\n  async function action(', start));
  const make = new Function('canvasNudgeStep', 'normalizeCanvasRect', `
    let heldNudge, cropId = '', gesture, mobile = false, snapshots = 0;
    const selected = new Set(['a']);
    const model = { items: [{ photoId:'a', x:0, y:0, width:200, height:200 }] };
    const bounds = (items) => items[0];
    const remember = () => { snapshots++; };
    const changed = () => {};
    const positionItems = () => {};
    ${handler}
    return { run: keyboard, state: () => ({ y:model.items[0].y, snapshots }) };
  `);
  const editor = make(canvas.canvasNudgeStep, normalizeCanvasRect);
  const event = (timeStamp, repeat) => ({ key:'ArrowDown', timeStamp, repeat, shiftKey:false, preventDefault(){}, target:{ closest(){ return null; } } });
  editor.run(event(0, false));
  assert.equal(editor.state().y, 1);
  editor.run(event(1000, true));
  assert.equal(editor.state().y, 5);
  editor.run(event(2500, true));
  assert.equal(editor.state().y, 21);
  assert.equal(editor.state().snapshots, 1);
  editor.run(event(3000, false));
  assert.equal(editor.state().y, 22);
  assert.equal(editor.state().snapshots, 2);
});

test('photo actions stay inside the bottom inset, including expanded crop controls', () => {
  const source = readFileSync(new URL('../src/scripts/gallery-canvas-editor.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function positionTools() {');
  const handler = source.slice(start, source.indexOf('\n  function paint()', start));
  const make = new Function('box', 'toolbarHeight', 'cropping', `
    const selected = new Set(['a']), mobile = false, cropId = cropping ? 'a' : '';
    const tools = { hidden: true, style: {}, offsetHeight: toolbarHeight,
      querySelector: () => ({ classList: { toggle(){} }, hidden: false }) };
    const host = { isConnected: true,
      querySelector: (selector) => selector === '[data-canvas-photo-tools]' ? tools : null,
      querySelectorAll: () => [{ dataset: { canvasId:'a' }, getBoundingClientRect: () => box }] };
    const window = { innerHeight: 900, innerWidth: 1200 };
    ${handler}
    positionTools(); return tools;
  `);
  const photo = { left:66, top:250, bottom:826, width:470, height:576 };
  for (const [height, crop] of [[34, false], [54, true]]) {
    const tools = make(photo, height, crop);
    assert.equal(tools.hidden, false);
    assert.equal(tools.style.left, '86px');
    assert.equal(tools.style.width, '430px');
    assert.equal(parseFloat(tools.style.top) + height, photo.bottom - 8);
    assert.ok(parseFloat(tools.style.top) > photo.top);
  }
});
