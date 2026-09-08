import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built = await build({entryPoints:['shared/locations.ts'],bundle:true,format:'esm',write:false});
const {nodeLocation, groupLocations, globePosition} = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const node = {region:'HK',latitude:null,longitude:null,location:'',archived:false};
test('regional fallback is explicitly approximate and unknown regions stay unlocated',()=>{
  assert.equal(nodeLocation(node).approximate,true);
  assert.equal(nodeLocation({...node,region:'ZZ'}),null);
  assert.equal(nodeLocation({...node,latitude:0,longitude:0}).approximate,false);
  const groups=groupLocations([node,{...node,name:'second'}, {...node,archived:true}, {...node,latitude:0,longitude:0}]);
  assert.equal(groups.length,2);
  assert.equal(groups[0].nodes.length,2);
});
test('latitude longitude projection matches equirectangular Earth texture orientation',()=>{
  assert.deepEqual(globePosition(0,0),[1,0,-0]);
  const east=globePosition(0,90);
  assert.ok(Math.abs(east[0])<1e-10 && Math.abs(east[2]+1)<1e-10);
  const north=globePosition(90,0);
  assert.ok(Math.abs(north[1]-1)<1e-10);
});
