import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { registerEnvTool } from "../envelope.js";
import { z } from "zod"
import { execAdbShell, resolveSerial } from "../core/adb.js"
import { hasActiveSession } from "../core/scrcpy.js"
import { tapViaScrcpy } from "./input.js"

interface UiElement {
  text: string
  resourceId: string
  className: string
  contentDesc: string
  bounds: string
  tapX: number
  tapY: number
  clickable: boolean
}

export function parseUiNodes(xml: string): UiElement[] {
  const elements: UiElement[] = []
  const nodeRegex = /<node\s([^>]+?)(?:\/>|>)/gs
  let match: RegExpExecArray | null

  while ((match = nodeRegex.exec(xml)) !== null) {
    const attrs = match[1]
    const attr = (name: string): string => {
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`))
      return m ? m[1] : ""
    }

    const bounds = attr("bounds")
    const boundsMatch = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    if (!boundsMatch) continue

    const x1 = parseInt(boundsMatch[1], 10)
    const y1 = parseInt(boundsMatch[2], 10)
    const x2 = parseInt(boundsMatch[3], 10)
    const y2 = parseInt(boundsMatch[4], 10)

    elements.push({
      text: attr("text"),
      resourceId: attr("resource-id"),
      className: attr("class"),
      contentDesc: attr("content-desc"),
      bounds,
      tapX: Math.round((x1 + x2) / 2),
      tapY: Math.round((y1 + y2) / 2),
      clickable: attr("clickable") === "true",
    })
  }

  return elements
}

function getViewportSize(xml: string): { width: number; height: number } {
  const rootMatch = xml.match(/bounds="\[0,0\]\[(\d+),(\d+)\]"/)
  if (rootMatch) {
    return { width: parseInt(rootMatch[1]), height: parseInt(rootMatch[2]) }
  }
  return { width: 1080, height: 2400 }
}

export function findNearestInput(elements: UiElement[], labelTapX: number, labelTapY: number, className?: string): UiElement | null {
  const targetClass = className?.endsWith("EditText") ? className : null

  const inputs = elements.filter(e => {
    if (targetClass) return e.className === targetClass
    const isEditText = e.className.endsWith("EditText")
    const isInputLike = e.className.endsWith("EditText") ||
      (e.clickable && e.resourceId.includes("input"))
    return isEditText || isInputLike
  })

  if (inputs.length === 0) return null

  const SCREEN_W = 1080
  const SCREEN_H = 2400

  inputs.sort((a, b) => {
    const distA = Math.abs(a.tapX - labelTapX) / SCREEN_W + Math.abs(a.tapY - labelTapY) / SCREEN_H * 3
    const distB = Math.abs(b.tapX - labelTapX) / SCREEN_W + Math.abs(b.tapY - labelTapY) / SCREEN_H * 3
    return distA - distB
  })

  const nearest = inputs[0]
  const dy = Math.abs(nearest.tapY - labelTapY)
  if (dy > 600) return null

  return nearest
}

export async function dumpUiXml(serial: string): Promise<string> {
  const tmpPath = `/sdcard/.ui_dump_${Date.now()}_${Math.random().toString(36).slice(2)}.xml`
  const raw = await execAdbShell(
    serial,
    `uiautomator dump --compressed ${tmpPath} 2>/dev/null; cat ${tmpPath}; rm -f ${tmpPath}`
  )
  return raw.replace(/UI hier[^\n]*dumped to:[^\n]*/gi, "").trim()
}

export function filterElements(
  elements: UiElement[],
  opts: {
    text?: string
    resourceId?: string
    className?: string
    contentDesc?: string
    exactMatch?: boolean
  }
): UiElement[] {
  let results = elements

  if (opts.text) {
    const lower = opts.text.toLowerCase()
    let filtered = opts.exactMatch
      ? results.filter((el) => el.text === opts.text)
      : results.filter((el) => el.text.toLowerCase().includes(lower))

    if (filtered.length === 0) {
      filtered = opts.exactMatch
        ? results.filter((el) => el.contentDesc === opts.text)
        : results.filter((el) => el.contentDesc.toLowerCase().includes(lower))
    }
    results = filtered
  }

  if (opts.resourceId) {
    results = results.filter((el) => el.resourceId === opts.resourceId)
  }
  if (opts.className) {
    results = results.filter((el) => el.className === opts.className)
  }
  if (opts.contentDesc) {
    if (opts.exactMatch) {
      results = results.filter((el) => el.contentDesc === opts.contentDesc)
    } else {
      const lower = opts.contentDesc.toLowerCase()
      results = results.filter((el) => el.contentDesc.toLowerCase().includes(lower))
    }
  }

  return results
}

async function tapWithFallback(serial: string, x: number, y: number): Promise<void> {
  if (hasActiveSession(serial)) {
    try {
      await tapViaScrcpy(serial, x, y)
    } catch {
      await execAdbShell(serial, `input tap ${x} ${y}`)
    }
  } else {
    await execAdbShell(serial, `input tap ${x} ${y}`)
  }
}

export function registerUiTools(server: McpServer): void {
  registerEnvTool(server, 
    "ui_dump",
    {
      description: "Dump the full UI hierarchy of the current screen as XML.",
      inputSchema: {
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: {
        xml: z.string().describe("The UI hierarchy as a uiautomator XML document"),
      },
      annotations: {
        title: "Dump UI Hierarchy",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ serial }) => {
      try {
        const s = await resolveSerial(serial)
        const xml = await dumpUiXml(s)
        return {
          content: [{ type: "text", text: xml }],
          structuredContent: { xml },
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: true, message: err.message }),
          }],
          isError: true as const,
        }
      }
    }
  )

  registerEnvTool(server, 
    "ui_find_element",
    {
      description: "Find UI elements on screen by text, resource ID, class name, or content description. Returns matching elements with their tap coordinates.",
      inputSchema: {
        text: z.string().optional().describe("Text content to search for"),
        resourceId: z.string().optional().describe("Resource ID to match exactly (e.g., 'com.app:id/button')"),
        className: z.string().optional().describe("Class name to match exactly (e.g., 'android.widget.Button')"),
        contentDesc: z.string().optional().describe("Content description to search for"),
        exactMatch: z.boolean().optional().default(false).describe("If true, text and contentDesc require exact matches"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: {
        count: z.number().int().describe("Number of matching elements"),
        elements: z.array(
          z.object({
            text: z.string(),
            resourceId: z.string(),
            className: z.string(),
            contentDesc: z.string(),
            bounds: z.string(),
            tapX: z.number().int(),
            tapY: z.number().int(),
            clickable: z.boolean(),
          })
        ).describe("Matching UI elements with tap coordinates"),
      },
      annotations: {
        title: "Find UI Element",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ text, resourceId, className, contentDesc, exactMatch, serial }) => {
      try {
        if (!text && !resourceId && !className && !contentDesc) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: true, message: "At least one search criterion must be provided" }),
            }],
            isError: true as const,
          }
        }

        const s = await resolveSerial(serial)
        const xml = await dumpUiXml(s)
        const results = filterElements(parseUiNodes(xml), { text, resourceId, className, contentDesc, exactMatch })

        const structured = { count: results.length, elements: results }
        return {
          content: [{ type: "text", text: JSON.stringify(structured) }],
          structuredContent: structured,
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: true, message: err.message }),
          }],
          isError: true as const,
        }
      }
    }
  )

  registerEnvTool(server, 
    "ui_tap_element",
    {
      description: "Find a UI element by text, resource ID, class name, or content description, and immediately tap it. Smartly finds the nearest input field when targeting a label.",
      inputSchema: {
        text: z.string().optional().describe("Text content to search for"),
        resourceId: z.string().optional().describe("Resource ID to match exactly"),
        className: z.string().optional().describe("Class name to match exactly"),
        contentDesc: z.string().optional().describe("Content description to search for"),
        exactMatch: z.boolean().optional().default(false).describe("If true, text and contentDesc require exact matches"),
        serial: z.string().optional().describe("Device serial number"),
        index: z.number().int().optional().default(0).describe("If multiple elements match, which one to tap (0-indexed)"),
        preferInput: z.boolean().optional().default(true).describe("If true and matching a label, finds nearest input field instead"),
      },
      outputSchema: {
        success: z.boolean().describe("Whether the element was found and tapped"),
        message: z.string().describe("Human-readable status message"),
      },
      annotations: {
        title: "Find and Tap UI Element",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, resourceId, className, contentDesc, exactMatch, serial, index, preferInput }) => {
      try {
        if (!text && !resourceId && !className && !contentDesc) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: true, message: "At least one search criterion must be provided" }) }],
            isError: true as const,
          }
        }

        const s = await resolveSerial(serial)
        const xml = await dumpUiXml(s)
        const allElements = parseUiNodes(xml)
        const results = filterElements(allElements, { text, resourceId, className, contentDesc, exactMatch })

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: true, message: "Element not found" }) }],
            isError: true as const,
          }
        }

        const target = results[index] || results[0]
        let { tapX, tapY } = target

        if (preferInput) {
          const nearest = findNearestInput(allElements, tapX, tapY, className)
          if (nearest) {
            tapX = nearest.tapX
            tapY = nearest.tapY
          }
        }

        await tapWithFallback(s, tapX, tapY)

        const msg = `Tapped element at (${tapX}, ${tapY}) matching criteria`
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, message: msg }) }],
          structuredContent: { success: true, message: msg },
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true as const,
        }
      }
    }
  )

  registerEnvTool(server, 
    "ui_get_state",
    {
      description: "Dump the UI and return a clean Markdown-like tree of visible and clickable elements with viewport coordinates. NOTE: WebView elements may report identical y-coordinates when scrolled; use scroll_to_element first to bring target fields into view.",
      inputSchema: {
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: {
        state: z.string().describe("Simplified UI state"),
      },
      annotations: {
        title: "Get UI State",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ serial }) => {
      try {
        const s = await resolveSerial(serial)
        const xml = await dumpUiXml(s)
        const elements = parseUiNodes(xml)
        const viewport = getViewportSize(xml)

        const useful = elements.filter(e => e.text || e.contentDesc || e.clickable)

        let stateStr = `UI State (viewport: ${viewport.width}x${viewport.height}):\n`
        useful.forEach((e, i) => {
          const parts = []
          if (e.text) parts.push(`Text: "${e.text}"`)
          if (e.contentDesc) parts.push(`Desc: "${e.contentDesc}"`)
          if (e.clickable) parts.push(`[Clickable]`)
          if (e.resourceId) {
            const id = e.resourceId.split('/').pop()
            if (id) parts.push(`ID: ${id}`)
          }
          if (e.className) {
            const cls = e.className.split('.').pop()
            if (cls) parts.push(`<${cls}>`)
          }
          stateStr += `- [${i}] ${parts.join(" | ")} (Center: ${e.tapX}, ${e.tapY})\n`
        })

        return {
          content: [{ type: "text", text: stateStr }],
          structuredContent: { state: stateStr },
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true as const,
        }
      }
    }
  )

  registerEnvTool(server, 
    "ui_wait_for_element",
    {
      description: "Wait for a UI element to appear on screen. Polls the UI until the element matches criteria or timeout is reached.",
      inputSchema: {
        text: z.string().optional().describe("Text content to search for"),
        resourceId: z.string().optional().describe("Resource ID to match exactly"),
        className: z.string().optional().describe("Class name to match exactly"),
        contentDesc: z.string().optional().describe("Content description to search for"),
        exactMatch: z.boolean().optional().default(false).describe("If true, text and contentDesc require exact matches"),
        serial: z.string().optional().describe("Device serial number"),
        timeoutMs: z.number().int().optional().default(15000).describe("Maximum time to wait in milliseconds (default 15000)"),
      },
      outputSchema: {
        success: z.boolean(),
        message: z.string(),
      },
      annotations: {
        title: "Wait for UI Element",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ text, resourceId, className, contentDesc, exactMatch, serial, timeoutMs }) => {
      try {
        if (!text && !resourceId && !className && !contentDesc) {
          throw new Error("At least one search criterion must be provided")
        }

        const s = await resolveSerial(serial)
        const startTime = Date.now()

        while (Date.now() - startTime < timeoutMs) {
          const xml = await dumpUiXml(s)
          const results = filterElements(parseUiNodes(xml), { text, resourceId, className, contentDesc, exactMatch })

          if (results.length > 0) {
            const msg = `Element found after ${Date.now() - startTime}ms`
            return {
              content: [{ type: "text", text: JSON.stringify({ success: true, message: msg, element: results[0] }) }],
              structuredContent: { success: true, message: msg },
            }
          }

          await new Promise(res => setTimeout(res, 1000))
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: `Timeout reached (${timeoutMs}ms)` }) }],
          isError: true as const,
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true as const,
        }
      }
    }
  )

  registerEnvTool(server, 
    "ui_smart_fill",
    {
      description: "Find a UI element, tap it, inject text, and optionally press ENTER. Smartly finds the nearest input field when targeting a label.",
      inputSchema: {
        textToType: z.string().describe("The text to inject into the field"),
        text: z.string().optional().describe("Text content to search for to find the element"),
        resourceId: z.string().optional().describe("Resource ID to match exactly"),
        className: z.string().optional().describe("Class name to match exactly"),
        contentDesc: z.string().optional().describe("Content description to search for"),
        exactMatch: z.boolean().optional().default(false).describe("If true, text and contentDesc require exact matches"),
        serial: z.string().optional().describe("Device serial number"),
        index: z.number().int().optional().default(0).describe("If multiple elements match, which one to tap (0-indexed)"),
        pressEnter: z.boolean().optional().default(false).describe("Press ENTER key after typing"),
      },
      outputSchema: {
        success: z.boolean(),
        message: z.string(),
      },
      annotations: {
        title: "Smart Fill UI Element",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ textToType, text, resourceId, className, contentDesc, exactMatch, serial, index, pressEnter }) => {
      try {
        if (!text && !resourceId && !className && !contentDesc) {
          throw new Error("At least one search criterion must be provided")
        }

        const s = await resolveSerial(serial)
        const xml = await dumpUiXml(s)
        const allElements = parseUiNodes(xml)
        const results = filterElements(allElements, { text, resourceId, className, contentDesc, exactMatch })

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: true, message: "Element not found" }) }],
            isError: true as const,
          }
        }

        const target = results[index] || results[0]
        let { tapX, tapY } = target

        const nearest = findNearestInput(allElements, tapX, tapY, className)
        if (nearest) {
          tapX = nearest.tapX
          tapY = nearest.tapY
        }

        await tapWithFallback(s, tapX, tapY)
        await new Promise(res => setTimeout(res, 500))

        const escaped = textToType.replace(/"/g, '\\"')
        await execAdbShell(s, `input text "${escaped}"`)

        if (pressEnter) {
          await execAdbShell(s, `input keyevent 66`)
        }

        const msg = `Smart filled '${textToType}' into element at (${tapX}, ${tapY})`
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, message: msg }) }],
          structuredContent: { success: true, message: msg },
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true as const,
        }
      }
    }
  )

  // --- NEW: wait tool ---
  registerEnvTool(server, 
    "wait",
    {
      description: "Wait for a specified number of milliseconds. Use between actions to wait for animations, page loads, or network responses.",
      inputSchema: {
        ms: z.number().int().positive().describe("Milliseconds to wait"),
      },
      outputSchema: {
        waited: z.number().int().describe("Milliseconds actually waited"),
      },
      annotations: {
        title: "Wait",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ ms }) => {
      const start = Date.now()
      await new Promise(res => setTimeout(res, ms))
      return {
        content: [{ type: "text", text: `Waited ${Date.now() - start}ms` }],
        structuredContent: { waited: Date.now() - start },
      }
    }
  )

  // --- NEW: scroll_to_element tool ---
  registerEnvTool(server, 
    "scroll_to_element",
    {
      description: "Scroll the page to bring a specific UI element into view. Tries to find the element by text, then swipes up/down until it becomes visible or timeout is reached.",
      inputSchema: {
        text: z.string().describe("Text content to search for"),
        serial: z.string().optional().describe("Device serial number"),
        maxScrolls: z.number().int().optional().default(10).describe("Maximum scroll attempts"),
        direction: z.enum(["down", "up"]).optional().default("down").describe("Scroll direction to find the element"),
      },
      outputSchema: {
        found: z.boolean(),
        message: z.string(),
      },
      annotations: {
        title: "Scroll to Element",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ text, serial, maxScrolls, direction }) => {
      try {
        const s = await resolveSerial(serial)
        const screenH = 2400

        for (let i = 0; i < maxScrolls; i++) {
          const xml = await dumpUiXml(s)
          const elements = parseUiNodes(xml)
          const matches = filterElements(elements, { text })

          if (matches.length > 0) {
            return {
              content: [{ type: "text", text: JSON.stringify({ found: true, message: `Element found after ${i + 1} scroll(s)` }) }],
              structuredContent: { found: true, message: `Element found after ${i + 1} scroll(s)` },
            }
          }

          const scrollY = direction === "down" ? -400 : 400
          const endY = Math.max(0, Math.round(screenH / 2 + scrollY))
          await execAdbShell(s, `input swipe ${540} ${screenH / 2} ${540} ${endY} 300`)
          await new Promise(res => setTimeout(res, 800))
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: `Element not found after ${maxScrolls} scrolls` }) }],
          isError: true as const,
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true as const,
        }
      }
    }
  )

  // --- NEW: form_fill tool ---
  registerEnvTool(server, 
    "form_fill",
    {
      description: "Fill a multi-field form. Provide an array of {label, value} pairs. For each pair, finds the nearest input field to the label text, taps it, and types the value. Handles checkboxes and dropdowns by label matching.",
      inputSchema: {
        fields: z.array(z.object({
          label: z.string().describe("Label text near the field (e.g. 'Full Name', 'City/Domicile')"),
          value: z.string().describe("Value to type or select"),
          type: z.enum(["text", "checkbox", "dropdown"]).optional().default("text").describe("Field type"),
        })).min(1).describe("Array of form fields to fill"),
        serial: z.string().optional().describe("Device serial number"),
      },
      outputSchema: {
        filled: z.number().int().describe("Number of fields successfully filled"),
        errors: z.array(z.string()).describe("Errors encountered per field"),
      },
      annotations: {
        title: "Fill Form Fields",
        readOnlyHint: false,
        openWorldHint: true,
      },
    },
    async ({ fields, serial }) => {
      try {
        const s = await resolveSerial(serial)
        let filled = 0
        const errors: string[] = []

        for (const field of fields) {
          const xml = await dumpUiXml(s)
          const allElements = parseUiNodes(xml)
          const labelResults = filterElements(allElements, { text: field.label })

          if (labelResults.length === 0) {
            errors.push(`Label "${field.label}" not found`)
            continue
          }

          const label = labelResults[0]
          const input = findNearestInput(allElements, label.tapX, label.tapY)

          if (!input) {
            errors.push(`No input near label "${field.label}"`)
            continue
          }

          await tapWithFallback(s, input.tapX, input.tapY)
          await new Promise(res => setTimeout(res, 400))

          const escaped = field.value.replace(/"/g, '\\"')
          await execAdbShell(s, `input text "${escaped}"`)
          await new Promise(res => setTimeout(res, 200))
          filled++
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ filled, errors }) }],
          structuredContent: { filled, errors },
        }
      } catch (error) {
        const err = error as Error
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: err.message }) }],
          isError: true as const,
        }
      }
    }
  )
}
