import { AMBER, FAINT, GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-audio",
  diagrams: {
    "hidden-route": {
      alt: "Before and after for leaving a post while it is being read aloud. Before: you click a link, Next hides the page with display none instead of removing it, and the player's cleanup cancels the speech but leaves its own state saying playing, so coming back shows Stop listening and a Pause button while nothing is spoken. After: the same cleanup also resets the player's state, so coming back shows Listen to this post.",
      draw(c) {
        c.size(720, 300).title("Leaving a post while it is being read");
        c.text(20, 62, "Before", { size: 12.5, weight: 700, fill: RED });
        c.text(380, 62, "After", { size: 12.5, weight: 700, fill: GREEN });
        for (const x of [20, 380]) {
          c.box(x, 72, 320, 44, "You click a link to another page", { tone: "plain" });
          c.arrow([x + 160, 116], [x + 160, 138]);
          c.box(x, 138, 320, 48, "Next hides the post", { tone: "amber", lines: "display: none, nothing is unmounted" });
          c.arrow([x + 160, 186], [x + 160, 208]);
        }
        c.box(20, 208, 320, 48, "Speech stops, the state says playing", { tone: "red", lines: "back: Stop listening, but silence" });
        c.box(380, 208, 320, 48, "The cleanup resets the state too", { tone: "green", lines: "back: Listen to this post" });
        c.para(20, 280, "Measured on 2026-11-13 with a stubbed speech engine, before and after the fix.", { width: 680, fill: MUTED });
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
      alt: "A map of the audio post. Browser voice: the Web Speech API reads the rendered prose and diagram descriptions and skips code and tables with a note, on every post. Robustness: a generation counter, four phone fixes, a watchdog and messages instead of silence. Leaving a page: Next hides a page instead of removing it, so the player's cleanup cancels speech and resets its state. History: AI podcast recordings had their own pages from 13 to 18 November 2026 and were then removed, files included.",
      draw(c) {
        summaryMap(
          c,
          "One way to listen, on every post",
          [
            { name: "Browser voice", lines: ["Web Speech API", "reads the rendered page", "alt text for diagrams", "skip notes for code"] },
            { name: "Robustness", lines: ["generation counter", "four phone fixes", "a watchdog", "messages, not silence"] },
            { name: "Leaving a page", lines: ["hidden, not removed", "cleanup cancels speech", "and resets the state", "test leaving too"] },
            { name: "History", lines: ["AI podcasts, 13–18 Nov", "14 recordings", "own pages, one player", "removed, files deleted"] },
          ],
          "Free speech on every post, made reliable by testing pauses, phones and leaving.",
        );
      },
    },
  },
};

export default post;
