import * as site from "../lexicons/site";
import * as app from "../lexicons/app";
import type { RendererFunction } from "./types";

/**
 * Renders `site.standard.document` lexicons. Supports:
 * - `app.offprint.content`
 */
export const standardSiteDocumentRenderer: RendererFunction<site.standard.document.Main> = async (entry) => {
  const { content } = entry

  if (!content) return
  if (content.$type === "app.offprint.content")
    return import("./offprint").then(m => m.contentRenderer(content as unknown as app.offprint.content.Main))

  return
}
