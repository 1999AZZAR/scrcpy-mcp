import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { execAdbShell, resolveSerial, getDeviceProperty } from "../core/adb.js"
import {
  getSession,
  hasActiveSession,
  sendControlMessage,
  serializeInjectKeycode,
  serializeInjectText,
  serializeInjectTouchEvent,
  serializeInjectScrollEvent,
} from "../core/scrcpy.js"
import { ACTION_DOWN, ACTION_UP, ACTION_MOVE } from "../core/constants.js"
import { dumpUiXml, parseUiNodes, filterElements, findNearestInput } from "./ui.js"

const KEYCODE_MAP: Record<string, number> = {
  HOME: 3,
  BACK: 4,
  CALL: 5,
  END_CALL: 6,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  CAMERA: 27,
  ENTER: 66,
  DELETE: 67,
  TAB: 61,
  MENU: 82,
  APP_SWITCH: 187,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  WAKEUP: 224,
  SLEEP: 223,
  MEDIA_PLAY_PAUSE: 85,
  MEDIA_NEXT: 87,
  MEDIA_PREVIOUS: 88,
  BRIGHTNESS_UP: 221,
  BRIGHTNESS_DOWN: 220,
  NOTIFICATION: 83,
}

const POINTER_ID_GENERIC_FINGER = BigInt(-2)

function escapeTextForShell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/ /g, "%s")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\|/g, "\\|")
    .replace(/;/g, "\\;")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/&/g, "\\&")
    .replace(/\*/g, "\\*")
    .replace(/\?/g, "\\?")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/!/g, "\\!")
}

function resolveKeycode(keycode: string | number): number {
  if (typeof keycode === "number") {
    return keycode
  }
  const upperKey = keycode.toUpperCase()
  if (KEYCODE_MAP[upperKey] !== undefined) {
    return KEYCODE_MAP[upperKey]
  }
  const parsed = parseInt(keycode, 10)
  if (isNaN(parsed)) {
    throw new Error(`Unknown keycode: ${keycode}`)
  }
  return parsed
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sendTouchEvent(
  serial: string,
  action: number,
  x: number,
  y: number,
  width: number,
  height: number,
  pressure: number
): void {
  const msg = serializeInjectTouchEvent(
    action, POINTER_ID_GENERIC_FINGER, x, y, width, height, pressure
  )
  sendControlMessage(serial, msg)
}

// Callers pass NATIVE display coordinates (matching ui_dump / ui_find_element
// and `input tap`). The scrcpy touch protocol, however, requires the message's
// screenSize to exactly equal the downscaled video frame size, or the server
// silently drops the event. So scale native coords into frame space. max_size
// preserves aspect ratio, so the x and y factors are equal.
function nativeToFrame(
  serial: string,
  x: number,
  y: number
): { x: number; y: number; width: number; height: number } {
  const session = getSession(serial)
  if (!session) throw new Error(`No session for ${serial}`)
  const { width: nativeW, height: nativeH } = session.screenSize
  const { width: frameW, height: frameH } = session.frameSize
  return {
    x: Math.round((x * frameW) / nativeW),
    y: Math.round((y * frameH) / nativeH),
    width: frameW,
    height: frameH,
  }
}

export async function tapViaScrcpy(serial: string, x: number, y: number): Promise<void> {
  const { x: fx, y: fy, width, height } = nativeToFrame(serial, x, y)

  sendTouchEvent(serial, ACTION_DOWN, fx, fy, width, height, 1.0)
  await sleep(10)
  sendTouchEvent(serial, ACTION_UP, fx, fy, width, height, 0.0)
}

async function swipeViaScrcpy(
  serial: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  duration: number
): Promise<void> {
  const start = nativeToFrame(serial, x1, y1)
  const end = nativeToFrame(serial, x2, y2)
  const { width, height } = start

  const steps = Math.max(2, Math.floor(duration / 16))
  const dx = (end.x - start.x) / steps
  const dy = (end.y - start.y) / steps
  const stepDelay = duration / steps

  sendTouchEvent(serial, ACTION_DOWN, start.x, start.y, width, height, 1.0)
  await sleep(stepDelay)

  for (let i = 1; i < steps; i++) {
    const x = Math.round(start.x + dx * i)
    const y = Math.round(start.y + dy * i)
    sendTouchEvent(serial, ACTION_MOVE, x, y, width, height, 1.0)
    await sleep(stepDelay)
  }

  sendTouchEvent(serial, ACTION_UP, end.x, end.y, width, height, 0.0)
}

async function longPressViaScrcpy(
  serial: string,
  x: number,
  y: number,
  duration: number
): Promise<void> {
  const { x: fx, y: fy, width, height } = nativeToFrame(serial, x, y)

  sendTouchEvent(serial, ACTION_DOWN, fx, fy, width, height, 1.0)
  await sleep(duration)
  sendTouchEvent(serial, ACTION_UP, fx, fy, width, height, 0.0)
}

async function scrollViaScrcpy(
  serial: string,
  x: number,
  y: number,
  dx: number,
  dy: number
): Promise<void> {
  const { x: fx, y: fy, width, height } = nativeToFrame(serial, x, y)

  sendControlMessage(serial, serializeInjectScrollEvent(fx, fy, width, height, dx * 16, dy * 16))
}

async function keyEventViaScrcpy(serial: string, keycode: number): Promise<void> {
  sendControlMessage(serial, serializeInjectKeycode(ACTION_DOWN, keycode))
  await sleep(10)
  sendControlMessage(serial, serializeInjectKeycode(ACTION_UP, keycode))
}

async function inputTextViaScrcpy(serial: string, text: string): Promise<void> {
  sendControlMessage(serial, serializeInjectText(text))
}

const SUBMIT_DESCRIPTORS = ["send", "send message", "submit", "\u2192", "kirim"]
const SUBMIT_RESOURCE_IDS = ["send", "send_button", "btn_send", "submit", "btn_submit", "iv_send"]

async function findSubmitButton(serial: string): Promise<{ x: number; y: number } | null> {
  const raw = await dumpUiXml(serial)
  const nodeRegex = /<node\s([^>]+?)(?:\/>|>)/gs
  let match: RegExpExecArray | null

  while ((match = nodeRegex.exec(raw)) !== null) {
    const attrs = match[1]
    const contentDesc = (attrs.match(/content-desc="([^"]*)"/)?.[1] || "").toLowerCase()
    const resourceId = (attrs.match(/resource-id="([^"]*)"/)?.[1] || "").toLowerCase()
    const resourceIdShort = resourceId.split("/").pop() || ""
    const boundsMatch = attrs.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!boundsMatch) continue

    // Match by content-desc
    if (SUBMIT_DESCRIPTORS.some(d => contentDesc.includes(d))) {
      return {
        x: Math.round((parseInt(boundsMatch[1]) + parseInt(boundsMatch[3])) / 2),
        y: Math.round((parseInt(boundsMatch[2]) + parseInt(boundsMatch[4])) / 2),
      }
    }

    // Match by resource-id
    if (SUBMIT_RESOURCE_IDS.some(id => resourceIdShort.includes(id))) {
      return {
        x: Math.round((parseInt(boundsMatch[1]) + parseInt(boundsMatch[3])) / 2),
        y: Math.round((parseInt(boundsMatch[2]) + parseInt(boundsMatch[4])) / 2),
      }
    }
  }
  return null
}

