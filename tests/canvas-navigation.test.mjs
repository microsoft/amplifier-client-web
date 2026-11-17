import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasNavigationKey,readCanvasNavigation,resolveCanvasNavigation,canvasTabLabels} from '../src/canvas-navigation.js';

test('Auto needs both roomy dimensions, and leaves on narrow OR short',()=>{
 for(const [width,height,expected] of [[980,640,'tabs'],[979,1000,'compact'],[1200,639,'compact'],[400,400,'compact']])
  assert.equal(resolveCanvasNavigation('auto',width,height),expected);
 assert.equal(resolveCanvasNavigation('auto',899,800,'tabs'),'compact');
 assert.equal(resolveCanvasNavigation('auto',1200,559,'tabs'),'compact');
});
test('Auto hysteresis holds either layout inside the buffer',()=>{
 assert.equal(resolveCanvasNavigation('auto',940,600,'tabs'),'tabs');
 assert.equal(resolveCanvasNavigation('auto',940,600,'compact'),'compact');
 assert.equal(resolveCanvasNavigation('auto',900,560,'tabs'),'tabs');
 assert.equal(resolveCanvasNavigation('auto',980,640,'compact'),'tabs');
});
test('explicit browser choice wins every pane size, invalid/unavailable storage uses Auto',()=>{
 for(const choice of ['tabs','compact']){
  for(const [width,height] of [[300,200],[2000,1200]])assert.equal(resolveCanvasNavigation(choice,width,height),choice);
  assert.equal(readCanvasNavigation({getItem:key=>{assert.equal(key,canvasNavigationKey);return choice}}),choice);
 }
 assert.equal(readCanvasNavigation({getItem:()=>{throw Error('disabled')}}),'auto');
 assert.equal(readCanvasNavigation({getItem:()=>'{invalid'}),'auto');
 assert.equal(readCanvasNavigation(null),'auto');
});
test('shared project prefixes give distinct labels without stripping partial words',()=>{
 assert.deepEqual(canvasTabLabels([{title:'Project — Palette studies'},{title:'Project — Lighting notes'}]),['Palette studies','Lighting notes']);
 assert.deepEqual(canvasTabLabels([{title:'Project alpha'},{title:'Project beta'}]),['Project alpha','Project beta']);
 assert.deepEqual(canvasTabLabels([{title:'Project — Palette studies'}]),['Project — Palette studies']);
 assert.deepEqual(canvasTabLabels([{title:'Project — Same'},{title:'Project — Same'}]),['Same','Same']);
});