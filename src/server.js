#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderModel } from './render-model.js';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const iconUrl = `https://unpkg.com/${packageJson.name}@${packageJson.version}/icon.png`;

export function createMcpServer() {
  const server = new McpServer({
    name: packageJson.mcpName,
    title: '3D File Reader',
    version: packageJson.version,
    description: packageJson.description,
    icons: [{ src: iconUrl, mimeType: 'image/png', sizes: ['1254x1254'] }]
  }, {
    instructions: 'Use render_3d_model with a path to a local STL, OBJ, or FBX file. Set up_axis to z for Z-up models. The result includes a labeled front and right-side PNG, dimensions, and asset warnings.'
  });

  server.registerTool('render_3d_model', {
    title: 'Render 3D model',
    description: 'Read a local STL, OBJ, or FBX file and return a labeled PNG showing front (+Z) and right-side (+X) views, model dimensions, and asset-loading warnings. Use this when you need to inspect a 3D model visually. OBJ materials and nearby textures are loaded when available. The file path is local to the MCP server machine.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      file_path: z.string().min(1).describe('Absolute or working-directory-relative path to a .stl, .obj, or .fbx file'),
      up_axis: z.enum(['y', 'z']).default('y').describe('Axis considered vertical in the source file; use z for Z-up CAD exports')
    }
  }, async ({ file_path, up_axis }) => {
    try {
      const { image, details } = await renderModel(file_path, { upAxis: up_axis });
      return {
        content: [
          { type: 'text', text: details },
          { type: 'image', data: image.toString('base64'), mimeType: 'image/png' }
        ]
      };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Could not render 3D model: ${error.message}` }] };
    }
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