const INPUT_KEYWORDS = ["ask", "type", "search", "reply", "chat", "message", "text", "write", "enter", "input"]

async function findAndFocusInput(serial: string): Promise<boolean> {
  const xml = await dumpUiXml(serial)
  const allElements = parseUiNodes(xml)

  // Priority 1: EditText that is clickable (most standard input)
  const editTexts = allElements.filter(e =>
    e.className.endsWith("EditText") && e.clickable
  ).sort((a, b) => b.tapY - a.tapY) // prefer bottom (chat inputs)
  if (editTexts.length > 0) {
    const target = editTexts[0]
    await execAdbShell(serial, `input tap ${target.tapX} ${target.tapY}`)
    return true
  }

  // Priority 2: View with input-like content-desc (ChatGPT "Ask ChatGPT", "Reply to ChatGPT")
  const inputDesc = allElements.filter(e => {
    const desc = (e.contentDesc + " " + e.text).toLowerCase()
    return INPUT_KEYWORDS.some(k => desc.includes(k))
  }).sort((a, b) => b.tapY - a.tapY)
  if (inputDesc.length > 0) {
    const target = inputDesc[0]
    await execAdbShell(serial, `input tap ${target.tapX} ${target.tapY}`)
    return true
  }

  // Priority 3: Any clickable View in the bottom 25% of screen (chat areas)
  const bottomClickable = allElements.filter(e =>
    e.clickable && e.tapY > 0 && e.tapX > 0
  ).sort((a, b) => b.tapY - a.tapY)
  if (bottomClickable.length > 0) {
    const target = bottomClickable[0]
    await execAdbShell(serial, `input tap ${target.tapX} ${target.tapY}`)
    return true
  }

  return false
}

