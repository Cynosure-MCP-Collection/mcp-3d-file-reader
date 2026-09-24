#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderModel } from './render-model.js';

export function createMcpServer() {
  const server = new McpServer({ name: 'mcp-3d-file-reader', version: '0.1.0' });

  server.registerTool('render_3d_model', {
    title: 'Render 3D model',
    description: 'Render a local STL, OBJ, or FBX model as a labeled front (+Z) and right side (+X) image. OBJ materials and nearby textures are loaded when available. File paths are local to the MCP server machine.',
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
