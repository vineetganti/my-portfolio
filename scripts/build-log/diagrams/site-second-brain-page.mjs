import { AMBER, FAINT, GREEN, MUTED, RED } from "../../db-lab/canvas.mjs";
import { summaryMap } from "./_shared.mjs";

const post = {
  slug: "site-second-brain-page",
  diagrams: {
    "trust-boundary": {
      alt: "Where the trust boundary sits. On the owner's machine: the private database, the private signing key, nb publish which writes and signs five files, and the upload script which holds the Blob token. In Vercel Blob: the five files and their signatures, in current and previous folders. On the website: only the public key. The site fetches, verifies and renders, and has no path that writes anything back.",
      draw(c) {
        c.size(720, 310).title("The site can read, verify and show. It cannot write.");
        c.rect(20, 46, 250, 220, { tone: "neutral" });
        c.text(36, 70, "Owner's machine (private)", { size: 12.5, weight: 700 });
        const pub = c.box(36, 84, 218, 52, "nb publish", { tone: "amber", lines: "writes + signs 5 files" });
        const up = c.box(36, 150, 218, 52, "upload script", { tone: "raised", lines: "holds the Blob token" });
        c.text(145, 226, "private.pem never leaves", { size: 10.5, fill: MUTED, anchor: "middle" });
        c.text(145, 244, "the database stays local", { size: 10.5, fill: MUTED, anchor: "middle" });
        const blob = c.box(320, 120, 150, 70, "Vercel Blob", { tone: "cream", lines: ["current/ previous/", "public files"] });
        c.rect(520, 46, 180, 220, { tone: "green" });
        c.text(536, 70, "Website (public)", { size: 12.5, weight: 700, fill: GREEN });
        const site = c.box(536, 84, 148, 52, "secondBrain.ts", { tone: "plain", lines: "public key only" });
        c.box(536, 150, 148, 52, "/second-brain", { tone: "plain", lines: "text only, no form" });
        c.arrow(pub.bottom, up.top);
        c.arrow([254, 176], [318, 155]);
        c.arrow([470, 140], [534, 110], { color: GREEN });
        c.arrow([610, 136], [610, 148], { color: GREEN });
        c.text(360, 290, "No API route accepts data, so there is nothing to attack on the site side but the files.", { size: 11, fill: FAINT, anchor: "middle" });
        c.flow("nb publish", "upload script", "", "data");
        c.flow("upload script", "Vercel Blob", "", "data");
        c.flow("Vercel Blob", "secondBrain.ts", "", "data");
        void site;
        void blob;
      },
    },

    "verify-order": {
      alt: "What the site does with each file. It fetches the file and its signature from current, then verifies the signature over the raw bytes before parsing anything. Only then does it parse the JSON and validate the schema, age, count, field types and that every link is https. If any step fails it tries the copy in previous. If that fails too, the file is not shown, and if the status file fails the whole page shows Temporarily unavailable.",
      draw(c) {
        c.size(720, 290).title("Verify the bytes first, parse second");
        const names = [["fetch", "file + .sig"], ["verify", "raw bytes, Ed25519"], ["parse", "JSON"], ["validate", "schema, age, https"], ["render", "text only"]];
        names.forEach(([n, l], i) => {
          c.box(20 + i * 140, 70, 120, 56, n, { tone: i === 1 ? "amber" : i === 4 ? "green" : "raised", lines: l });
          if (i) c.arrow([i * 140, 98], [18 + i * 140, 98]);
        });
        c.route([[220, 126], [220, 170], [80, 170], [80, 128]], { color: RED, label: "fails: try previous/", labelAt: [150, 170], labelDy: 16 });
        c.para(20, 214, "A bad signature never reaches JSON.parse. Neither copy verifying means the item isn't shown; a status file that doesn't verify means the page fails closed: \"Temporarily unavailable\".", { width: 680, fill: MUTED });
        void AMBER;
        void GREEN;
      },
    },

    "page-states": {
      alt: "The five states the Second brain page can be in. Off: SECOND_BRAIN_ENABLED is false, the page is a 404 and the nav link is hidden. Not configured: no base URL or public key, the page says not set up yet. Paused: the signed status says enabled false, the page shows the note. Unavailable: the status did not verify, or no list did. OK: verified lists are shown, with a notice if they are older than 7 days.",
      draw(c) {
        c.size(720, 230).title("Every outcome has a state, and only one shows data");
        const states = [
          ["off", "env says false: 404", "neutral"],
          ["not configured", "no URL or key", "raised"],
          ["paused", "signed status off", "amber"],
          ["unavailable", "nothing verified", "red"],
          ["ok", "verified lists", "green"],
        ];
        states.forEach(([n, l, t], i) => c.box(20 + i * 138, 70, 126, 70, n, { tone: t, lines: l }));
        c.para(20, 172, "Only ok renders items, and an ok older than 7 days carries a notice; older than 30 days is rejected outright.", { width: 680, fill: MUTED });
      },
    },

    "upload-order": {
      alt: "The upload script's order of work. First it verifies all five files and signatures with the same code the site runs, and refuses to upload anything if one fails. Then it copies the live current files to previous, so the site always has a verified fallback. Then it uploads the data files and their signatures, and the status file last, so a new status never points at half-uploaded lists.",
      draw(c) {
        c.size(720, 230).title("The upload script: refuse early, keep a fallback, status last");
        const steps = [["verify all 5", "same code as the site", "amber"], ["copy live", "current → previous", "raised"], ["upload lists", "files + .sig", "cream"], ["status.json", "last", "green"]];
        steps.forEach(([n, l, t], i) => {
          c.box(20 + i * 172, 70, 150, 60, n, { tone: t, lines: l });
          if (i) c.arrow([i * 172 - 2, 100], [18 + i * 172, 100]);
        });
        c.para(20, 160, "A tampered file stops the run before the network is touched. The first upload had no live copy to keep, which the script now treats as normal.", { width: 680, fill: MUTED });
        c.flow("verify all 5", "copy live", "", "metadata");
        c.flow("copy live", "upload lists", "", "data");
        c.flow("upload lists", "status.json", "", "data");
      },
    },

    "summary-map": {
      alt: "A map of the Second brain page post. Boundary: no write path, the private key stays local. Verify: signature on raw bytes first, then validation. Fail safe: a previous copy, closed failure, five explicit states. Operate: verified upload, a kill switch and a rollback ladder.",
      draw(c) {
        summaryMap(
          c,
          "The Second brain page",
          [
            { name: "Boundary", lines: ["no write path", "public key only", "token stays local"] },
            { name: "Verify", lines: ["Ed25519 on bytes", "then parse", "then validate"] },
            { name: "Fail safe", lines: ["previous/ copy", "fail closed", "five states"] },
            { name: "Operate", lines: ["verified upload", "signed kill switch", "rollback ladder"] },
          ],
          "The page can be wrong only if the owner's own key signs something wrong.",
        );
      },
    },
  },
};

export default post;