// Shared output schema for input/gesture tools: a simple success + message result.
const actionOutputSchema = {
  success: z.boolean().describe("Whether the input action was dispatched to the device"),
  message: z.string().describe("Human-readable description of the action performed"),
}

function actionOk(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { success: true, message },
  }
}

function actionError(message: string, extra: Record<string, unknown> = {}) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ error: true, message, ...extra }),
    }],
    isError: true as const,
  }
}

export function registerInputTools(server: McpServer): void {
  server.registerTool(
    "tap",
    {
      description: "Tap at the specified screen coordinates",
      inputSchema: {
        x: z.number().int().nonnegative().describe("X coordinate"),
        y: z.number().int().nonnegative().describe("Y coordinate"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: actionOutputSchema,
      annotations: {
        title: "Tap Screen",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ x, y, serial }) => {
      try {
        const s = await resolveSerial(serial)

        if (hasActiveSession(s)) {
          try {
            await tapViaScrcpy(s, x, y)
            return actionOk(`Tapped at (${x}, ${y})`)
          } catch (error) {
            const err = error as Error
            console.error(`[tap] scrcpy failed, falling back to ADB: ${err.message}`)
          }
        }

        await execAdbShell(s, `input tap ${x} ${y}`)
        return actionOk(`Tapped at (${x}, ${y})`)
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )

  server.registerTool(
    "swipe",
    {
      description: "Perform a swipe gesture from one point to another",
      inputSchema: {
        x1: z.number().int().nonnegative().describe("Start X coordinate"),
        y1: z.number().int().nonnegative().describe("Start Y coordinate"),
        x2: z.number().int().nonnegative().describe("End X coordinate"),
        y2: z.number().int().nonnegative().describe("End Y coordinate"),
        duration: z.number().int().positive().optional().default(300).describe("Duration in milliseconds"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: actionOutputSchema,
      annotations: {
        title: "Swipe Gesture",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ x1, y1, x2, y2, duration, serial }) => {
      try {
        const s = await resolveSerial(serial)

        if (hasActiveSession(s)) {
          try {
            await swipeViaScrcpy(s, x1, y1, x2, y2, duration)
            return actionOk(`Swiped from (${x1}, ${y1}) to (${x2}, ${y2}) in ${duration}ms`)
          } catch (error) {
            const err = error as Error
            console.error(`[swipe] scrcpy failed, falling back to ADB: ${err.message}`)
          }
        }

        await execAdbShell(s, `input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`)
        return actionOk(`Swiped from (${x1}, ${y1}) to (${x2}, ${y2}) in ${duration}ms`)
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )

  server.registerTool(
    "long_press",
    {
      description: "Perform a long press at the specified coordinates",
      inputSchema: {
        x: z.number().int().nonnegative().describe("X coordinate"),
        y: z.number().int().nonnegative().describe("Y coordinate"),
        duration: z.number().int().positive().optional().default(500).describe("Duration in milliseconds"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: actionOutputSchema,
      annotations: {
        title: "Long Press",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ x, y, duration, serial }) => {
      try {
        const s = await resolveSerial(serial)

        if (hasActiveSession(s)) {
          try {
            await longPressViaScrcpy(s, x, y, duration)
            return actionOk(`Long pressed at (${x}, ${y}) for ${duration}ms`)
          } catch (error) {
            const err = error as Error
            console.error(`[long_press] scrcpy failed, falling back to ADB: ${err.message}`)
          }
        }

        await execAdbShell(s, `input swipe ${x} ${y} ${x} ${y} ${duration}`)
        return actionOk(`Long pressed at (${x}, ${y}) for ${duration}ms`)
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )

  server.registerTool(
    "drag_drop",
    {
      description: "Perform a drag and drop gesture from one point to another. Uses input draganddrop on Android 8.0+ (API 26), falls back to swipe on older versions.",
      inputSchema: {
        startX: z.number().int().nonnegative().describe("Start X coordinate"),
        startY: z.number().int().nonnegative().describe("Start Y coordinate"),
        endX: z.number().int().nonnegative().describe("End X coordinate"),
        endY: z.number().int().nonnegative().describe("End Y coordinate"),
        duration: z.number().int().positive().optional().default(300).describe("Duration in milliseconds"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: actionOutputSchema,
      annotations: {
        title: "Drag and Drop",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ startX, startY, endX, endY, duration, serial }) => {
      try {
        const s = await resolveSerial(serial)

        if (hasActiveSession(s)) {
          try {
            await swipeViaScrcpy(s, startX, startY, endX, endY, duration)
            return actionOk(`Dragged from (${startX}, ${startY}) to (${endX}, ${endY}) in ${duration}ms`)
          } catch (error) {
            const err = error as Error
            console.error(`[drag_drop] scrcpy failed, falling back to ADB: ${err.message}`)
          }
        }

        const sdkStr = await getDeviceProperty(s, "ro.build.version.sdk")
        const sdkLevel = parseInt(sdkStr, 10)

        if (!isNaN(sdkLevel) && sdkLevel >= 26) {
          await execAdbShell(s, `input draganddrop ${startX} ${startY} ${endX} ${endY} ${duration}`)
          return actionOk(`Dragged from (${startX}, ${startY}) to (${endX}, ${endY}) in ${duration}ms`)
        }

        console.error(`[drag_drop] SDK ${sdkLevel} < 26, using swipe fallback`)
        await execAdbShell(s, `input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`)
        return actionOk(`Dragged from (${startX}, ${startY}) to (${endX}, ${endY}) in ${duration}ms (swipe fallback)`)
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )

  server.registerTool(
    "input_text",
    {
      description: "Type text into the input field. Reports device context (screen, app, session). When submit=true, auto-detects and taps the send button. Optionally target a specific input field by text label, resource ID, or content description instead of auto-focus.",
      inputSchema: {
        text: z.string().describe("Text to type"),
        submit: z.boolean().optional().default(false).describe("Auto-tap send/submit button after typing (for chat/messaging apps)"),
        elementText: z.string().optional().describe("Target a specific input by its label text (e.g. 'Full Name', 'City/Domicile')"),
        elementId: z.string().optional().describe("Target a specific input by resource ID"),
        elementContentDesc: z.string().optional().describe("Target a specific input by content description"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: {
        ...actionOutputSchema,
        screenOn: z.boolean().describe("Whether the screen was on before this action"),
        currentApp: z.string().describe("Package name of the foreground app"),
        focused: z.boolean().optional().describe("Whether an input field was auto-focused"),
        sessionActive: z.boolean().describe("Whether scrcpy session was active"),
        submitUsed: z.boolean().optional().describe("Whether a submit button was tapped after typing"),
      },
      annotations: {
        title: "Type Text",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, submit, elementText, elementId, elementContentDesc, serial }) => {
      try {
        const s = await resolveSerial(serial)
        const result: Record<string, unknown> = { success: true, message: "" }

        // Device context — capture initial state
        const [powerRaw, appRaw] = await Promise.all([
          execAdbShell(s, "dumpsys power | grep 'mWakefulness='"),
          execAdbShell(s, "dumpsys window | grep mCurrentFocus"),
        ])
        const screenOn = powerRaw.includes("Awake") || powerRaw.includes("Dozing")
        result.screenOn = screenOn
        result.sessionActive = hasActiveSession(s)

        const appMatch = appRaw.match(/mCurrentFocus=Window\{[^}]+\s+([^/}]+)/)
        result.currentApp = appMatch?.[1] || "unknown"

        // Wake screen if off
        if (!screenOn) {
          await execAdbShell(s, "input keyevent KEYCODE_WAKEUP")
          await new Promise(res => setTimeout(res, 500))
        }

        // Explicit element targeting
        let focused = false
        if (elementText || elementId || elementContentDesc) {
          const xml = await dumpUiXml(s)
          const allElements = parseUiNodes(xml)

          const opts: { text?: string; resourceId?: string; contentDesc?: string } = {}
          if (elementText) opts.text = elementText
          if (elementId) opts.resourceId = elementId
          if (elementContentDesc) opts.contentDesc = elementContentDesc

          const labelResults = filterElements(allElements, opts)
          if (labelResults.length > 0) {
            const label = labelResults[0]
            const nearest = findNearestInput(allElements, label.tapX, label.tapY)
            if (nearest) {
              if (hasActiveSession(s)) {
                try {
                  await tapViaScrcpy(s, nearest.tapX, nearest.tapY)
                } catch {
                  await execAdbShell(s, `input tap ${nearest.tapX} ${nearest.tapY}`)
                }
              } else {
                await execAdbShell(s, `input tap ${nearest.tapX} ${nearest.tapY}`)
              }
              focused = true
            }
          }
          if (!focused) {
            focused = await findAndFocusInput(s)
          }
        } else {
          focused = await findAndFocusInput(s)
        }
        result.focused = focused
        await new Promise(res => setTimeout(res, 300))

        // Type the text — scrcpy first (fast), fallback to ADB (stable)
        if (hasActiveSession(s)) {
          try {
            await inputTextViaScrcpy(s, text)
          } catch {
            const escaped = escapeTextForShell(text)
            await execAdbShell(s, `input text "${escaped}"`)
          }
        } else {
          const escaped = escapeTextForShell(text)
          await execAdbShell(s, `input text "${escaped}"`)
        }

        // Submit detection
        if (submit) {
          await new Promise(res => setTimeout(res, 500))
          const btn = await findSubmitButton(s)
          if (btn) {
            if (hasActiveSession(s)) {
              await tapViaScrcpy(s, btn.x, btn.y)
            } else {
              await execAdbShell(s, `input tap ${btn.x} ${btn.y}`)
            }
            result.submitUsed = true
          } else {
            result.submitUsed = false
          }
        }

        const parts = [`Typed: "${text}"`]
        if (!result.screenOn) parts.push("(woke screen)")
        if (elementText) parts.push(`(targeted: "${elementText}")`)
        else if (elementId) parts.push(`(targeted: #${elementId})`)
        else if (result.focused) parts.push("(auto-focused)")
        if (submit) parts.push(result.submitUsed ? "✓ sent" : "✗ no send button")
        result.message = parts.join(" ")
        return {
          content: [{ type: "text" as const, text: result.message as string }],
          structuredContent: result,
        }
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )

  server.registerTool(
    "key_event",
    {
      description: "Send a key event to the device. Supports keycodes like HOME, BACK, ENTER, VOLUME_UP, etc.",
      inputSchema: {
        keycode: z.union([z.string(), z.number()]).optional().describe("Keycode name (e.g., 'HOME', 'BACK') or numeric value"),
        key: z.union([z.string(), z.number()]).optional().describe("Alias for keycode"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: actionOutputSchema,
      annotations: {
        title: "Send Key Event",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ keycode, key, serial }) => {
      let code: number
      try {
        const inputKey = keycode ?? key
        if (inputKey === undefined) {
          throw new Error("keycode or key is required")
        }
        code = resolveKeycode(inputKey)
      } catch (error) {
        const err = error as Error
        return actionError(err.message, {
          hint: "Use a known keycode name (HOME, BACK, ENTER, VOLUME_UP, etc.) or a numeric value.",
        })
      }

      try {
        const s = await resolveSerial(serial)

        if (hasActiveSession(s)) {
          try {
            await keyEventViaScrcpy(s, code)
            return actionOk(`Sent key event: ${keycode} (${code})`)
          } catch (error) {
            const err = error as Error
            console.error(`[key_event] scrcpy failed, falling back to ADB: ${err.message}`)
          }
        }

        await execAdbShell(s, `input keyevent ${code}`)
        return actionOk(`Sent key event: ${keycode} (${code})`)
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )

  server.registerTool(
    "scroll",
    {
      description: "Scroll at the specified position. dy=negative scrolls UP (reveals content above), dy=positive scrolls DOWN (reveals content below). Use large values (e.g. -400, 500) for meaningful scroll distance.",
      inputSchema: {
        x: z.number().int().nonnegative().describe("X coordinate to scroll at"),
        y: z.number().int().nonnegative().describe("Y coordinate to scroll at"),
        dx: z.number().describe("Horizontal scroll amount (negative=left, positive=right)"),
        dy: z.number().describe("Vertical scroll: negative=scroll UP (reveal above), positive=scroll DOWN (reveal below)"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: actionOutputSchema,
      annotations: {
        title: "Scroll",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ x, y, dx, dy, serial }) => {
      try {
        const s = await resolveSerial(serial)

        if (hasActiveSession(s)) {
          try {
            await scrollViaScrcpy(s, x, y, dx, dy)
            return actionOk(`Scrolled at (${x}, ${y}) with delta (${dx}, ${dy})`)
          } catch (error) {
            const err = error as Error
            console.error(`[scroll] scrcpy failed, falling back to ADB: ${err.message}`)
          }
        }

        const duration = 300
        const distance = 3

        const endX = Math.max(0, Math.round(x + dx * distance))
        const endY = Math.max(0, Math.round(y - dy * distance))

        await execAdbShell(s, `input swipe ${x} ${y} ${endX} ${endY} ${duration}`)
        return actionOk(`Scrolled at (${x}, ${y}) with delta (${dx}, ${dy})`)
      } catch (error) {
        const err = error as Error
        return actionError(err.message)
      }
    }
  )
}
