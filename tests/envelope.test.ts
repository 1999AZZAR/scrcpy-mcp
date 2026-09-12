import { describe, it, expect, afterEach } from "vitest"
import {
  SERVER_NAME,
  TOOL_SIDE_EFFECTS,
  isEnvelopeEnabled,
  wrapResult,
  wrapError,
  withEnvelope,
} from "../src/envelope.js"

const ENVELOPE_KEYS = [
  "ok", "summary", "data", "artifacts", "provenance",
  "warnings", "sideEffects", "execution", "redaction",
]

const OLD_ENV = { ...process.env }
afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe("receptor envelope (P1-C1)", () => {
  it("flag off by default; passthrough returns identical reference", () => {
    delete process.env["HELA_ENVELOPE"]
    expect(isEnvelopeEnabled()).toBe(false)
    const raw = { content: [{ type: "text", text: "hi" }] }
    expect(withEnvelope("tap", raw)).toBe(raw)
  })

  it("on-mode wraps first text block, preserves structuredContent + other blocks", () => {
    process.env["HELA_ENVELOPE"] = "true"
    const raw = {
      content: [{ type: "text", text: "Tapped at (100, 200)." }],
      structuredContent: undefined,
    }
    const out = withEnvelope("tap", raw)
    const env = JSON.parse(out.content[0].text)
    for (const k of ENVELOPE_KEYS) expect(env).toHaveProperty(k)
    expect(env.ok).toBe(true)
    expect(env.data).toBe("Tapped at (100, 200).")
    expect(env.sideEffects).toEqual(["android-input"])
    expect(env.execution.serverName).toBe(SERVER_NAME)
  })

  it("image-only results get envelope prepended, image preserved", () => {
    process.env["HELA_ENVELOPE"] = "true"
    const raw = {
      content: [{ type: "image" as const, data: "abc", mimeType: "image/png" }],
      structuredContent: { mimeType: "image/png", encoding: "base64", source: "adb" },
    }
    const out = withEnvelope("screenshot", raw)
    expect(out.content).toHaveLength(2)
    const env = JSON.parse(out.content[0].text)
    expect(env.ok).toBe(true)
    expect(env.sideEffects).toEqual(["media-capture"])
    expect(env.data).toEqual({ mimeType: "image/png", encoding: "base64", source: "adb" })
    expect(out.content[1]).toEqual(raw.content[0])
    expect(out.structuredContent).toEqual(raw.structuredContent)
  })

  it("P0-A3 shell gate shape passes through untouched when flag off", () => {
    delete process.env["HELA_ENVELOPE"]
    const gated = {
      content: [{ type: "text", text: JSON.stringify({ error: true, message: "shell_exec is disabled" }) }],
      isError: true as const,
    }
    const out = withEnvelope("shell_exec", gated)
    expect(out).toBe(gated)
    expect(out.isError).toBe(true)
  })

  it("shell declares android-shell side effect when on", () => {
    process.env["HELA_ENVELOPE"] = "true"
    const out = withEnvelope("shell_exec", { content: [{ type: "text", text: "out" }] })
    expect(JSON.parse(out.content[0].text).sideEffects).toEqual(["android-shell"])
  })

  it("run/step ids propagate; errors carry ok:false", () => {
    process.env["HELA_ENVELOPE"] = "true"
    process.env["HELA_RUN_ID"] = "r1"
    process.env["HELA_STEP_ID"] = "s2"
    expect(wrapResult("tap", {}).execution.run_id).toBe("r1")
    const err = wrapError("tap", "boom")
    expect(err.ok).toBe(false)
    expect(err.error).toBe("boom")
    expect(err.execution.step_id).toBe("s2")
  })

  it("side-effect map covers reads vs control", () => {
    expect(TOOL_SIDE_EFFECTS["shell_exec"]).toEqual(["android-shell"])
    expect(TOOL_SIDE_EFFECTS["app_install"]).toEqual(["app-lifecycle"])
    expect(TOOL_SIDE_EFFECTS["file_push"]).toEqual(["file-transfer"])
    expect(TOOL_SIDE_EFFECTS["clipboard_set"]).toEqual(["android-clipboard"])
    for (const t of ["device_list", "app_list", "ui_dump", "clipboard_get", "version"]) {
      expect(TOOL_SIDE_EFFECTS[t]).toEqual([])
    }
  })
})
