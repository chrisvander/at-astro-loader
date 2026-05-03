import type { MarkdownHeading } from "astro"

// Shiki config for code blocks
export type ShikiConfig = ({ theme?: string } | { themes: { light: string; dark: string } }) & {
  defaultColor?: false | "light" | "dark" | "light-dark()"
}

export type BlobResolver = (did: string, cid: string) => string | undefined

export type StandardSiteRenderOpts = {
  /** Shiki theme configuration for code blocks */
  shikiConfig?: ShikiConfig
}
export type StandardSiteDocumentRendererOptions = RendererFunctionOptions & StandardSiteRenderOpts

// Duplicate from Astro, since it is non-exported.
export interface RenderedContent {
  /** Rendered HTML string. If present then `render(entry)` will return a component that renders this HTML. */
  html: string
  metadata?: {
    /** Any images that are present in this entry. Relative to the {@link DataEntry} filePath. */
    imagePaths?: Array<string>
    /** Any headings that are present in this file. */
    headings?: MarkdownHeading[]
    /** Raw frontmatter, parsed from the file. This may include data from remark plugins. */
    frontmatter?: Record<string, any>
    /** Any other metadata that is present in this file. */
    [key: string]: unknown
  }
}

type RendererFunctionOptions = {
  repoDid: string
  endpoint?: string
}

// A function to render a block of content
export type RendererFunction<T, O extends RendererFunctionOptions = RendererFunctionOptions> = (
  data: T,
  opts: O,
) => Promise<RenderedContent | undefined>
