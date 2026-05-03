import type { Loader, LiveLoader, LoaderContext } from "astro/loaders"
import {
  type Client,
  type Infer,
  type ListOptions,
  type GetOptions,
  type AtIdentifierString,
  type RecordSchema,
  type Validator,
  lexToJson,
  isHandleIdentifier,
} from "@atproto/lex"
import { custom, ZodMiniCustom } from "zod/mini"
import type { RendererFunction } from "./renderers/types"
import { com } from "./lexicons"

export * from "./renderers"

function getMain<T extends object>(ns: T | { main: T }): T {
  return "main" in ns ? ns.main : ns
}

/** Configuration for {@link atLoader}. Includes all ATProto `ListOptions`. */
interface ATLoaderBaseConfig<T extends RecordSchema> {
  /** Repository identifier (DID or handle). Defaults to authenticated user's DID. */
  repo?: AtIdentifierString
  /** Optional preconfigured ATProto client (for auth, custom headers, etc.). */
  client?: Client
  /** ATProto service endpoint. Defaults to `https://public.api.bsky.app`. */
  endpoint?: string
  /** Maximum number of records to return. */
  limit?: number
  /** Pagination cursor from a previous response. */
  cursor?: string
  /** If true, returns records in reverse chronological order. */
  reverse?: boolean
  /**
   * A renderer function that will be called with the data. If defined, it will
   * transform the content being retrieved and will provide the `render()` function
   * and the `<Content />` component to be used.
   */
  renderer?: RendererFunction<Infer<T>>
}

interface ATLiveLoaderConfig<T extends RecordSchema> extends ATLoaderBaseConfig<T> {}

interface ATLoaderMarkdownConfig<T extends RecordSchema> {
  /**
   * If there is Markdown text in the schema, define this function and the loader
   * will expose a render function to render it to HTML.
   *
   * **Note**: if `renderer` is defined, it will take precedent, and Markdown will not
   * be rendered.
   */
  getMarkdown?: (data: Infer<T>) => string
}

interface ATLoaderConfig<T extends RecordSchema>
  extends ATLoaderMarkdownConfig<T>, ATLoaderBaseConfig<T> {}

/** Filter passed to {@link atLiveLoader} `loadEntry`, forwarded to `client.get()`. */
type ATLoaderEntryFilter<T extends RecordSchema> = GetOptions<T>
/** Filter passed to {@link atLiveLoader} `loadCollection`, forwarded to `client.list()`. */
type ATLoaderCollectionFilter = ListOptions
/** Error type returned by live loader methods and thrown by the static loader. */
class ATLoaderError extends Error {}

export type Schema<T> = T | { main: T }

async function getClient(configClient?: Client, endpoint?: string): Promise<Client> {
  return (
    configClient ??
    (await import("@atproto/lex").then(
      (m) => new m.Client(endpoint ?? "https://public.api.bsky.app"),
    ))
  )
}

/** Get a Zod schema for the given ATProto record schema. */
export function atZodSchema<T extends RecordSchema>(ns: T | { main: T }) {
  return custom<Infer<T>>((d) => getMain(ns).safeParse(d).success)
}

/**
 * Creates an Astro live loader backed by an ATProto record schema.
 *
 * `loadEntry` loads a single record using `GetOptions<T>`.
 * `loadCollection` lists multiple records using `ListOptions`.
 *
 * @param ns Generated lexicon namespace main export for a record schema.
 * @param config Client and endpoint options.
 * @example
 * ```ts
 * import { defineCollection } from "astro:content";
 * import { atLiveLoader } from "at-astro-loader";
 * import * as app from "../src/lexicons/app";
 *
 * const posts = defineCollection({
 *   loader: atLiveLoader(app.bsky.feed.post, {
 *     repo: "myhandle.com",
 *     endpoint: "https://public.api.bsky.app",
 *   }),
 * });
 * ```
 */
