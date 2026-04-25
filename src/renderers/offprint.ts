import slugify from "slugify"
import { app } from "../lexicons"
import type { RenderedContent, RendererFunction } from "./types"
import { mergeArr, utf8ByteToCodeUnitMap } from "./utils"

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
    const active = facets.filter((f) => f.index.byteStart <= start && end <= f.index.byteEnd)
    if (active.length === 0) continue
    // merge arrays (dedup optional)
    const merged = Array.from(new Set(active.flatMap((r) => r.features)))

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

function applyFacetsToText(text: string, facets: Facet[]): { text: string; facet?: Facet }[] {
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
      facet,
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
    if (f.$type === "app.offprint.richtext.facet#bold") html = `<strong>${html}</strong>`
    if (f.$type === "app.offprint.richtext.facet#italic") html = `<em>${html}</em>`
    if (f.$type === "app.offprint.richtext.facet#underline") html = `<u>${html}</u>`
    if (f.$type === "app.offprint.richtext.facet#strikethrough") html = `<s>${html}</s>`
    if (f.$type === "app.offprint.richtext.facet#code") html = `<code>${html}</code>`
    if (f.$type === "app.offprint.richtext.facet#highlight")
      html =
        "color" in f
          ? `<mark style="background-color:${f.color};">${html}</mark>`
          : `<mark>${html}</mark>`
    if (f.$type === "app.offprint.richtext.facet#link" && "uri" in f)
      html = `<a href="${f.uri}">${html}</a>`
    if (f.$type === "app.offprint.richtext.facet#mention") html = `<a data-mention>${html}</a>`
    if (f.$type === "app.offprint.richtext.facet#webMention")
      html = `<a data-web-mention>${html}</a>`
  }
  return html
}

/**
 * Renders the `app.offprint.content` lexicon.
 */
export const contentRenderer: RendererFunction<app.offprint.content.Main> = async (entry) => {
  const renderingBlocks = entry.items.map((i): Promise<RenderedContent | undefined> => {
    switch (i.$type) {
      case "app.offprint.block.text":
        return blockTextRenderer(i as app.offprint.block.text.Main)
      case "app.offprint.block.heading":
        return blockHeadingRenderer(i as app.offprint.block.heading.Main)
      case "app.offprint.block.blockquote": {
        throw new Error('Not implemented yet: "app.offprint.block.blockquote" case')
      }
      case "app.offprint.block.blueskyPost": {
        throw new Error('Not implemented yet: "app.offprint.block.blueskyPost" case')
      }
      case "app.offprint.block.bulletList": {
        throw new Error('Not implemented yet: "app.offprint.block.bulletList" case')
      }
      case "app.offprint.block.button": {
        throw new Error('Not implemented yet: "app.offprint.block.button" case')
      }
      case "app.offprint.block.callout": {
        throw new Error('Not implemented yet: "app.offprint.block.callout" case')
      }
      case "app.offprint.block.codeBlock": {
        throw new Error('Not implemented yet: "app.offprint.block.codeBlock" case')
      }
      case "app.offprint.block.horizontalRule": {
        throw new Error('Not implemented yet: "app.offprint.block.horizontalRule" case')
      }
      case "app.offprint.block.image": {
        throw new Error('Not implemented yet: "app.offprint.block.image" case')
      }
      case "app.offprint.block.imageCarousel": {
        throw new Error('Not implemented yet: "app.offprint.block.imageCarousel" case')
      }
      case "app.offprint.block.imageDiff": {
        throw new Error('Not implemented yet: "app.offprint.block.imageDiff" case')
      }
      case "app.offprint.block.imageGrid": {
        throw new Error('Not implemented yet: "app.offprint.block.imageGrid" case')
      }
      case "app.offprint.block.mathBlock": {
        throw new Error('Not implemented yet: "app.offprint.block.mathBlock" case')
      }
      case "app.offprint.block.orderedList": {
        throw new Error('Not implemented yet: "app.offprint.block.orderedList" case')
      }
      case "app.offprint.block.taskList": {
        throw new Error('Not implemented yet: "app.offprint.block.taskList" case')
      }
      case "app.offprint.block.webBookmark": {
        throw new Error('Not implemented yet: "app.offprint.block.webBookmark" case')
      }
      case "app.offprint.block.webEmbed": {
        throw new Error('Not implemented yet: "app.offprint.block.webEmbed" case')
      }
    }
    throw new Error(`Unknown block type: ${i.$type}`)
  })
  const mappedBlocks = (await Promise.all(renderingBlocks)).filter((b) => !!b).map((b) => b!)
  console.log({ mappedBlocks })
  const html = mappedBlocks.map((b) => b.html).join("")
  const metadata = mappedBlocks
    .map((b) => b.metadata)
    .reduce(
      (acc, curr) => ({
        ...acc,
        ...curr,
        imagePaths: mergeArr(acc?.imagePaths, curr?.imagePaths),
        frontmatter: { ...acc?.frontmatter, ...curr?.frontmatter },
        headings: mergeArr(acc?.headings, curr?.headings),
      }),
      {},
    )
  return {
    html,
    metadata,
  }
}

/**
 * Renders the `app.offprint.block.text` lexicon.
 */
export const blockTextRenderer: RendererFunction<app.offprint.block.text.Main> = async (entry) => {
  const { plaintext } = entry
  const facets = splitAndMerge(entry.facets ?? [])
  const splitText = applyFacetsToText(plaintext, facets)
  const html = splitText
    .map((st) => (st.facet ? applyFacet(st.text, st.facet.features) : st.text))
    .join("")
  return {
    html: `<p>${html}</p>`,
    metadata: {},
  }
}

/**
 * Renders the `app.offprint.block.heading` lexicon.
 */
export const blockHeadingRenderer: RendererFunction<app.offprint.block.heading.Main> = async (
  entry,
) => {
  const { level, plaintext, textAlign } = entry
  if (level < 1 || level > 6) throw new Error("Invalid heading level")
  const facets = splitAndMerge(entry.facets ?? [])
  const splitText = applyFacetsToText(plaintext, facets)
  const html = splitText
    .map((st) => (st.facet ? applyFacet(st.text, st.facet.features) : st.text))
    .join("")
  return {
    html: `<h${level} id="${slugify(plaintext)}" style="text-align:${textAlign ?? "left"}">${html}</h${level}>`,
    metadata: {
      headings: [
        {
          depth: level,
          slug: slugify(plaintext),
          text: html,
        },
      ],
    },
  }
}
