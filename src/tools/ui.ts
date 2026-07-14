import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
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
      const m = attrs.match(new RegExp(`${name}="([^"]*)"`) )
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

export async function dumpUiXml(serial: string): Promise<string> {
  const tmpPath = `/sdcard/.ui_dump_${Date.now()}_${Math.random().toString(36).slice(2)}.xml`
  const raw = await execAdbShell(
    serial,
    `uiautomator dump --compressed ${tmpPath} 2>/dev/null; cat ${tmpPath}; rm -f ${tmpPath}`
  )
  return raw.replace(/UI hier[^\n]*dumped to:[^\n]*/gi, "").trim()
}

function filterElements(
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

    // Fallback to contentDesc if text match yields nothing
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

export function registerUiTools(server: McpServer): void {
  server.registerTool(
    "ui_dump",
    {
      description: "Dump the full UI hierarchy of the current screen as XML. Useful for understanding screen structure before using ui_find_element.",
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

  server.registerTool(
    "ui_find_element",
    {
      description: "Find UI elements on screen by text, resource ID, class name, or content description. Returns matching elements with their tap coordinates. At least one search criterion must be provided.",
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
            text: z.string().describe("Visible text of the element"),
            resourceId: z.string().describe("Resource ID of the element"),
            className: z.string().describe("Widget class name"),
            contentDesc: z.string().describe("Content description (accessibility label)"),
            bounds: z.string().describe("Raw bounds string [x1,y1][x2,y2]"),
            tapX: z.number().int().describe("X coordinate of the element center"),
            tapY: z.number().int().describe("Y coordinate of the element center"),
            clickable: z.boolean().describe("Whether the element is clickable"),
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

  server.registerTool(
    "ui_tap_element",
    {
      description: "Find a UI element by text, resource ID, class name, or content description, and immediately tap it. Returns success if found and tapped.",
      inputSchema: {
        text: z.string().optional().describe("Text content to search for"),
        resourceId: z.string().optional().describe("Resource ID to match exactly"),
        className: z.string().optional().describe("Class name to match exactly"),
        contentDesc: z.string().optional().describe("Content description to search for"),
        exactMatch: z.boolean().optional().default(false).describe("If true, text and contentDesc require exact matches"),
        serial: z.string().optional().describe("Device serial number"),
        index: z.number().int().optional().default(0).describe("If multiple elements match, which one to tap (0-indexed)"),
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
    async ({ text, resourceId, className, contentDesc, exactMatch, serial, index }) => {
      try {
        if (!text && !resourceId && !className && !contentDesc) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: true, message: "At least one search criterion must be provided" }) }],
            isError: true as const,
          }
        }

        const s = await resolveSerial(serial)
        const xml = await dumpUiXml(s)
        const results = filterElements(parseUiNodes(xml), { text, resourceId, className, contentDesc, exactMatch })

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: true, message: "Element not found" }) }],
            isError: true as const,
          }
        }

        const target = results[index] || results[0]
        const { tapX, tapY } = target

        if (hasActiveSession(s)) {
          try {
            await tapViaScrcpy(s, tapX, tapY)
          } catch (e) {
            await execAdbShell(s, `input tap ${tapX} ${tapY}`)
          }
        } else {
          await execAdbShell(s, `input tap ${tapX} ${tapY}`)
        }

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

  server.registerTool(
    "ui_get_state",
    {
      description: "Dump the UI and return a clean, simplified Markdown-like tree of visible and clickable elements. Highly token-efficient for AI context.",
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
        
        const useful = elements.filter(e => e.text || e.contentDesc || e.clickable)
        
        let stateStr = "UI State:\n"
        useful.forEach((e, i) => {
          const parts = []
          if (e.text) parts.push(`Text: "${e.text}"`)
          if (e.contentDesc) parts.push(`Desc: "${e.contentDesc}"`)
          if (e.clickable) parts.push(`[Clickable]`)
          if (e.resourceId) {
            const id = e.resourceId.split('/').pop()
            if (id) parts.push(`ID: ${id}`)
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

  server.registerTool(
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

  server.registerTool(
    "ui_smart_fill",
    {
      description: "Find a UI element, tap it, inject text, and optionally press ENTER. Combines 4 actions into 1.",
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
        const results = filterElements(parseUiNodes(xml), { text, resourceId, className, contentDesc, exactMatch })

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: true, message: "Element not found" }) }],
            isError: true as const,
          }
        }

        const target = results[index] || results[0]
        const { tapX, tapY } = target

        if (hasActiveSession(s)) {
          try {
            await tapViaScrcpy(s, tapX, tapY)
          } catch (e) {
            await execAdbShell(s, `input tap ${tapX} ${tapY}`)
          }
        } else {
          await execAdbShell(s, `input tap ${tapX} ${tapY}`)
        }

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
}