export function atLiveLoader<const T extends RecordSchema>(
  ns: { main: T },
  config: ATLiveLoaderConfig<T>,
): LiveLoader<Infer<T>, ATLoaderEntryFilter<T>, ATLoaderCollectionFilter, ATLoaderError>
export function atLiveLoader<const T extends RecordSchema>(
  ns: T,
  config: ATLiveLoaderConfig<T>,
): LiveLoader<Infer<T>, ATLoaderEntryFilter<T>, ATLoaderCollectionFilter, ATLoaderError>
export function atLiveLoader<const T extends RecordSchema>(
  ns: T | { main: T },
  { client: configClient, endpoint, ...options }: ATLiveLoaderConfig<T> = {},
): LiveLoader<Infer<T>, ATLoaderEntryFilter<T>, ATLoaderCollectionFilter, ATLoaderError> {
  const schema: T = getMain(ns)
  return {
    name: `atproto-live-loader-${schema.$type}`,
    loadEntry: async ({ filter }) => {
      const client = await getClient(configClient, endpoint)
      const { uri, value, cid } = await client.get(schema, {
        ...options,
        ...(filter as ATLoaderEntryFilter<T>),
      })
      if (!cid) return { error: new ATLoaderError(`No CID found for record: ${uri}`) }
      const data = lexToJson(value) as Infer<T>
      const rendered = await renderRecord(value as Infer<T>, data, {
        client,
        endpoint,
        renderer: options.renderer,
        repo: options.repo,
      })
      return {
        id: cid,
        data,
        rendered,
      }
    },
    loadCollection: async ({ filter }) => {
      const client = await getClient(configClient, endpoint)
      const { invalid, records } = await client.list(schema, { ...options, ...filter })
      if (invalid.length > 0)
        return { error: new ATLoaderError(`Invalid records: ${JSON.stringify(invalid)}`) }
      const entryPromises = records.map(async (r) => {
        const data = lexToJson(r.value) as Infer<T>
        const rendered = await renderRecord(r.value as Infer<T>, data, {
          client,
          endpoint,
          renderer: options.renderer,
          repo: options.repo,
        })
        return {
          data,
          id: r.cid,
          rendered,
        }
      })
      return {
        entries: await Promise.all(entryPromises),
      }
    },
  }
}

type ATLoader<T extends Validator> = {
  name: string
  schema: ZodMiniCustom<Infer<T>, Infer<T>>
  load: (ctx: LoaderContext) => Promise<void>
}

async function resolveRepoDid(client: Client, repo?: AtIdentifierString): Promise<string> {
  if (repo && isHandleIdentifier(repo))
    return await client
      .call(com.atproto.identity.resolveHandle, {
        handle: repo,
      })
      .then((res) => res.did)
  if (!repo) throw new Error("No repository resolved.")
  return repo
}

async function renderRecord<const T extends RecordSchema>(
  record: Infer<T>,
  data: Infer<T>,
  {
    client,
    endpoint,
    getMarkdown,
    renderMarkdown,
    renderer,
    repo,
  }: {
    client: Client
    endpoint?: string
    getMarkdown?: (data: Infer<T>) => string
    renderMarkdown?: LoaderContext["renderMarkdown"]
    renderer?: RendererFunction<Infer<T>>
    repo?: AtIdentifierString
  },
) {
  if (renderer)
    return await renderer(record, {
      endpoint,
      repoDid: await resolveRepoDid(client, repo),
    })
  if (getMarkdown && renderMarkdown) return await renderMarkdown(getMarkdown(data))
  return undefined
}

/**
 * Creates a regular (non-live) Astro content loader backed by an ATProto record schema.
 *
 * This loader fetches records during content sync and writes them to Astro's
 * content store using `parseData()` for schema validation and coercion.
 *
 * @param ns Generated lexicon namespace main export for a record schema.
 * @param config Client and endpoint options, plus `ListOptions` for listing.
 * @example
 * ```ts
 * import { defineCollection } from "astro:content";
 * import { atLoader } from "at-astro-loader";
 * import * as app from "../src/lexicons/app";
 *
 * const posts = defineCollection({
 *   loader: atLoader(app.bsky.feed.post, {
 *     repo: "myhandle.com",
 *     limit: 100,
 *     reverse: true,
 *   }),
 * });
 * ```
 */
export function atLoader<const T extends RecordSchema>(
  ns: T,
  client: ATLoaderConfig<T>,
): ATLoader<T>
export function atLoader<const T extends RecordSchema>(
  ns: { main: T },
  client: ATLoaderConfig<T>,
): ATLoader<T>
export function atLoader<const T extends RecordSchema>(
  ns: T | { main: T },
  { client: configClient, endpoint, getMarkdown, renderer, ...options }: ATLoaderConfig<T> = {},
): ATLoader<T> {
  const schema: T = getMain(ns)
  return {
    name: `atproto-loader-${schema.$type}`,
    schema: atZodSchema(ns),
    load: async (ctx) => {
      ctx.store.clear()

      const client = await getClient(configClient, endpoint)
      const { invalid, records } = await client.list(schema, options)
      if (invalid.length > 0) throw new ATLoaderError(`Invalid records: ${JSON.stringify(invalid)}`)

      for (const record of records) {
        const data = await ctx.parseData<Infer<T>>({
          id: record.cid,
          data: lexToJson(record.value) as Infer<T>,
        })
        const rendered = await renderRecord(record.value as Infer<T>, data, {
          client,
          endpoint,
          getMarkdown,
          renderMarkdown: ctx.renderMarkdown,
          renderer,
          repo: options.repo,
        })
        ctx.store.set({
          id: record.cid,
          data,
          rendered,
          digest: ctx.generateDigest(data),
        })
      }
    },
  } satisfies Loader
}
