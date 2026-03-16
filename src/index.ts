import type { Loader, LiveLoader } from "astro/loaders";
import type {
  Client,
  Infer,
  ListOptions,
  GetOptions,
  AtIdentifierString,
  CallOptions,
  RecordSchema,
} from "@atproto/lex";
import { custom } from "zod/mini";

function getMain<T extends object>(ns: T | { main: T }): T {
  return "main" in ns ? ns.main : ns;
}

/** Configuration for {@link atLoader}. Includes all ATProto `ListOptions`. */
interface ATLoaderConfig extends CallOptions {
  /** Repository identifier (DID or handle). Defaults to authenticated user's DID. */
  repo?: AtIdentifierString;
  /** Optional preconfigured ATProto client (for auth, custom headers, etc.). */
  client?: Client;
  /** ATProto service endpoint. Defaults to `https://public.api.bsky.app`. */
  endpoint?: string;
}

/** Filter passed to {@link atLiveLoader} `loadEntry`, forwarded to `client.get()`. */
type ATLoaderEntryFilter<T extends RecordSchema> = GetOptions<T>;
/** Filter passed to {@link atLiveLoader} `loadCollection`, forwarded to `client.list()`. */
type ATLoaderCollectionFilter = ListOptions;
/** Error type returned by live loader methods and thrown by the static loader. */
class ATLoaderError extends Error {}

async function getClient(configClient?: Client, endpoint?: string): Promise<Client> {
  return (
    configClient ??
    (await import("@atproto/lex").then(
      (m) => new m.Client(endpoint ?? "https://public.api.bsky.app"),
    ))
  );
}

/** Get a Zod schema for the given ATProto record schema. */
export function atZodSchema<T extends RecordSchema>(ns: T | { main: T }) {
  return custom<Infer<T>>((d) => getMain(ns).safeParse(d).success);
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
  config: ATLoaderConfig,
): LiveLoader<Infer<T>, ATLoaderEntryFilter<T>, ATLoaderCollectionFilter, ATLoaderError>;
export function atLiveLoader<const T extends RecordSchema>(
  ns: T,
  config: ATLoaderConfig,
): LiveLoader<Infer<T>, ATLoaderEntryFilter<T>, ATLoaderCollectionFilter, ATLoaderError>;
export function atLiveLoader<const T extends RecordSchema>(
  ns: T | { main: T },
  { client: configClient, endpoint, ...options }: ATLoaderConfig = {},
): LiveLoader<Infer<T>, ATLoaderEntryFilter<T>, ATLoaderCollectionFilter, ATLoaderError> {
  const schema: T = getMain(ns);
  return {
    name: `atproto-live-loader-${schema.$type}`,
    loadEntry: async ({ filter }) => {
      const client = await getClient(configClient, endpoint);
      const { uri, value, cid } = await client.get(schema, {
        ...options,
        ...(filter as ATLoaderEntryFilter<T>),
      });
      if (!cid) return { error: new ATLoaderError(`No CID found for record: ${uri}`) };
      return { id: cid, data: value };
    },
    loadCollection: async ({ filter }) => {
      const client = await getClient(configClient, endpoint);
      const { invalid, records } = await client.list(schema, { ...options, ...filter });
      if (invalid.length > 0)
        return { error: new ATLoaderError(`Invalid records: ${JSON.stringify(invalid)}`) };
      return {
        entries: records.map((r) => ({ data: r.value, id: r.cid })),
      };
    },
  };
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
  ns: T | { main: T },
  { client: configClient, endpoint, ...options }: ATLoaderConfig = {},
) {
  const schema: T = getMain(ns);
  return {
    name: `atproto-loader-${schema.$type}`,
    schema: atZodSchema(ns),
    load: async ({ store, parseData, generateDigest }) => {
      store.clear();

      const client = await getClient(configClient, endpoint);
      const { invalid, records } = await client.list(schema, options);
      if (invalid.length > 0)
        throw new ATLoaderError(`Invalid records: ${JSON.stringify(invalid)}`);

      for (const record of records) {
        const data = await parseData<Infer<T>>({
          id: record.cid,
          data: record.value,
        });
        store.set({
          id: record.cid,
          data,
          digest: generateDigest(data),
        });
      }
    },
  } satisfies Loader;
}
