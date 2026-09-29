import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const threeDir = resolve(dirname(fileURLToPath(import.meta.resolve('three'))), '..');
const formats = new Set(['.stl', '.obj', '.fbx']);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8', '.mtl': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.stl': 'application/octet-stream', '.fbx': 'application/octet-stream'
};

function within(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

async function findMaterial(filePath) {
  if (extname(filePath).toLowerCase() !== '.obj') return { url: null, warning: null };
  const input = createReadStream(filePath);
  const lines = createInterface({ input, crlfDelay: Infinity });
  let reference;
  try {
    for await (const line of lines) {
      const match = /^\s*mtllib\s+(.+)$/i.exec(line);
      if (match) { reference = match[1].trim(); break; }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!reference) return { url: null, warning: null };
  const candidate = resolve(dirname(filePath), reference);
  if (!within(dirname(filePath), candidate)) return { url: null, warning: 'MTL file outside the model folder was ignored' };
  try {
    await access(candidate);
    return { url: relative(dirname(filePath), candidate).split(sep).map(encodeURIComponent).join('/'), warning: null };
  } catch {
    return { url: null, warning: `MTL file not found: ${reference}` };
  }
}

async function serveFile(response, root, requestedPath) {
  try {
    const decoded = decodeURIComponent(requestedPath);
    const fullPath = await realpath(resolve(root, `.${decoded}`));
    if (!within(root, fullPath) || !(await stat(fullPath)).isFile()) throw new Error('File unavailable');
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(fullPath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    createReadStream(fullPath).on('error', error => response.destroy(error)).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

async function openAssetServer(assetDir, config) {
  const pageHtml = await readFile(join(sourceDir, 'viewer.html'));
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(pageHtml);
    } else if (path === '/config.json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(config));
    } else if (path === '/renderer.js') {
      void serveFile(response, sourceDir, '/viewer.js');
    } else if (path.startsWith('/three/')) {
      void serveFile(response, threeDir, path.slice('/three'.length));
    } else if (path.startsWith('/assets/')) {
      void serveFile(response, assetDir, path.slice('/assets'.length));
    } else {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return server;
}

async function launchBrowser() {
  const bundled = chromium.executablePath();
  let executablePath = process.env.CHROME_PATH;
  if (!executablePath) {
    try { await access(bundled); } catch {
      for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
        try { await access(candidate); executablePath = candidate; break; } catch { /* next candidate */ }
      }
    }
  }
  try {
    return await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage']
    });
  } catch (error) {
    throw new Error(`Chromium could not start. Run "npx playwright install chromium" or set CHROME_PATH. ${error.message}`);
  }
}

export async function renderModel(filePath, { upAxis = 'y' } = {}) {
  if (!['y', 'z'].includes(upAxis)) throw new Error('upAxis must be y or z');
  const absolute = await realpath(resolve(filePath));
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error('Path is not a file');
  const extension = extname(absolute).toLowerCase();
  if (!formats.has(extension)) throw new Error('Supported formats: .stl, .obj, .fbx');
  const assetDir = dirname(absolute);
  const material = await findMaterial(absolute);
  const config = {
    name: basename(absolute),
    format: extension.slice(1),
    modelUrl: `/assets/${encodeURIComponent(basename(absolute))}`,
    materialUrl: material.url,
    materialWarning: material.warning,
    upAxis
  };
  if (config.materialUrl) config.materialUrl = `/assets/${config.materialUrl}`;

  const server = await openAssetServer(assetDir, config);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1120, height: 680 }, deviceScaleFactor: 1 });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      return route.abort();
    });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin, { waitUntil: 'load', timeout: 30000 });
    try {
      await page.waitForFunction(() => window.renderResult || window.renderError, { timeout: 60000 });
    } catch (error) {
      throw new Error(pageErrors.length ? pageErrors.join('; ') : `Rendering timed out: ${error.message}`);
    }
    const error = await page.evaluate(() => window.renderError);
    if (error) throw new Error(error);
    const result = await page.evaluate(() => window.renderResult);
    const image = await page.locator('#collage').screenshot({ type: 'png' });
    const dimensions = result.dimensions.map(value => Number(value.toPrecision(5))).join(' × ');
    const warning = result.warnings.length ? ` Warnings: ${result.warnings.join('; ')}` : '';
    const details = `${config.name} (${config.format.toUpperCase()}); dimensions X × Y × Z after up-axis alignment: ${dimensions} model units. Front looks along -Z from +Z; right side looks along -X from +X. Source up axis: ${upAxis}.${warning}`;
    return { image, details };
  } finally {
    if (browser) await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
}
