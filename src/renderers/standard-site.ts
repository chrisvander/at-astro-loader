import * as site from "../lexicons/site"
import * as app from "../lexicons/app"
import type { RendererFunction, StandardSiteRenderOpts } from "./types"
import type { blog, pub } from "../lexicons"

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
    else if (content.$type === "blog.pckt.content")
      return import("./pckt").then((m) =>
        m.contentRenderer(content as unknown as blog.pckt.content.Main, { ...opts, ...options }),
      )
    else if (content.$type === "pub.leaflet.content")
      return import("./leaflet").then((m) =>
        m.contentRenderer(content as unknown as pub.leaflet.content.Main, { ...opts, ...options }),
      )

    return
  }
}
