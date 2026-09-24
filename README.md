# MCP 3D File Reader

A local MCP server that turns a 3D model into an image an AI can inspect. It loads the model in a lit Three.js scene, renders orthographic front and right-side views, and returns one labeled PNG through the `render_3d_model` tool. The result also includes model dimensions and any asset-loading warnings.

## Supported files

| Format | What is loaded |
| --- | --- |
| STL | ASCII or binary geometry; a neutral material is applied |
| OBJ | Geometry, plus an `mtllib` MTL file and its textures when present |
| FBX | Geometry, materials, and textures supported by Three.js's FBX loader |

Keep MTL files and external textures alongside the model or in subfolders of its directory. The renderer only serves assets from that directory. Embedded FBX textures are supported by the loader. Missing external assets are reported in the tool's text result.

## Install

Requires Node.js 20 or newer and Chromium or Google Chrome.

```bash
npm install
npx playwright install chromium
```

If Chrome is already installed, the server checks common Linux paths. Set `CHROME_PATH` to its executable path for other locations or platforms. Playwright's installed Chromium is used automatically when available.

## Connect an MCP client

Add a stdio server to your MCP client's configuration. Replace the path with this checkout's absolute path:

```json
{
  "mcpServers": {
    "3d-file-reader": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-3d-file-reader/src/server.js"]
    }
  }
}
```

The server can also be started with `npm start`. It writes MCP messages to stdout and errors to stderr.

Call `render_3d_model` with:

```json
{
  "file_path": "/absolute/path/to/model.obj",
  "up_axis": "y"
}
```

`file_path` may also be relative to the server's working directory. `up_axis` is optional and defaults to `y`; use `z` for Z-up CAD exports. After axis alignment, the front camera looks from +Z toward -Z, and the right-side camera looks from +X toward -X. Model files do not consistently define a semantic front, so choose the source orientation that matches your intended front. The dimensions are in model units; the server does not guess a real-world unit.

The tool returns an MCP text item and an `image/png` item. The image is a 1120 × 680 collage with two labeled views. Files remain on the machine running the MCP server.

## Test

```bash
npm test
```

The tests exercise the actual stdio MCP call, textured OBJ rendering, STL rendering with Z-up alignment, and a failed tool call. They need a working Chrome or Chromium installation.

## Current limits

- The side of a perfectly flat model may appear empty because it has zero visible thickness.
- FBX support follows the Three.js FBX loader's format coverage; some older or unusual FBX exports may need conversion.
- Rendering is static. Animations, hidden geometry, and scene cameras are not used.
