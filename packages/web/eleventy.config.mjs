// [WEB-ELEVENTY-CONFIG] Eleventy builds HTML into .eleventy-out/; Vite consumes from there.
import { pathToFileURL } from "node:url";

export default function (eleventyConfig) {
  eleventyConfig.addDataExtension("ts", {
    parser: async (_contents, filePath) => {
      const mod = await import(pathToFileURL(filePath).href);
      return mod.default;
    },
    read: false,
  });

  eleventyConfig.addFilter("isoDate", (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
  });

  eleventyConfig.addPassthroughCopy({ "public": "." });

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
