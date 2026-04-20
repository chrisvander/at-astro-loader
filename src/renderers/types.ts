import type { MarkdownHeading } from "astro";

// Duplicate from Astro, since it is non-exported.
export interface RenderedContent {
  /** Rendered HTML string. If present then `render(entry)` will return a component that renders this HTML. */
  html: string;
  metadata?: {
    /** Any images that are present in this entry. Relative to the {@link DataEntry} filePath. */
    imagePaths?: Array<string>;
    /** Any headings that are present in this file. */
    headings?: MarkdownHeading[];
    /** Raw frontmatter, parsed from the file. This may include data from remark plugins. */
    frontmatter?: Record<string, any>;
    /** Any other metadata that is present in this file. */
    [key: string]: unknown;
  };
}

export type RendererFunction<T> = (data: T) => Promise<RenderedContent | undefined>
