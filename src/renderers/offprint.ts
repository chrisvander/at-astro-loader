import { getBlobCidString, parseLexLink, type BlobRef } from "@atproto/lex"
import escapeHtml from "escape-html"
import katex from "katex"
import slugify from "slugify"
import { codeToHtml } from "shiki"
import { app } from "../lexicons"
import type {
  StandardSiteDocumentRendererOptions,
  RenderedContent,
  RendererFunction,
} from "./types"
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

function renderRichTextHtml(plaintext: string, facets: Facet[] = []) {
  const splitText = applyFacetsToText(plaintext, splitAndMerge(facets))
  return splitText
    .map((st) => (st.facet ? applyFacet(st.text, st.facet.features) : st.text))
    .join("")
}

type ListItemLike = {
  content: app.offprint.block.text.Main
  children?: ListItemLike[]
}

type TaskItemLike = {
  checked: boolean
  content: app.offprint.block.text.Main
  children?: TaskItemLike[]
}

function isRenderedContent(block: RenderedContent | undefined): block is RenderedContent {
  return !!block
}

function renderListItems(
  items: ListItemLike[],
  listTag: "ul" | "ol",
  attrs: string[] = [],
): string {
  const itemsHtml = items
    .map((item) => {
      const content = renderRichTextHtml(item.content.plaintext, item.content.facets ?? [])
      const nested =
        item.children && item.children.length > 0 ? renderListItems(item.children, listTag) : ""
      return `<li>${content}${nested}</li>`
    })
    .join("")
  const attrString = attrs.length > 0 ? ` ${attrs.join(" ")}` : ""
  return `<${listTag}${attrString}>${itemsHtml}</${listTag}>`
}

