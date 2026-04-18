// [WEB-ELEVENTY-CONFIG] Eleventy builds HTML into .eleventy-out/; Vite consumes from there.
import { pathToFileURL } from "node:url";

// [WEB-BLOG-MARKDOWN] Dynamic import keeps the .ts path out of acorn's reach
// (acorn parses this config file for --watch dependency scanning and can't read TS).
const markedModuleUrl = new URL("./eleventy/markedInstance.ts", import.meta.url).href;
const { mdToHtml } = await import(markedModuleUrl);

export default function (eleventyConfig) {
  eleventyConfig.addDataExtension("ts", {
    parser: async (_contents, filePath) => {
      const mod = await import(pathToFileURL(filePath).href);
      return mod.default;
    },
    read: false,
  });

  eleventyConfig.setLibrary("md", {
    render: (content) => mdToHtml(content),
  });

  eleventyConfig.addFilter("isoDate", (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
  });

  eleventyConfig.addPassthroughCopy({ public: "." });

  // Watch external markdown sources so edits outside eleventy/ trigger a rebuild
  // (handwritten docs, shared intro, TypeDoc API output, core TS the highlighter imports).
  eleventyConfig.addWatchTarget("../../docs/specs/");
  eleventyConfig.addWatchTarget("../../docs/shared/");
  eleventyConfig.addWatchTarget("./.typedoc-out/");
  eleventyConfig.addWatchTarget("./src/highlight.ts");
  eleventyConfig.addWatchTarget("./eleventy/_data/");

  return {
    dir: {
      input: "eleventy",
      includes: "_includes",
      data: "_data",
      output: ".eleventy-out",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["njk", "md", "html"],
  };
}
