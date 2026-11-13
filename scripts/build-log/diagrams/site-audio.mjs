import { AMBER, FAINT, GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-audio",
  diagrams: {
    "which-player": {
      alt: "How a post gets its audio. A recording saved as the post's slug in public/audio is uploaded by upload-audio.mjs to Vercel Blob and listed in content/audio.json. At build time parsePost looks the slug up and sets audioSrc. The post page then shows the podcast player if there is an audioSrc, and the browser-voice player if not.",
      draw(c) {
        c.size(720, 300).title("One list decides which player a post gets");
        const file = c.box(20, 56, 140, 54, "public/audio", { tone: "plain", lines: "git-ignored" });
        const up = c.box(200, 56, 150, 54, "upload-audio.mjs", { tone: "raised", lines: "needs the Blob token" });
        const blob = c.box(390, 56, 140, 54, "Vercel Blob", { tone: "cream", lines: "the files" });
        const list = c.box(390, 140, 140, 54, "audio.json", { tone: "amber", lines: "slug → file, in git" });
        const parse = c.box(200, 140, 150, 54, "parsePost", { tone: "raised", lines: "sets audioSrc" });
        const page = c.box(20, 140, 140, 54, "post page", { tone: "plain", lines: "picks a player" });
        c.arrow(file.right, up.left);
        c.arrow(up.right, blob.left);
        c.arrow([460, 110], [460, 138]);
        c.arrow(list.left, parse.right);
        c.arrow(parse.left, page.right);
        c.box(570, 56, 130, 54, "RecordedAudio", { tone: "green", lines: "if audioSrc" });
        c.box(570, 140, 130, 54, "AudioPlayer", { tone: "neutral", lines: "otherwise" });
        c.para(20, 230, "Nothing in a post's frontmatter changes. A recording is two commands and a commit of audio.json; a post without one keeps the browser voice.", { width: 680 });
        c.flow("public/audio", "upload-audio.mjs", "", "data");
        c.flow("upload-audio.mjs", "Vercel Blob", "", "data");
        c.flow("Vercel Blob", "audio.json", "", "metadata");
        c.flow("audio.json", "parsePost", "", "metadata");
        c.flow("parsePost", "post page", "", "uri");
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
      alt: "A map of the audio post. Browser voice: the Web Speech API reads the rendered prose and diagram descriptions and skips code and tables with a note. Robustness: a generation counter, phone fixes and a watchdog. Podcast: NotebookLM recordings, re-encoded to mono 64 kbps and stored in Vercel Blob. The switch: content/audio.json decides which player a post shows.",
      draw(c) {
        summaryMap(
          c,
          "Two players, one button per post",
          [
            { name: "Browser voice", lines: ["Web Speech API", "reads the rendered page", "alt text for diagrams", "skip notes for code"] },
            { name: "Robustness", lines: ["generation counter", "four phone fixes", "a watchdog", "messages, not silence"] },
            { name: "Podcast", lines: ["NotebookLM overview", "mono AAC, 64 kbps", "Vercel Blob", "preload none"] },
            { name: "The switch", lines: ["content/audio.json", "audioSrc in parsePost", "one player per post", "no frontmatter edit"] },
          ],
          "Free speech for every post, and a recorded version where it is worth the storage.",
        );
      },
    },
  },
};

export default post;
