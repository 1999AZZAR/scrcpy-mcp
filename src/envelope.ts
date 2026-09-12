/**
 * C1 provider-side HeLaResult envelope (self-contained mirror of the canonical
 * shape in chaining-mcp/src/agent/hela-result.ts; this repo is a standalone
 * package and must not import across repos).
 *
 * Flag-gated: set HELA_ENVELOPE=true to wrap tool payloads in the canonical
 * HelaResult envelope. Default (unset/anything else) returns the legacy raw
 * payload byte-for-byte identical to before.
 *
 * Wiring: tools register via `registerEnvTool(server, ...)` — a thin wrapper
 * over `server.registerTool` that envelopes the callback result. Callback args
 * are typed via an index signature so existing destructured callbacks keep
 * compiling under `strict` (explicit any, no implicit-any regressions).
 * `structuredContent` (outputSchema) and non-text blocks (images) pass
 * through untouched in both modes.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HelaArtifactRef {
  uri: string;
  sha256?: string;
  size?: number;
  media_type?: string;
}

export interface HelaProvenanceRef {
  source: string;
  retrieved_at?: string;
  confidence?: number;
  freshness?: string;
}

export interface HelaRedaction {
  applied: boolean;
  fields: string[];
}

export interface HelaExecutionMeta {
  serverName?: string;
  toolName?: string;
  run_id?: string;
  step_id?: string;
  attempt?: number;
  executionTimeMs?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface HelaResult<T = unknown> {
  ok: boolean;
  summary: string;
  /** Canonical payload field. */
  data: T;
  artifacts: HelaArtifactRef[];
  provenance: HelaProvenanceRef[];
  warnings: string[];
  sideEffects: string[];
  execution: HelaExecutionMeta;
  redaction: HelaRedaction;
  error?: string;
}

export const SERVER_NAME = 'scrcpy-mcp';

/** On-device/host-mutating tools declare side effects; reads declare none. */
export const TOOL_SIDE_EFFECTS: Record<string, string[]> = {
  // app lifecycle
  app_start: ['app-lifecycle'],
  app_stop: ['app-lifecycle'],
  app_install: ['app-lifecycle'],
  app_uninstall: ['app-lifecycle'],
  app_list: [],
  app_current: [],
  // clipboard
  clipboard_get: [],
  clipboard_set: ['android-clipboard'],
  // device
  device_list: [],
  device_info: [],
  screen_on: ['device-config'],
  screen_off: ['device-config'],
  connect_wifi: ['device-config'],
  disconnect_wifi: ['device-config'],
  rotate_device: ['device-config'],
  expand_notifications: ['device-config'],
  expand_settings: ['device-config'],
  collapse_panels: ['device-config'],
  version: [],
  wait: [],
  // files
  file_push: ['file-transfer'],
  file_pull: ['file-transfer'],
  file_list: [],
  // input
  tap: ['android-input'],
  swipe: ['android-input'],
  long_press: ['android-input'],
  drag_drop: ['android-input'],
  input_text: ['android-input'],
  key_event: ['android-input'],
  scroll: ['android-input'],
  // session / video / vision
  start_session: ['media-session'],
  stop_session: ['media-session'],
  start_video_stream: ['media-session'],
  stop_video_stream: ['media-session'],
  screenshot: ['media-capture'],
  screen_record_start: ['media-capture'],
  screen_record_stop: ['media-capture'],
  // shell (P0-A3 gated)
  shell_exec: ['android-shell'],
  // ui
  ui_dump: [],
  ui_find_element: [],
  ui_tap_element: ['android-input'],
  ui_get_state: [],
  ui_wait_for_element: [],
  ui_smart_fill: ['android-input'],
  scroll_to_element: [],
  form_fill: ['android-input'],
};

export function isEnvelopeEnabled(): boolean {
  return process.env['HELA_ENVELOPE'] === 'true';
}

function baseExecution(toolName: string): HelaExecutionMeta {
  const meta: HelaExecutionMeta = {
    serverName: SERVER_NAME,
    toolName,
    completedAt: new Date().toISOString(),
  };
  const runId = process.env['HELA_RUN_ID'];
  const stepId = process.env['HELA_STEP_ID'];
  if (runId !== undefined) meta.run_id = runId;
  if (stepId !== undefined) meta.step_id = stepId;
  return meta;
}

export function wrapResult<T>(toolName: string, data: T, summary?: string): HelaResult<T> {
  return {
    ok: true,
    summary: summary || `${toolName} ok`,
    data,
    artifacts: [],
    provenance: [],
    warnings: [],
    sideEffects: TOOL_SIDE_EFFECTS[toolName] || [],
    execution: baseExecution(toolName),
    redaction: { applied: false, fields: [] },
  };
}

export function wrapError(toolName: string, message: string): HelaResult<null> {
  return {
    ok: false,
    summary: `${toolName} failed: ${message}`,
    data: null,
    artifacts: [],
    provenance: [],
    warnings: [],
    sideEffects: TOOL_SIDE_EFFECTS[toolName] || [],
    execution: baseExecution(toolName),
    redaction: { applied: false, fields: [] },
    error: message,
  };
}

/**
 * Post-hoc result wrapper. Envelope off: SDK result untouched. Envelope on:
 * the first text block becomes the envelope JSON (`data` = original text,
 * JSON-parsed when possible); image/other blocks and `structuredContent`
 * are preserved. Results with no text block (image-only captures) get the
 * envelope text block prepended with `data` = structuredContent summary.
 */
export function withEnvelope(toolName: string, result: any): any {
  if (!isEnvelopeEnabled()) return result;
  if (!result || !Array.isArray(result.content)) return result;
  let replaced = false;
  const content = result.content.map((block: any) => {
    if (!replaced && block && block.type === 'text' && typeof block.text === 'string') {
      replaced = true;
      let data: unknown = block.text;
      try {
        data = JSON.parse(block.text);
      } catch {
        // human-readable text stays a string
      }
      return { type: 'text', text: JSON.stringify(wrapResult(toolName, data), null, 2) };
    }
    return block;
  });
  if (!replaced) {
    const data = result.structuredContent ?? { note: `${toolName} returned non-text content` };
    return { ...result, content: [{ type: 'text', text: JSON.stringify(wrapResult(toolName, data), null, 2) }, ...result.content] };
  }
  return { ...result, content };
}

/**
 * Drop-in replacement for `server.registerTool(name, config, cb)` that
 * envelopes the callback result. Same 3-arg shape, first arg is the server.
 */
export function registerEnvTool(
  server: McpServer,
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema: { [k: string]: any };
    outputSchema?: { [k: string]: any };
    annotations?: Record<string, unknown>;
  },
  cb: (args: { [k: string]: any }) => any,
): void {
  (server as any).registerTool(name, config, async (args: any) => withEnvelope(name, await cb(args)));
}
