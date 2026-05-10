import { getBlobCidString, parseLexLink, type BlobRef } from "@atproto/lex"
import escapeHtml from "escape-html"
import slugify from "slugify"
import { codeToHtml } from "shiki"
import { blog } from "../lexicons"
import type {
  StandardSiteDocumentRendererOptions,
  RenderedContent,
  RendererFunction,
} from "./types"
import { mergeArr, utf8ByteToCodeUnitMap } from "./utils"

type Facet = blog.pckt.richtext.facet.Main

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
    if (f.$type === "blog.pckt.richtext.facet#bold") html = `<strong>${html}</strong>`
    if (f.$type === "blog.pckt.richtext.facet#italic") html = `<em>${html}</em>`
    if (f.$type === "blog.pckt.richtext.facet#underline") html = `<u>${html}</u>`
    if (f.$type === "blog.pckt.richtext.facet#strikethrough") html = `<s>${html}</s>`
    if (f.$type === "blog.pckt.richtext.facet#code") html = `<code>${html}</code>`
    if (f.$type === "blog.pckt.richtext.facet#highlight") html = `<mark>${html}</mark>`
    if (f.$type === "blog.pckt.richtext.facet#link" && "uri" in f)
      html = `<a href="${escapeHtml(f.uri)}">${html}</a>`
  }
  return html
}

function renderRichTextHtml(plaintext: string, facets: Facet[] = []) {
  const splitText = applyFacetsToText(plaintext, splitAndMerge(facets))
  return splitText
    .map((st) => (st.facet ? applyFacet(escapeHtml(st.text), st.facet.features) : escapeHtml(st.text)))
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
 * Renders the `blog.pckt.content` lexicon.
 * Handles both inline (items[]) and blob-based content.
 */
export const contentRenderer: RendererFunction<
  blog.pckt.content.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const items = entry.items ?? []
  // Items are typed as Unknown$TypedObject[] (pckt uses an open union with no explicit refs),
  // so we cast via unknown to access the typed block APIs.
  const renderingBlocks = items.map((i): Promise<RenderedContent | undefined> => {
    const u = i as unknown
    switch (i.$type) {
      case "blog.pckt.block.text":
        return blockTextRenderer(u as blog.pckt.block.text.Main, opts)
      case "blog.pckt.block.heading":
        return blockHeadingRenderer(u as blog.pckt.block.heading.Main, opts)
      case "blog.pckt.block.blockquote":
        return blockBlockquoteRenderer(u as blog.pckt.block.blockquote.Main, opts)
      case "blog.pckt.block.blueskyEmbed":
        return blockBlueskyEmbedRenderer(u as blog.pckt.block.blueskyEmbed.Main, opts)
      case "blog.pckt.block.bulletList":
        return blockBulletListRenderer(u as blog.pckt.block.bulletList.Main, opts)
      case "blog.pckt.block.codeBlock":
        return blockCodeBlockRenderer(u as blog.pckt.block.codeBlock.Main, opts)
      case "blog.pckt.block.gallery":
        return blockGalleryRenderer(u as blog.pckt.block.gallery.Main, opts)
      case "blog.pckt.block.hardBreak":
        return Promise.resolve({ html: "<br />", metadata: {} })
      case "blog.pckt.block.horizontalRule":
        return Promise.resolve({ html: "<hr />", metadata: {} })
      case "blog.pckt.block.iframe":
        return blockIframeRenderer(u as blog.pckt.block.iframe.Main, opts)
      case "blog.pckt.block.image":
        return blockImageRenderer(u as blog.pckt.block.image.Main, opts)
      case "blog.pckt.block.mention":
        return blockMentionRenderer(u as blog.pckt.block.mention.Main, opts)
      case "blog.pckt.block.orderedList":
        return blockOrderedListRenderer(u as blog.pckt.block.orderedList.Main, opts)
      case "blog.pckt.block.table":
        return blockTableRenderer(u as blog.pckt.block.table.Main, opts)
      case "blog.pckt.block.taskList":
        return blockTaskListRenderer(u as blog.pckt.block.taskList.Main, opts)
      case "blog.pckt.block.website":
        return blockWebsiteRenderer(u as blog.pckt.block.website.Main, opts)
      default:
        return Promise.resolve(undefined)
    }
  })
  const mappedBlocks = (await Promise.all(renderingBlocks)).filter(isRenderedContent)
  return {
    html: mappedBlocks.map((b) => b.html).join(""),
    metadata: mergeMetadata(mappedBlocks),
  }
}