function renderTaskItems(items: TaskItemLike[]): string {
  const itemsHtml = items
    .map((item) => {
      const content = renderRichTextHtml(item.content.plaintext, item.content.facets ?? [])
      const nested = item.children && item.children.length > 0 ? renderTaskItems(item.children) : ""
      const checked = item.checked ? " checked" : ""
      return `<li class="task-list-item" style="margin-left:-24px;display:flex;gap:12px"><input type="checkbox" disabled${checked} />${content}${nested}</li>`
    })
    .join("")
  return `<ul class="task-list" style="list-style-type: none">${itemsHtml}</ul>`
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

function getImageBlob<T extends { blob?: BlobRef; image?: BlobRef }>(entry: T) {
  return entry.blob ?? entry.image
}

type ImageLike = {
  alt?: string
  blob?: BlobRef
  image?: BlobRef
  aspectRatio?: app.offprint.block.image.AspectRatio
}

function renderGridImages(images: ImageLike[], opts: StandardSiteDocumentRendererOptions) {
  const imagePaths: string[] = []
  const html = images
    .map((image) => {
      const src = resolveBlobSrc(getImageBlob(image), opts)
      const aspectRatio = image.aspectRatio
        ? ` style="aspect-ratio:${image.aspectRatio.width}/${image.aspectRatio.height}"`
        : ""
      if (!src) return `<div class="image-grid-item"${aspectRatio}></div>`
      imagePaths.push(src)
      return `<img class="image-grid-item" src="${escapeHtml(src)}" alt="${escapeHtml(image.alt ?? "")}" loading="lazy"${aspectRatio} />`
    })
    .join("")

  return { html, imagePaths }
}

/**
 * Renders the `app.offprint.content` lexicon.
 */
export const contentRenderer: RendererFunction<
  app.offprint.content.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const renderingBlocks = entry.items.map((i): Promise<RenderedContent | undefined> => {
    switch (i.$type) {
      case "app.offprint.block.text":
        return blockTextRenderer(i as app.offprint.block.text.Main, opts)
      case "app.offprint.block.heading":
        return blockHeadingRenderer(i as app.offprint.block.heading.Main, opts)
      case "app.offprint.block.blockquote": {
        return blockBlockquoteRenderer(i as app.offprint.block.blockquote.Main, opts)
      }
      case "app.offprint.block.blueskyPost": {
        return blockBlueskyPostRenderer(i as app.offprint.block.blueskyPost.Main, opts)
      }
      case "app.offprint.block.bulletList": {
        return blockBulletListRenderer(i as app.offprint.block.bulletList.Main, opts)
      }
      case "app.offprint.block.button": {
        return blockButtonRenderer(i as app.offprint.block.button.Main, opts)
      }
      case "app.offprint.block.callout": {
        return blockCalloutRenderer(i as app.offprint.block.callout.Main, opts)
      }
      case "app.offprint.block.codeBlock": {
        return blockCodeBlockRenderer(i as app.offprint.block.codeBlock.Main, opts)
      }
      case "app.offprint.block.horizontalRule": {
        return blockHorizontalRuleRenderer(i as app.offprint.block.horizontalRule.Main, opts)
      }
      case "app.offprint.block.image": {
        return blockImageRenderer(i as app.offprint.block.image.Main, opts)
      }
      case "app.offprint.block.imageCarousel": {
        return blockImageCarouselRenderer(i as app.offprint.block.imageCarousel.Main, opts)
      }
      case "app.offprint.block.imageDiff": {
        return blockImageDiffRenderer(i as app.offprint.block.imageDiff.Main, opts)
      }
      case "app.offprint.block.imageGrid": {
        return blockImageGridRenderer(i as app.offprint.block.imageGrid.Main, opts)
      }
      case "app.offprint.block.mathBlock": {
        return blockMathBlockRenderer(i as app.offprint.block.mathBlock.Main, opts)
      }
      case "app.offprint.block.orderedList": {
        return blockOrderedListRenderer(i as app.offprint.block.orderedList.Main, opts)
      }
      case "app.offprint.block.taskList": {
        return blockTaskListRenderer(i as app.offprint.block.taskList.Main, opts)
      }
      case "app.offprint.block.webBookmark": {
        return blockWebBookmarkRenderer(i as app.offprint.block.webBookmark.Main, opts)
      }
      case "app.offprint.block.webEmbed": {
        return blockWebEmbedRenderer(i as app.offprint.block.webEmbed.Main, opts)
      }
    }
    throw new Error(`Unknown block type: ${i.$type}`)
  })
  const mappedBlocks = (await Promise.all(renderingBlocks)).filter(isRenderedContent)
  const html = mappedBlocks.map((b) => b.html).join("")
  const metadata = mergeMetadata(mappedBlocks)
  return {
    html,
    metadata,
  }
}

/**
 * Renders the `app.offprint.block.text` lexicon.
 */
