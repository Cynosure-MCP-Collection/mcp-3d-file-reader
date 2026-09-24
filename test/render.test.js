import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { renderModel } from '../src/render-model.js';

function pixel(png, x, y) {
  const index = (y * png.width + x) * 4;
  return [...png.data.subarray(index, index + 4)];
}

test('MCP tool returns a labeled PNG with OBJ texture and reports tool errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-3d-obj-'));
  const texture = new PNG({ width: 16, height: 16 });
  for (let i = 0; i < texture.data.length; i += 4) {
    texture.data.set([220, 40, 35, 255], i);
  }
  await writeFile(join(dir, 'red.png'), PNG.sync.write(texture));
  await writeFile(join(dir, 'model.mtl'), 'newmtl red\nKd 1 1 1\nmap_Kd red.png\n');
  await writeFile(join(dir, 'model.obj'), 'mtllib model.mtl\nv -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl red\nf 1/1 2/2 3/3 4/4\n');
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.js', import.meta.url))] });
  const client = new Client({ name: 'render-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'render_3d_model'));
    const result = await client.callTool({ name: 'render_3d_model', arguments: { file_path: join(dir, 'model.obj') } });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /dimensions X × Y × Z.*2 × 2 × 0/);
    const image = PNG.sync.read(Buffer.from(result.content[1].data, 'base64'));
    assert.equal(image.width, 1120);
    assert.equal(image.height, 680);
    const [red, green, blue] = pixel(image, 287, 350);
    assert.ok(red > green * 2 && red > blue * 2, 'front view should show the red texture');

    const bad = await client.callTool({ name: 'render_3d_model', arguments: { file_path: join(dir, 'red.png') } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /Supported formats/);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ASCII STL renders from two views with Z-up alignment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-3d-stl-'));
  const faces = [
    [[-1, -1, 0], [1, -1, 0], [0, 0, 2]],
    [[1, -1, 0], [1, 1, 0], [0, 0, 2]],
    [[1, 1, 0], [-1, 1, 0], [0, 0, 2]],
    [[-1, 1, 0], [-1, -1, 0], [0, 0, 2]]
  ];
  const stl = `solid pyramid\n${faces.map(face => `facet normal 0 0 1\nouter loop\n${face.map(vertex => `vertex ${vertex.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid pyramid\n`;
  const file = join(dir, 'pyramid.stl');
  await writeFile(file, stl);
  try {
    const { image, details } = await renderModel(file, { upAxis: 'z' });
    assert.match(details, /Source up axis: z/);
    const png = PNG.sync.read(image);
    assert.equal(png.width, 1120);
    assert.equal(png.height, 680);
    const front = pixel(png, 287, 350);
    const side = pixel(png, 833, 350);
    const background = pixel(png, 50, 130);
    assert.notDeepEqual(front, background);
    assert.notDeepEqual(side, background);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