export const blockTextRenderer: RendererFunction<blog.pckt.block.text.Main> = async (entry) => ({
  html: `<p>${renderRichTextHtml(entry.plaintext, entry.facets ?? [])}</p>`,
  metadata: {},
})

export const blockHeadingRenderer: RendererFunction<blog.pckt.block.heading.Main> = async (
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

export const blockBlockquoteRenderer: RendererFunction<
  blog.pckt.block.blockquote.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const blocks = (
    await Promise.all(
      entry.content.map((block) => {
        if (block.$type === "blog.pckt.block.text")
          return blockTextRenderer(block as blog.pckt.block.text.Main, opts)
        return Promise.resolve(undefined)
      }),
    )
  ).filter(isRenderedContent)
  return {
    html: `<blockquote>${blocks.map((b) => b.html).join("")}</blockquote>`,
    metadata: mergeMetadata(blocks),
  }
}

export const blockBlueskyEmbedRenderer: RendererFunction<
  blog.pckt.block.blueskyEmbed.Main
> = async (entry) => {
  const href = blueskyPostUrl(entry.postRef.uri)
  return {
    html: `<blockquote class="bluesky-embed" data-bluesky-uri="${escapeHtml(entry.postRef.uri)}"><a href="${escapeHtml(href)}">View Bluesky post</a><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script></blockquote>`,
    metadata: {},
  }
}

function renderListItemsRecursive(
  items: blog.pckt.block.listItem.Main[],
  tag: "ul" | "ol",
  start?: number,
): string {
  const itemsHtml = items
    .map((item) => {
      const parts: string[] = []
      for (const block of item.content) {
        if (block.$type === "blog.pckt.block.text") {
          parts.push(renderRichTextHtml((block as blog.pckt.block.text.Main).plaintext, (block as blog.pckt.block.text.Main).facets ?? []))
        } else if (block.$type === "blog.pckt.block.bulletList") {
          parts.push(renderListItemsRecursive((block as blog.pckt.block.bulletList.Main).content as blog.pckt.block.listItem.Main[], "ul"))
        } else if (block.$type === "blog.pckt.block.orderedList") {
          const ol = block as blog.pckt.block.orderedList.Main
          parts.push(renderListItemsRecursive(ol.content as blog.pckt.block.listItem.Main[], "ol", ol.start))
        }
      }
      return `<li>${parts.join("")}</li>`
    })
    .join("")
  const startAttr = tag === "ol" && start != null && start !== 1 ? ` start="${start}"` : ""
  return `<${tag}${startAttr}>${itemsHtml}</${tag}>`
}

export const blockBulletListRenderer: RendererFunction<blog.pckt.block.bulletList.Main> = async (
  entry,
) => ({
  html: renderListItemsRecursive(entry.content as blog.pckt.block.listItem.Main[], "ul"),
  metadata: {},
})

export const blockOrderedListRenderer: RendererFunction<blog.pckt.block.orderedList.Main> = async (
  entry,
) => ({
  html: renderListItemsRecursive(entry.content as blog.pckt.block.listItem.Main[], "ol", entry.start),
  metadata: {},
})

export const blockTaskListRenderer: RendererFunction<blog.pckt.block.taskList.Main> = async (
  entry,
) => {
  const itemsHtml = (entry.content as blog.pckt.block.taskItem.Main[])
    .map((item) => {
      const checked = item.checked ? " checked" : ""
      const content = item.content
        .filter((b) => b.$type === "blog.pckt.block.text")
        .map((b) => renderRichTextHtml((b as blog.pckt.block.text.Main).plaintext, (b as blog.pckt.block.text.Main).facets ?? []))
        .join("")
      return `<li class="task-list-item" style="margin-left:-24px;display:flex;gap:12px"><input type="checkbox" disabled${checked} />${content}</li>`
    })
    .join("")
  return {
    html: `<ul class="task-list" style="list-style-type:none">${itemsHtml}</ul>`,
    metadata: {},
  }
}

