# at-astro-loader

This loader provides live and build-time collections from AT Protocol data for Astro. For example, you could publish a custom lexicon like `com.mywebsite.collection` and use this tool to load any data matching that lexicon into your Astro site, type-safe.

Type safety requires a little bit of setup.

## Usage

First, use the `@atproto/lex` CLI to pull the lexicons you want to make into an Astro collection, and then build them:

```bash
npx -p @atproto/lex lex install [nsids]
npx -p @atproto/lex lex build
```

This will put lexicons into your `src/lexicons` directory. Make sure to add that to your `.gitignore` file and add the `lex build` command to your build process.
