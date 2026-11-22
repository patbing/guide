import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch (e) {
      console.error('bad line', line);
    }
  }
});
child.stderr.on('data', (c) => process.stderr.write(c));

function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 5000);
  });
}

const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
console.log('init:', init.result?.serverInfo?.name, init.result?.protocolVersion);
const tools = await call('tools/list', {});
console.log('tools:', tools.result.tools.map((t) => t.name).join(', '));

const search = await call('tools/call', { name: 'nav_search_places', arguments: { category: 'cafe', limit: 3 } });
const searchData = JSON.parse(search.result.content[0].text);
console.log('search:', searchData.results.map((r) => `${r.name}(${r.distanceM}m)`).join(', '));

const route = await call('tools/call', { name: 'nav_route', arguments: { to: 'le-four' } });
const routeData = JSON.parse(route.result.content[0].text);
console.log('route:', routeData.name, routeData.lengthM, 'steps', routeData.steps.length, 'flags', routeData.flags.length);
console.log('  continuous:', routeData.deepLink);
console.log('  flags:', routeData.deepLinkFlags);

const guide = await call('tools/call', { name: 'nav_open_guide', arguments: { to: 'le-four' } });
const guideData = JSON.parse(guide.result.content[0].text);
console.log('guide:', guideData.url, guideData.mode);

const guideFlags = await call('tools/call', { name: 'nav_open_guide', arguments: { to: 'le-four', mode: 'flags' } });
const guideFlagsData = JSON.parse(guideFlags.result.content[0].text);
console.log('guide flags:', guideFlagsData.url, guideFlagsData.mode);
if (!guideFlagsData.url.endsWith('&mode=flags')) throw new Error('flags deep link is wrong');

const loc = await call('tools/call', { name: 'nav_location', arguments: {} });
const locData = JSON.parse(loc.result.content[0].text);
console.log('location available:', locData.available);

child.stdin.end();
child.kill();