export const blockCodeBlockRenderer: RendererFunction<
  blog.pckt.block.codeBlock.Main,
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
          : { light: shikiConfig?.theme ?? "github-light", dark: shikiConfig?.theme ?? "github-dark" },
      defaultColor: opts?.shikiConfig?.defaultColor,
    }),
    metadata: {},
  }
}

export const blockImageRenderer: RendererFunction<
  blog.pckt.block.image.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const { attrs } = entry
  const src = attrs.blob
    ? resolveBlobSrc(attrs.blob, opts)
    : attrs.src
      ? attrs.src
      : undefined

  const alignStyle =
    attrs.align === "center"
      ? "margin-left:auto;margin-right:auto"
      : attrs.align === "right"
        ? "margin-left:auto"
        : undefined
  const aspectStyle = attrs.aspectRatio
    ? `aspect-ratio:${attrs.aspectRatio.width}/${attrs.aspectRatio.height}`
    : undefined

  const styles = [alignStyle, aspectStyle].filter(Boolean)
  const style = styles.length > 0 ? ` style="${styles.join(";")}"` : ""

  if (!src) return { html: `<figure${style}></figure>`, metadata: {} }

  const title = attrs.title ? ` title="${escapeHtml(attrs.title)}"` : ""
  return {
    html: `<figure${style}><img src="${escapeHtml(src)}" alt="${escapeHtml(attrs.alt ?? "")}" loading="lazy"${title} /></figure>`,
    metadata: { imagePaths: [src] },
  }
}

export const blockGalleryRenderer: RendererFunction<
  blog.pckt.block.gallery.Main,
  StandardSiteDocumentRendererOptions
> = async (entry) => ({
  html: `<a href="${escapeHtml(entry.ref)}" class="gallery-embed" data-gallery-uri="${escapeHtml(entry.ref)}">View Gallery</a>`,
  metadata: {},
})

export const blockIframeRenderer: RendererFunction<
  blog.pckt.block.iframe.Main,
  StandardSiteDocumentRendererOptions
> = async (entry) => {
  const heightAttr = entry.height ? ` height="${entry.height}"` : ""
  return {
    html: `<iframe src="${escapeHtml(entry.url)}" loading="lazy" allowfullscreen${heightAttr}></iframe>`,
    metadata: {},
  }
}

export const blockWebsiteRenderer: RendererFunction<
  blog.pckt.block.website.Main
> = async (entry) => {
  const title = escapeHtml(entry.title ?? entry.src)
  const description = entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""
  const preview = entry.previewImage
    ? `<img src="${escapeHtml(entry.previewImage)}" alt="" loading="lazy" />`
    : ""
  return {
    html: `<article class="web-bookmark">${preview}<div><a href="${escapeHtml(entry.src)}">${title}</a>${description}</div></article>`,
    metadata: {},
  }
}

export const blockMentionRenderer: RendererFunction<blog.pckt.block.mention.Main> = async (
  entry,
) => ({
  html: `<a class="mention" data-did="${escapeHtml(entry.did)}" href="https://bsky.app/profile/${escapeHtml(entry.did)}">@${escapeHtml(entry.handle)}</a>`,
  metadata: {},
})

export const blockTableRenderer: RendererFunction<
  blog.pckt.block.table.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, _opts) => {
  const rows = (entry.content as blog.pckt.block.tableRow.Main[])
    .map((row) => {
      const cells = (row.content as (blog.pckt.block.tableCell.Main | blog.pckt.block.tableHeader.Main)[])
        .map((cell) => {
          const isHeader = cell.$type === "blog.pckt.block.tableHeader"
          const tag = isHeader ? "th" : "td"
          const colspan = "colspan" in cell && cell.colspan ? ` colspan="${cell.colspan}"` : ""
          const rowspan = "rowspan" in cell && cell.rowspan ? ` rowspan="${cell.rowspan}"` : ""
          const content = cell.content
            .filter((b) => b.$type === "blog.pckt.block.text")
            .map((b) => renderRichTextHtml((b as blog.pckt.block.text.Main).plaintext, (b as blog.pckt.block.text.Main).facets ?? []))
            .join("")
          return `<${tag}${colspan}${rowspan}>${content}</${tag}>`
        })
        .join("")
      return `<tr>${cells}</tr>`
    })
    .join("")
  return {
    html: `<table><tbody>${rows}</tbody></table>`,
    metadata: {},
  }
}
