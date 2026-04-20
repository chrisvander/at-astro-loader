import { app } from "../lexicons"
import type { RendererFunction } from "./types"

type Facet = app.offprint.richtext.facet.Main
function splitAndMerge(facets: Facet[]): Facet[] {
  const points = new Set<number>()
  for (const f of facets) {
    if (f.index.byteEnd <= f.index.byteStart) continue
    points.add(f.index.byteStart)
    points.add(f.index.byteEnd)
  }

  const sorted = [...points].sort((a, b) => a - b)
  const result: Facet[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]
    const end = sorted[i + 1]
    const active = facets.filter(
      (f) => f.index.byteStart <= start && end <= f.index.byteEnd
    )
    if (active.length === 0) continue
    // merge arrays (dedup optional)
    const merged = Array.from(
      new Set(active.flatMap((r) => r.features))
    )

    result.push({
      index: {
        byteStart: start,
        byteEnd: end,
      },
      features: merged,
    })
  }
  return result
}

function utf8ByteToCodeUnitMap(text: string): number[] {
  const encoder = new TextEncoder()
  const map: number[] = []

  let bytePos = 0

  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!
    const char = String.fromCodePoint(cp)
    const bytes = encoder.encode(char)

    for (let b = 0; b < bytes.length; b++) {
      map[bytePos + b] = i
    }

    bytePos += bytes.length
    i += char.length
  }

  map[bytePos] = text.length
  return map
}

function applyFacetsToText(
  text: string,
  facets: Facet[]
): { text: string; facet?: Facet }[] {
  const byteMap = utf8ByteToCodeUnitMap(text)
  const segments: { text: string; facet?: Facet }[] = []
  let cursor = 0
  for (const facet of facets) {
    const start = byteMap[facet.index.byteStart]
    const end = byteMap[facet.index.byteEnd]
    if (start > cursor) {
      // gap → plain text
      segments.push({ text: text.slice(cursor, start) })
    }
    segments.push({
      text: text.slice(start, end),
      facet
    })
    cursor = end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) })
  }
  return segments
}

/**
 * Applies a facet to the given text.
 */
function applyFacet(html: string, facet: app.offprint.richtext.facet.Main["features"]) {
  for (const f of facet) {
    if (f.$type === "app.offprint.richtext.facet#bold")
      html = `<strong>${html}</strong>`
    if (f.$type === "app.offprint.richtext.facet#italic")
      html = `<em>${html}</em>`
    if (f.$type === "app.offprint.richtext.facet#underline")
      html = `<u>${html}</u>`
    if (f.$type === "app.offprint.richtext.facet#strikethrough")
      html = `<s>${html}</s>`
    if (f.$type === "app.offprint.richtext.facet#code")
      html = `<code>${html}</code>`
    if (f.$type === "app.offprint.richtext.facet#highlight")
      html = "color" in f ? `<mark style="background-color:${f.color};">${html}</mark>` : `<mark>${html}</mark>`
    if (f.$type === "app.offprint.richtext.facet#link" && "uri" in f)
      html = `<a href="${f.uri}">${html}</a>`
    if (f.$type === "app.offprint.richtext.facet#mention")
      html = `<a data-mention>${html}</a>`
    if (f.$type === "app.offprint.richtext.facet#webMention")
      html = `<a data-web-mention>${html}</a>`
  }
  return html
}

/**
 * Renders the `app.offprint.content` lexicon.
 */
export const contentRenderer: RendererFunction<app.offprint.content.Main> = async (entry) => {
  return {
    html: entry.items.map(i => {
      switch (i.$type) {
        case "app.offprint.block.text":
          return blockTextRenderer(i as app.offprint.block.text.Main)
        default:
          throw new Error("Unsupported block type")
      }
    }).join(""),
    metadata: {}
  }
}

/**
 * Renders the `app.offprint.block.text` lexicon.
 */
export const blockTextRenderer: RendererFunction<app.offprint.block.text.Main> = async (entry) => {
  const { plaintext } = entry
  const facets = splitAndMerge(entry.facets ?? [])
  const splitText = applyFacetsToText(plaintext, facets)
  const html = splitText.map(st => st.facet ? applyFacet(st.text, st.facet.features) : st.text).join("")
  return {
    html,
    metadata: {}
  }
}
