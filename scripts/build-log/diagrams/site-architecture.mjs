import { AMBER, FAINT, GREEN, MUTED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-architecture",
  diagrams: {
    "two-paths": {
      alt: "Two ways a page reaches a reader. At build time, a git push starts next build on Vercel, which prerenders every page to static HTML that a CDN serves to readers. At request time, only the Second brain page does work: its cached render fetches signed files from Vercel Blob at most every 15 minutes.",
      draw(c) {
        c.size(720, 300).title("Almost everything happens before anyone visits");
        c.text(20, 62, "Build time: once per push", { size: 12.5, weight: 700, fill: AMBER });
        const push = c.box(20, 74, 120, 56, "git push", { tone: "plain", lines: "to main" });
        const build = c.box(190, 74, 150, 56, "next build", { tone: "amber", lines: "prerenders every page" });
        const cdn = c.box(390, 74, 130, 56, "CDN", { tone: "raised", lines: "static HTML and JS" });
        const reader = c.box(570, 74, 130, 56, "reader", { tone: "plain", lines: "any page" });
        c.arrow(push.right, build.left);
        c.arrow(build.right, cdn.left);
        c.arrow(cdn.right, reader.left);
        c.text(20, 182, "Request time: one page, at most every 15 minutes", { size: 12.5, weight: 700, fill: GREEN });
        const visitor = c.box(20, 194, 120, 56, "visitor", { tone: "plain", lines: "/second-brain" });
        const cached = c.box(190, 194, 150, 56, "cached render", { tone: "green", lines: "'use cache', 15 min" });
        const blob = c.box(390, 194, 130, 56, "Vercel Blob", { tone: "cream", lines: "signed files" });
        c.arrow(visitor.right, cached.left);
        c.arrow(cached.right, blob.left, { both: true });
        c.para(560, 210, "Everything else is fixed until the next push.", { width: 150, size: 11 });
        c.line([20, 160], [700, 160], { color: FAINT, dash: "3 4" });
        c.flow("git push", "next build", "", "request");
        c.flow("next build", "CDN", "", "data");
        c.flow("CDN", "reader", "", "data");
        c.flow("visitor", "cached render", "", "request");
        c.flow("cached render", "Vercel Blob", "", "request");
        c.flow("Vercel Blob", "cached render", "", "data");
      },
    },

    "server-and-client": {
      alt: "Which code runs where. Server components run at build time and send only HTML: the pages, MdxContent with its diagram inliner, the post and lab readers, and the Second brain verifier. Client components are small islands that ship JavaScript: the audio players, the table of contents, diagram motion and flow animation, live charts, the database labs and the flash cards.",
      draw(c) {
        c.size(720, 330).title("Server components send HTML, client islands send JavaScript");
        c.rect(20, 46, 330, 262, { tone: "neutral" });
        c.text(36, 70, "Server: runs at build time", { size: 12.5, weight: 700 });
        const server = [
          ["pages and layouts", "read content with fs"],
          ["MdxContent", "compiles MDX, inlines SVGs"],
          ["blog.ts, notes.ts, dbLab.ts", "parse files into objects"],
          ["secondBrain.ts", "fetch, verify, cache"],
        ];
        server.forEach(([n, l], i) => c.box(36, 82 + i * 54, 298, 46, n, { tone: "plain", lines: l, size: 12, small: 10 }));
        c.rect(370, 46, 330, 262, { tone: "cream" });
        c.text(386, 70, "Client: hydrates in the browser", { size: 12.5, weight: 700, fill: AMBER });
        const client = [
          ["AudioPlayer, PodcastProvider", "speech and the podcast bar"],
          ["TableOfContents", "scrollspy, progress bar"],
          ["DiagramMotion, FlowDiagram", "reveal and message flow"],
          ["charts, db labs, flash cards", "state that changes on input"],
        ];
        client.forEach(([n, l], i) => c.box(386, 82 + i * 54, 298, 46, n, { tone: "plain", lines: l, size: 12, small: 10 }));
        c.arrow([350, 180], [368, 180], { color: MUTED });
      },
    },

    "ci-jobs": {
      alt: "The checks every push and pull request runs on GitHub Actions: a public-safety job that fails if a private file or secret is tracked, a site job that lints, runs the Node tests, type-checks and builds, and a pipeline job that runs the Python tests for the Second brain.",
      draw(c) {
        c.size(720, 250).title("Three independent CI jobs");
        const trigger = c.box(20, 104, 130, 60, "push or PR", { tone: "plain", lines: "GitHub Actions" });
        c.box(230, 50, 200, 54, "public-safety", { tone: "red", lines: "no tracked key, token, path" });
        const site = c.box(230, 112, 200, 54, "site", { tone: "amber", lines: "lint, tests, tsc, build" });
        c.box(230, 174, 200, 54, "second-brain", { tone: "green", lines: "pytest, Python 3.12" });
        c.arrow([150, 122], [228, 77]);
        c.arrow(trigger.right, site.left);
        c.arrow([150, 146], [228, 201]);
        c.para(470, 70, "A job that fails blocks the merge. The safety job needs no install, so it reports first.", { width: 230 });
        c.para(470, 150, "The site job builds with no Second brain settings on purpose: the page must still build when it is not set up.", { width: 230 });
        c.flow("push or PR", "public-safety", "", "request");
        c.flow("push or PR", "site", "", "request");
        c.flow("push or PR", "second-brain", "", "request");
      },
    },

    "summary-map": {
      alt: "A map of the architecture post. Content: MDX, JSON and Markdown files in the repository, no database. Build: next build reads them with fs and prerenders every page. Render: server components send HTML, small client islands add behaviour. Guard rails: the build is the test, plus lint, tests and a public-safety check in CI.",
      draw(c) {
        summaryMap(
          c,
          "How this site works, in four columns",
          [
            { name: "Content", lines: ["MDX posts", "JSON recordings", "Markdown notes", "no database"] },
            { name: "Build", lines: ["fs reads files", "parsePost", "generateStaticParams", "prerendered pages"] },
            { name: "Render", lines: ["server components", "client islands", "theme tokens", "inlined SVGs"] },
            { name: "Guard rails", lines: ["the build is the test", "eslint and tsc", "Node and Python tests", "public-safety check"] },
          ],
          "The repository is the CMS: files in, static pages out, and one page that fetches signed data at request time.",
        );
      },
    },
  },
};

export default post;