export const blockTextRenderer: RendererFunction<app.offprint.block.text.Main> = async (entry) => {
  const html = renderRichTextHtml(entry.plaintext, entry.facets ?? [])
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
  const html = renderRichTextHtml(plaintext, entry.facets ?? [])
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

export const blockBlockquoteRenderer: RendererFunction<app.offprint.block.blockquote.Main> = async (
  entry,
  opts,
) => {
  const blocks = (
    await Promise.all(
      entry.content.map((block) => {
        switch (block.$type) {
          case "app.offprint.block.text":
            return blockTextRenderer(block as app.offprint.block.text.Main, opts)
          case "app.offprint.block.heading":
            return blockHeadingRenderer(block as app.offprint.block.heading.Main, opts)
          default:
            return Promise.resolve(undefined)
        }
      }),
    )
  ).filter(isRenderedContent)

  return {
    html: `<blockquote>${blocks.map((block) => block.html).join("")}</blockquote>`,
    metadata: mergeMetadata(blocks),
  }
}

export const blockBlueskyPostRenderer: RendererFunction<
  app.offprint.block.blueskyPost.Main
> = async (entry) => {
  const href = blueskyPostUrl(entry.post.uri)
  return {
    html: `<blockquote class="bluesky-embed" data-bluesky-uri="${entry.post.uri}"><a href="${escapeHtml(href)}">View Bluesky post</a><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script></blockquote>`,
    metadata: {},
  }
}

export const blockBulletListRenderer: RendererFunction<app.offprint.block.bulletList.Main> = async (
  entry,
) => ({
  html: renderListItems(entry.children as ListItemLike[], "ul"),
  metadata: {},
})

export const blockButtonRenderer: RendererFunction<app.offprint.block.button.Main> = async (
  entry,
) => {
  return {
    html: `<a class="button" href="${escapeHtml(entry.href)}">${escapeHtml(entry.text)}</a>`,
    metadata: {},
  }
}

export const blockCalloutRenderer: RendererFunction<app.offprint.block.callout.Main> = async (
  entry,
) => {
  const style = `
    display: flex;
    padding: 16px;
    gap: 16px;
  `
  const emoji = entry.emoji ?? "💡"
  const html = renderRichTextHtml(entry.plaintext, entry.facets ?? [])
  return {
    html: `<aside class="callout" style="${style}"><span class="callout-icon" aria-hidden="true">${escapeHtml(emoji)}</span><div class="callout-content">${html}</div></aside>`,
    metadata: {},
  }
}

export const blockCodeBlockRenderer: RendererFunction<
  app.offprint.block.codeBlock.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const shikiConfig = opts?.shikiConfig
  return {
    html: await codeToHtml(entry.code, {
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
          ? {
              light: shikiConfig.themes.light,
              dark: shikiConfig.themes.dark,
            }
          : {
              light: shikiConfig?.theme ?? "github-light",
              dark: shikiConfig?.theme ?? "github-dark",
            },
      defaultColor: opts?.shikiConfig?.defaultColor,
    }),
    metadata: {},
  }
}

export const blockHorizontalRuleRenderer: RendererFunction<
  app.offprint.block.horizontalRule.Main
> = async (_entry) => ({
  html: `<hr />`,
  metadata: {},
})

export const blockImageRenderer: RendererFunction<
  app.offprint.block.image.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const src = resolveBlobSrc(getImageBlob(entry), opts)
  const caption = entry.caption
    ? `<figcaption>${renderRichTextHtml(entry.caption, entry.captionFacets ?? [])}</figcaption>`
    : ""
  const styles = [
    entry.width ? `width:${escapeHtml(entry.width)}` : undefined,
    entry.alignment === "center" ? "margin-left:auto;margin-right:auto" : undefined,
    entry.alignment === "right" ? "margin-left:auto" : undefined,
    entry.aspectRatio
      ? `aspect-ratio:${entry.aspectRatio.width}/${entry.aspectRatio.height}`
      : undefined,
  ].filter((style) => !!style)
  const style = styles.length > 0 ? ` style="${styles.join(";")}"` : ""

  if (!src) {
    return {
      html: `<figure${style}>${caption}</figure>`,
      metadata: {},
    }
  }

  return {
    html: `<figure${style}><img src="${escapeHtml(src)}" alt="${escapeHtml(entry.alt ?? "")}" loading="lazy" />${caption}</figure>`,
    metadata: {
      imagePaths: [src],
    },
  }
}

export const blockImageCarouselRenderer: RendererFunction<
  app.offprint.block.imageCarousel.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const { html, imagePaths } = renderGridImages(entry.images as ImageLike[], opts)
  const caption = entry.caption ? `<figcaption>${escapeHtml(entry.caption)}</figcaption>` : ""

  return {
    html: `<figure class="image-carousel image-grid"><div class="image-grid-items">${html}</div>${caption}</figure>`,
    metadata: {
      imagePaths,
    },
  }
}

