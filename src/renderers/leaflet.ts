import { getBlobCidString, parseLexLink, type BlobRef } from "@atproto/lex"
import escapeHtml from "escape-html"
import katex from "katex"
import slugify from "slugify"
import { codeToHtml } from "shiki"
import { pub } from "../lexicons"
import type {
  StandardSiteDocumentRendererOptions,
  RenderedContent,
  RendererFunction,
} from "./types"
import { mergeArr, utf8ByteToCodeUnitMap } from "./utils"

type Facet = pub.leaflet.richtext.facet.Main

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
    const merged = Array.from(new Set(active.flatMap((r) => r.features)))
    result.push({ index: { byteStart: start, byteEnd: end }, features: merged })
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
    if (start > cursor) segments.push({ text: text.slice(cursor, start) })
    segments.push({ text: text.slice(start, end), facet })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

function applyFacet(html: string, features: Facet["features"]): string {
  for (const f of features) {
    if (f.$type === "pub.leaflet.richtext.facet#bold") html = `<strong>${html}</strong>`
    if (f.$type === "pub.leaflet.richtext.facet#italic") html = `<em>${html}</em>`
    if (f.$type === "pub.leaflet.richtext.facet#underline") html = `<u>${html}</u>`
    if (f.$type === "pub.leaflet.richtext.facet#strikethrough") html = `<s>${html}</s>`
    if (f.$type === "pub.leaflet.richtext.facet#code") html = `<code>${html}</code>`
    if (f.$type === "pub.leaflet.richtext.facet#highlight") html = `<mark>${html}</mark>`
    if (f.$type === "pub.leaflet.richtext.facet#link" && "uri" in f)
      html = `<a href="${escapeHtml(f.uri)}">${html}</a>`
  }
  return html
}

function renderRichTextHtml(plaintext: string, facets: Facet[] = []) {
  const splitText = applyFacetsToText(plaintext, splitAndMerge(facets))
  return splitText
    .map((st) =>
      st.facet ? applyFacet(escapeHtml(st.text), st.facet.features) : escapeHtml(st.text),
    )
    .join("")
}

function isRenderedContent(block: RenderedContent | undefined): block is RenderedContent {
  return !!block
}

function mergeMetadata(blocks: RenderedContent[]): RenderedContent["metadata"] {
  return blocks
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
}

function blueskyPostUrl(uri: string) {
  const match = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri)
  if (!match) return uri
  return `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`
}

function resolveBlobSrc(blob: BlobRef | undefined, opts: StandardSiteDocumentRendererOptions) {
  if (!blob) return undefined
  if (!opts?.endpoint) throw new Error("Must have endpoint to resolve blob")
  const cid = "$link" in blob ? parseLexLink(blob) : blob
  return `${opts.endpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(opts.repoDid)}&cid=${encodeURIComponent(getBlobCidString(cid as BlobRef))}`
}

/**
 * Renders a single linearDocument block into HTML.
 */
async function renderLinearBlock(
  block: pub.leaflet.pages.linearDocument.Block,
  opts: StandardSiteDocumentRendererOptions,
): Promise<RenderedContent | undefined> {
  const b = block.block
  switch (b.$type) {
    case "pub.leaflet.blocks.text":
      return blockTextRenderer(b as pub.leaflet.blocks.text.Main, opts)
    case "pub.leaflet.blocks.header":
      return blockHeaderRenderer(b as pub.leaflet.blocks.header.Main, opts)
    case "pub.leaflet.blocks.blockquote":
      return blockBlockquoteRenderer(b as pub.leaflet.blocks.blockquote.Main, opts)
    case "pub.leaflet.blocks.bskyPost":
      return blockBskyPostRenderer(b as pub.leaflet.blocks.bskyPost.Main, opts)
    case "pub.leaflet.blocks.button":
      return blockButtonRenderer(b as pub.leaflet.blocks.button.Main, opts)
    case "pub.leaflet.blocks.code":
      return blockCodeRenderer(b as pub.leaflet.blocks.code.Main, opts)
    case "pub.leaflet.blocks.horizontalRule":
      return Promise.resolve({ html: "<hr />", metadata: {} })
    case "pub.leaflet.blocks.iframe":
      return blockIframeRenderer(b as pub.leaflet.blocks.iframe.Main, opts)
    case "pub.leaflet.blocks.image":
      return blockImageRenderer(b as pub.leaflet.blocks.image.Main, opts)
    case "pub.leaflet.blocks.math":
      return blockMathRenderer(b as pub.leaflet.blocks.math.Main, opts)
    case "pub.leaflet.blocks.orderedList":
      return blockOrderedListRenderer(b as pub.leaflet.blocks.orderedList.Main, opts)
    case "pub.leaflet.blocks.unorderedList":
      return blockUnorderedListRenderer(b as pub.leaflet.blocks.unorderedList.Main, opts)
    case "pub.leaflet.blocks.website":
      return blockWebsiteRenderer(b as pub.leaflet.blocks.website.Main, opts)
    case "pub.leaflet.blocks.page":
      return blockPageRenderer(b as pub.leaflet.blocks.page.Main, opts)
    case "pub.leaflet.blocks.poll":
      return blockPollRenderer(b as pub.leaflet.blocks.poll.Main, opts)
    default:
      return Promise.resolve(undefined)
  }
}

