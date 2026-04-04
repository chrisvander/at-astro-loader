import { describe, expect, it } from "bun:test";
import type { Client, RecordSchema } from "@atproto/lex";
import type { LoaderContext } from "astro/loaders";
import { atLoader, atLiveLoader, atZodSchema } from "./index.ts";

type ExampleRecord = {
  text: string;
};

type ParsedRecord = ExampleRecord & {
  parsed: true;
};

type ExampleSchema = RecordSchema<any, any, any>;

type StaticListCall = {
  passedSchema: ExampleSchema;
  options: { repo?: string };
};

type StoreEntry = {
  id: string;
  data: ParsedRecord;
  digest: string;
};

type SchemaMock = {
  $type: string;
  safeParse(data: unknown): { success: boolean };
};

type StaticClientMock = {
  list(
    passedSchema: ExampleSchema,
    options: { repo?: string },
  ): Promise<{
    invalid: [];
    records: [{ cid: string; value: ExampleRecord }];
  }>;
};

type LiveClientMock = {
  get(): Promise<{
    uri: string;
    value: ExampleRecord;
    cid: string;
  }>;
  list(): Promise<{ invalid: []; records: [] }>;
};

function isExampleRecord(data: unknown): data is ExampleRecord {
  return (
    typeof data === "object" && data !== null && "text" in data && typeof data.text === "string"
  );
}

function createSchema(): ExampleSchema {
  const schema = {
    $type: "com.example.record",
    safeParse(data: unknown) {
      return {
        success: isExampleRecord(data),
      };
    },
  } satisfies SchemaMock;

  return schema as unknown as ExampleSchema;
}

describe("at-astro-loader", () => {
  it("creates a zod schema from a wrapped lexicon namespace", () => {
    const schema = atZodSchema({ main: createSchema() });

    expect(schema.safeParse({ text: "hello" }).success).toBe(true);
    expect(schema.safeParse({ nope: true }).success).toBe(false);
  });

  it("loads records into the static Astro store", async () => {
    const listCalls: StaticListCall[] = [];
    const storeEntries: StoreEntry[] = [];
    const schema = createSchema();
    const client = {
      async list(passedSchema: ExampleSchema, options: { repo?: string }) {
        listCalls.push({ passedSchema, options });
        return {
          invalid: [],
          records: [{ cid: "bafy-record", value: { text: "hello" } }],
        };
      },
    } satisfies StaticClientMock;

    const loader = atLoader(schema, {
      client: client as unknown as Client,
      repo: "alice.test",
    });

    const context = {
      collection: "posts",
      store: {
        get() {
          return undefined;
        },
        entries() {
          return [];
        },
        set(entry) {
          storeEntries.push(entry as unknown as StoreEntry);
          return true;
        },
        values() {
          return [];
        },
        keys() {
          return [];
        },
        delete() {},
        clear() {},
        has() {
          return false;
        },
        addModuleImport() {},
      },
      meta: {
        get() {
          return undefined;
        },
        set() {},
        has() {
          return false;
        },
        delete() {},
      },
      logger: {} as LoaderContext["logger"],
      config: {} as LoaderContext["config"],
      async parseData<TData extends Record<string, unknown>>(entry: { id: string; data: TData }) {
        return { ...entry.data, parsed: true } as TData;
      },
      async renderMarkdown() {
        throw new Error("renderMarkdown should not be called in this test");
      },
      generateDigest(data) {
        return `digest:${String((data as ExampleRecord).text)}`;
      },
    } satisfies LoaderContext;

    await loader.load(context);

    expect(listCalls).toEqual([
      {
        passedSchema: schema,
        options: { repo: "alice.test" },
      },
    ]);
    expect(storeEntries).toEqual([
      {
        id: "bafy-record",
        data: { text: "hello", parsed: true },
        digest: "digest:hello",
      },
    ]);
  });

  it("returns a live loader error when get() produces no cid", async () => {
    const schema = createSchema();
    const client = {
      async get() {
        return {
          uri: "at://did:plc:alice/com.example.record/123",
          value: { text: "hello" },
          cid: "",
        };
      },
      async list() {
        return { invalid: [], records: [] };
      },
    } satisfies LiveClientMock;

    const loader = atLiveLoader(schema, { client: client as unknown as Client });
    const result = await loader.loadEntry({
      collection: "posts",
      filter: { rkey: "123" },
    });

    expect(result).toBeDefined();
    if (!result || !("error" in result)) throw new Error("Expected a live loader error");

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toContain("No CID found");
  });
});