export const blockImageDiffRenderer: RendererFunction<
  app.offprint.block.imageDiff.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const { html, imagePaths } = renderGridImages(entry.images as ImageLike[], opts)
  const caption = entry.caption ? `<figcaption>${escapeHtml(entry.caption)}</figcaption>` : ""
  const styles = [
    entry.width ? `width:${escapeHtml(entry.width)}` : undefined,
    entry.alignment === "center" ? "margin-left:auto;margin-right:auto" : undefined,
    entry.alignment === "right" ? "margin-left:auto" : undefined,
  ].filter((style) => !!style)
  const style = styles.length > 0 ? ` style="${styles.join(";")}"` : ""

  return {
    html: `<figure class="image-diff"${style}><div class="image-diff-items">${html}</div>${caption}</figure>`,
    metadata: {
      imagePaths,
    },
  }
}

export const blockImageGridRenderer: RendererFunction<
  app.offprint.block.imageGrid.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const { html, imagePaths } = renderGridImages(entry.images as ImageLike[], opts)
  const caption = entry.caption ? `<figcaption>${escapeHtml(entry.caption)}</figcaption>` : ""
  const rows = entry.gridRows ? `--grid-rows:${entry.gridRows}` : undefined
  const style = rows ? ` style="${rows}"` : ""

  return {
    html: `<figure class="image-grid image-grid-${entry.aspectRatio ?? "mosaic"}"${style}><div class="image-grid-items">${html}</div>${caption}</figure>`,
    metadata: {
      imagePaths,
    },
  }
}

export const blockMathBlockRenderer: RendererFunction<app.offprint.block.mathBlock.Main> = async (
  entry,
) => ({
  html: `
    <link href="https://cdn.jsdelivr.net/npm/katex@0.16.45/dist/katex.min.css" rel="stylesheet">
    ${katex.renderToString(entry.tex, {
      displayMode: true,
      throwOnError: false,
    })}
  `,
  metadata: {},
})

export const blockOrderedListRenderer: RendererFunction<
  app.offprint.block.orderedList.Main
> = async (entry) => ({
  html: renderListItems(entry.children as ListItemLike[], "ol", [`start="${entry.start}"`]),
  metadata: {},
})

export const blockTaskListRenderer: RendererFunction<app.offprint.block.taskList.Main> = async (
  entry,
) => ({
  html: renderTaskItems(entry.children as TaskItemLike[]),
  metadata: {},
})

export const blockWebBookmarkRenderer: RendererFunction<
  app.offprint.block.webBookmark.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const siteName = entry.siteName ? `<small>${escapeHtml(entry.siteName)}</small>` : ""
  const description = entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""
  const previewSrc = resolveBlobSrc(entry.preview, opts)
  const preview = previewSrc ? `<img src="${escapeHtml(previewSrc)}" alt="" loading="lazy" />` : ""

  return {
    html: `<article class="web-bookmark">${preview}<div>${siteName}<a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a>${description}</div></article>`,
    metadata: {},
  }
}

export const blockWebEmbedRenderer: RendererFunction<
  app.offprint.block.webEmbed.Main,
  StandardSiteDocumentRendererOptions
> = async (entry, opts) => {
  const widthStyle = entry.width ? ` style="width:${escapeHtml(entry.width)}"` : ""
  const title = entry.title ?? entry.siteName ?? entry.href
  const description = entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""
  const siteName = entry.siteName ? `<small>${escapeHtml(entry.siteName)}</small>` : ""
  const previewSrc = resolveBlobSrc(entry.preview, opts)
  const preview = previewSrc ? `<img src="${escapeHtml(previewSrc)}" alt="" loading="lazy" />` : ""
  const embed = entry.embedUrl
    ? `<iframe src="${escapeHtml(entry.embedUrl)}" title="${escapeHtml(title)}"${entry.embedWidth ? ` width="${entry.embedWidth}"` : ""}${entry.embedHeight ? ` height="${entry.embedHeight}"` : ""} loading="lazy" allowfullscreen></iframe>`
    : ""

  return {
    html: `<figure class="web-embed"${widthStyle}>${embed || preview}<figcaption>${siteName}<a href="${escapeHtml(entry.href)}">${escapeHtml(title)}</a>${description}</figcaption></figure>`,
    metadata: {},
  }
}