/**
 * Renders the `pub.leaflet.content` lexicon.
 * Iterates over pages and renders each linearDocument or canvas page.
 */
export const contentRenderer: RendererFunction<
  pub.leaflet.content.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const renderingPages = entry.pages.map((page): Promise<RenderedContent | undefined> => {
    if (page.$type === "pub.leaflet.pages.linearDocument") {
      return linearDocumentRenderer(page as pub.leaflet.pages.linearDocument.Main, opts)
    }
    // canvas pages are not linearly renderable to HTML
    return Promise.resolve(undefined)
  })
  const mappedPages = (await Promise.all(renderingPages)).filter(isRenderedContent)
  return {
    html: mappedPages.map((p) => p.html).join(""),
    metadata: mergeMetadata(mappedPages),
  }
}

/**
 * Renders a `pub.leaflet.pages.linearDocument` page into HTML.
 */
export const linearDocumentRenderer: RendererFunction<
  pub.leaflet.pages.linearDocument.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const blocks = (
    await Promise.all(
      entry.blocks.map((block) =>
        renderLinearBlock(block as pub.leaflet.pages.linearDocument.Block, opts),
      ),
    )
  ).filter(isRenderedContent)
  return {
    html: blocks.map((b) => b.html).join(""),
    metadata: mergeMetadata(blocks),
  }
}

export const blockTextRenderer: RendererFunction<pub.leaflet.blocks.text.Main> = async (entry) => {
  const sizeClass =
    entry.textSize === "small"
      ? ' class="text-small"'
      : entry.textSize === "large"
        ? ' class="text-large"'
        : ""
  return {
    html: `<p${sizeClass}>${renderRichTextHtml(entry.plaintext, entry.facets ?? [])}</p>`,
    metadata: {},
  }
}

export const blockHeaderRenderer: RendererFunction<pub.leaflet.blocks.header.Main> = async (
  entry,
) => {
  const level = entry.level ?? 2
  if (level < 1 || level > 6) throw new Error("Invalid heading level")
  const html = renderRichTextHtml(entry.plaintext, entry.facets ?? [])
  return {
    html: `<h${level} id="${slugify(entry.plaintext)}">${html}</h${level}>`,
    metadata: {
      headings: [{ depth: level, slug: slugify(entry.plaintext), text: html }],
    },
  }
}

export const blockBlockquoteRenderer: RendererFunction<pub.leaflet.blocks.blockquote.Main> = async (
  entry,
) => ({
  html: `<blockquote><p>${renderRichTextHtml(entry.plaintext, entry.facets ?? [])}</p></blockquote>`,
  metadata: {},
})

export const blockBskyPostRenderer: RendererFunction<pub.leaflet.blocks.bskyPost.Main> = async (
  entry,
) => {
  const uri = entry.postRef.uri
  const href = blueskyPostUrl(uri)
  return {
    html: `<blockquote class="bluesky-embed" data-bluesky-uri="${escapeHtml(uri)}"><a href="${escapeHtml(href)}">View Bluesky post</a><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script></blockquote>`,
    metadata: {},
  }
}

export const blockButtonRenderer: RendererFunction<pub.leaflet.blocks.button.Main> = async (
  entry,
) => ({
  html: `<a class="button" href="${escapeHtml(entry.url)}">${escapeHtml(entry.text)}</a>`,
  metadata: {},
})

export const blockCodeRenderer: RendererFunction<
  pub.leaflet.blocks.code.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const shikiConfig = opts?.shikiConfig
  return {
    html: await codeToHtml(entry.plaintext, {
      transformers: [
        {
          pre(this, el) {
            el.properties.class = `astro-code ${el.properties.class as string}`
            return el
          },
        },
      ],
      lang: entry.language ?? "text",
      themes:
        shikiConfig && "themes" in shikiConfig
          ? { light: shikiConfig.themes.light, dark: shikiConfig.themes.dark }
          : {
              light: shikiConfig?.theme ?? "github-light",
              dark: shikiConfig?.theme ?? "github-dark",
            },
      defaultColor: opts?.shikiConfig?.defaultColor,
    }),
    metadata: {},
  }
}

