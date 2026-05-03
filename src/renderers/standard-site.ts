import * as site from "../lexicons/site"
import * as app from "../lexicons/app"
import type { RendererFunction, StandardSiteRenderOpts } from "./types"

/**
 * Renders `site.standard.document` lexicons. Supports:
 * - `app.offprint.content`
 */
export function defineStandardSiteDocumentRenderer(
  opts?: StandardSiteRenderOpts,
): RendererFunction<site.standard.document.Main> {
  return async (entry, options) => {
    const { content } = entry

    if (!content) return
    if (content.$type === "app.offprint.content")
      return import("./offprint").then((m) =>
        m.contentRenderer(content as unknown as app.offprint.content.Main, { ...opts, ...options }),
      )

    return
  }
}
