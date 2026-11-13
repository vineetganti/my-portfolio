import { AMBER, FAINT, GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-audio",
  diagrams: {
    "which-player": {
      alt: "Where a post's audio comes from. A recording saved as the post's slug in public/audio is uploaded by upload-audio.mjs to Vercel Blob, and its slug and length are listed in audio.json and audio-durations.json. At build time parsePost sets audioSrc. Every post page shows the browser-voice player; a post with an audioSrc also gets a link to its episode. The /podcasts pages list every episode and hold the one podcast player.",
      draw(c) {
        c.size(720, 330).title("Every post has the browser voice; the podcasts have their own pages");
        const file = c.box(20, 56, 140, 54, "public/audio", { tone: "plain", lines: "git-ignored" });
        const up = c.box(200, 56, 150, 54, "upload-audio.mjs", { tone: "raised", lines: "files + lengths" });
        const blob = c.box(390, 56, 140, 54, "Vercel Blob", { tone: "cream", lines: "the files" });
        const list = c.box(570, 56, 130, 54, "audio.json", { tone: "amber", lines: "+ audio-durations" });
        const parse = c.box(570, 140, 130, 54, "parsePost", { tone: "raised", lines: "sets audioSrc" });
        const post = c.box(390, 230, 140, 54, "post page", { tone: "neutral", lines: "AudioPlayer, always" });
        const pods = c.box(570, 230, 130, 54, "/podcasts", { tone: "green", lines: "list + episodes" });
        c.arrow(file.right, up.left);
        c.arrow(up.right, blob.left);
        c.arrow(blob.right, list.left);
        c.arrow(list.bottom, parse.top);
        c.arrow(parse.bottom, pods.top);
        c.arrow([570, 180], [462, 228]);
        c.arrow(post.right, pods.left, { label: "link", labelDy: -6 });
        c.para(20, 140, "Nothing in a post's frontmatter changes. A recording is two commands and a commit of the two lists.", { width: 340 });
        c.para(20, 230, "A post without a recording shows only the browser voice and no link.", { width: 340 });
        c.flow("public/audio", "upload-audio.mjs", "", "data");
        c.flow("upload-audio.mjs", "Vercel Blob", "", "data");
        c.flow("Vercel Blob", "audio.json", "", "metadata");
        c.flow("audio.json", "parsePost", "", "metadata");
        c.flow("parsePost", "/podcasts", "", "uri");
        c.flow("parsePost", "post page", "", "uri");
        void post;
      },
    },

    "hidden-route": {
      alt: "Before and after for leaving the podcasts pages while an episode plays. Before: you click a link to a post, Next hides the page with display none instead of removing it, and the audio element keeps playing while its player bar is hidden, so there is no way to stop it. After: the same hide runs a layout-effect cleanup that pauses the audio, and coming back shows the episode paused where it was.",
      draw(c) {
        c.size(720, 300).title("Leaving /podcasts while an episode plays");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        c.text(380, 62, "After", { size: 12.5, weight: 700, fill: GREEN });
        for (const x of [20, 380]) {
          c.box(x, 72, 320, 44, "You click a link to a post", { tone: "plain" });
          c.arrow([x + 160, 116], [x + 160, 138]);
          c.box(x, 138, 320, 48, "Next hides the page", { tone: "amber", lines: "display: none, nothing is unmounted" });
          c.arrow([x + 160, 186], [x + 160, 208]);
        }
        c.box(20, 208, 320, 48, "The audio keeps playing", { tone: "red", lines: "its bar is hidden too: no controls" });
        c.box(380, 208, 320, 48, "A layout-effect cleanup pauses it", { tone: "green", lines: "coming back: paused, position kept" });
        c.para(20, 280, "Measured on 2026-11-13 before the fix: two seconds after leaving, the position had moved from 5.4 s to 7.4 s.", { width: 680, fill: MUTED });
      },
    },

    "speech-pipeline": {
      alt: "The browser-voice player in three steps. Prepare: collectChunks reads the rendered article, keeps prose and image descriptions, replaces code, tables and recall questions with a short spoken note, and joins sentences into chunks of up to 180 characters, although a single longer sentence stays whole. Speak: each chunk becomes an utterance, and its end event starts the next one only if no newer speak call has happened. Along the way the current block is highlighted and preferences are saved.",
      draw(c) {
        c.size(720, 330).title("Prepare once, then speak one chunk at a time");
        c.text(20, 60, "1. Prepare", { size: 12.5, weight: 700, fill: AMBER });
        const article = c.box(20, 70, 150, 56, "#post-content", { tone: "plain", lines: "the rendered page" });
        const collect = c.box(210, 70, 170, 56, "collectChunks()", { tone: "amber", lines: "prose + alt text, skip notes" });
        const chunks = c.box(420, 70, 140, 56, "chunks", { tone: "raised", lines: "text + element" });
        c.arrow(article.right, collect.left);
        c.arrow(collect.right, chunks.left);
        c.para(580, 82, "Sentences are joined up to 180 characters; one longer sentence stays whole.", { width: 125, size: 10.5 });
        c.text(20, 170, "2. Speak", { size: 12.5, weight: 700, fill: GREEN });
        const speak = c.box(20, 180, 150, 56, "speak(i)", { tone: "green", lines: "gen = ++generation" });
        const utter = c.box(250, 180, 190, 56, "utterance", { tone: "raised", lines: "text, voice, rate" });
        const end = c.box(520, 180, 140, 56, "onend", { tone: "plain", lines: "is gen still current?" });
        c.arrow(speak.right, utter.left);
        c.arrow(utter.right, end.left);
        c.route([[590, 236], [590, 262], [95, 262], [95, 238]], { color: GREEN, label: "yes: speak(i + 1)", labelAt: [342, 262], labelDy: -6 });
        c.para(20, 290, "Pause, skip, a new speed or a new voice all cancel and bump the generation, so an end event from the old utterance does nothing.", { width: 680 });
        c.flow("#post-content", "collectChunks()", "", "data");
        c.flow("collectChunks()", "chunks", "", "data");
        c.flow("speak(i)", "utterance", "", "request");
        c.flow("utterance", "onend", "", "metadata");
        void FAINT;
      },
    },

    "stale-callback": {
      alt: "The bug the generation counter prevents. Before: the reader presses pause, the player cancels the utterance, but the cancelled utterance still fires its end event, which starts the next chunk, so pause undoes itself. After: every speak call takes a new generation number, pause bumps it too, and the late end event sees an old number and does nothing.",
      draw(c) {
        c.size(720, 270).title("Before and after: a cancelled utterance that still ends");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        const steps1 = [["speak(4)", "plain"], ["pause", "raised"], ["old onend fires", "red"], ["speak(5) starts", "red"]];
        steps1.forEach(([n, t], i) => {
          c.box(20 + i * 172, 72, 150, 44, n, { tone: t, size: 12 });
          if (i) c.arrow([20 + i * 172 - 22, 94], [20 + i * 172 - 2, 94], { color: RED });
        });
        c.text(20, 150, "After", { size: 12.5, weight: 700, fill: GREEN });
        const steps2 = [["speak(4), gen 7", "plain"], ["pause, gen 8", "raised"], ["old onend: gen 7", "neutral"], ["ignored: 7 ≠ 8", "green"]];
        steps2.forEach(([n, t], i) => {
          c.box(20 + i * 172, 160, 150, 44, n, { tone: t, size: 12 });
          if (i) c.arrow([20 + i * 172 - 22, 182], [20 + i * 172 - 2, 182], { color: GREEN });
        });
        c.para(20, 236, "The fix is one number compared in the callback, not a flag that has to be reset in every code path.", { width: 680, fill: MUTED });
      },
    },

    "summary-map": {
      alt: "A map of the audio post. Browser voice: the Web Speech API reads the rendered prose and diagram descriptions and skips code and tables with a note, on every post. Robustness: a generation counter, phone fixes, a watchdog and a reset when the post is hidden. Podcast: NotebookLM recordings, re-encoded to mono 64 kbps and stored in Vercel Blob. Podcasts pages: one provider owns the audio element, so the list and episodes share a player that pauses when the route is hidden.",
      draw(c) {
        summaryMap(
          c,
          "Two ways to listen, in two places",
          [
            { name: "Browser voice", lines: ["Web Speech API", "reads the rendered page", "alt text for diagrams", "skip notes for code"] },
            { name: "Robustness", lines: ["generation counter", "four phone fixes", "a watchdog", "messages, not silence"] },
            { name: "Podcast", lines: ["NotebookLM overview", "mono AAC, 64 kbps", "Vercel Blob", "preload none"] },
            { name: "/podcasts", lines: ["list + episode pages", "one provider, one audio", "pause when hidden", "a link from each post"] },
          ],
          "Free speech on every post, and recordings on their own pages where they are worth the storage.",
        );
      },
    },
  },
};

export default post;