export const blockIframeRenderer: RendererFunction<
  pub.leaflet.blocks.iframe.Main,
  StandardSiteDocumentRendererOptions
> = async (entry) => {
  const heightAttr = entry.height ? ` height="${entry.height}"` : ""
  return {
    html: `<iframe src="${escapeHtml(entry.url)}" loading="lazy" allowfullscreen${heightAttr}></iframe>`,
    metadata: {},
  }
}

export const blockImageRenderer: RendererFunction<
  pub.leaflet.blocks.image.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const src = resolveBlobSrc(entry.image, opts)
  const aspectStyle = `aspect-ratio:${entry.aspectRatio.width}/${entry.aspectRatio.height}`
  const fullBleedStyle = entry.fullBleed ? ";width:100%;max-width:none" : ""
  const style = ` style="${aspectStyle}${fullBleedStyle}"`

  if (!src) return { html: `<figure${style}></figure>`, metadata: {} }

  return {
    html: `<figure${style}><img src="${escapeHtml(src)}" alt="${escapeHtml(entry.alt ?? "")}" loading="lazy" /></figure>`,
    metadata: { imagePaths: [src] },
  }
}

export const blockMathRenderer: RendererFunction<pub.leaflet.blocks.math.Main> = async (entry) => ({
  html: `<link href="https://cdn.jsdelivr.net/npm/katex@0.16.45/dist/katex.min.css" rel="stylesheet">${katex.renderToString(entry.tex, { displayMode: true, throwOnError: false })}`,
  metadata: {},
})

function renderLeafletListItems(
  items: pub.leaflet.blocks.unorderedList.ListItem[],
  tag: "ul" | "ol",
  start?: number,
): string {
  const itemsHtml = items
    .map((item) => {
      const content = item.content
      let innerHtml = ""
      if (content.$type === "pub.leaflet.blocks.text") {
        const t = content as pub.leaflet.blocks.text.Main
        innerHtml = renderRichTextHtml(t.plaintext, t.facets ?? [])
      } else if (content.$type === "pub.leaflet.blocks.header") {
        const h = content as pub.leaflet.blocks.header.Main
        innerHtml = renderRichTextHtml(h.plaintext, h.facets ?? [])
      }

      if (item.checked != null) {
        const checked = item.checked ? " checked" : ""
        return `<li class="task-list-item" style="display:flex;gap:12px"><input type="checkbox" disabled${checked} />${innerHtml}</li>`
      }
      return `<li>${innerHtml}</li>`
    })
    .join("")
  const startAttr = tag === "ol" && start != null && start !== 1 ? ` start="${start}"` : ""
  return `<${tag}${startAttr}>${itemsHtml}</${tag}>`
}

export const blockUnorderedListRenderer: RendererFunction<
  pub.leaflet.blocks.unorderedList.Main
> = async (entry) => ({
  html: renderLeafletListItems(entry.children as pub.leaflet.blocks.unorderedList.ListItem[], "ul"),
  metadata: {},
})

export const blockOrderedListRenderer: RendererFunction<
  pub.leaflet.blocks.orderedList.Main
> = async (entry) => ({
  html: renderLeafletListItems(
    entry.children as pub.leaflet.blocks.unorderedList.ListItem[],
    "ol",
    entry.startIndex,
  ),
  metadata: {},
})

export const blockWebsiteRenderer: RendererFunction<
  pub.leaflet.blocks.website.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const title = escapeHtml(entry.title ?? entry.src)
  const description = entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""
  const previewSrc = resolveBlobSrc(entry.previewImage, opts)
  const preview = previewSrc ? `<img src="${escapeHtml(previewSrc)}" alt="" loading="lazy" />` : ""
  return {
    html: `<article class="web-bookmark">${preview}<div><a href="${escapeHtml(entry.src)}">${title}</a>${description}</div></article>`,
    metadata: {},
  }
}

export const blockPageRenderer: RendererFunction<pub.leaflet.blocks.page.Main> = async (entry) => ({
  html: `<a class="page-link" data-page-id="${escapeHtml(entry.id)}">Page: ${escapeHtml(entry.id)}</a>`,
  metadata: {},
})

export const blockPollRenderer: RendererFunction<pub.leaflet.blocks.poll.Main> = async (entry) => ({
  html: `<div class="poll-embed" data-poll-uri="${escapeHtml(entry.pollRef.uri)}"><a href="#poll-${escapeHtml(entry.pollRef.cid ?? "")}">View poll</a></div>`,
  metadata: {},
})
