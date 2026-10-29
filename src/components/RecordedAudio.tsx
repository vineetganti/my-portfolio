import { Download } from "lucide-react";

/**
 * A recorded narration of the post, played with the browser's own audio controls.
 * preload="none" keeps the file from downloading until someone presses play.
 */
export default function RecordedAudio({ src, title }: { src: string; title: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm font-bold text-ink">Listen to the recording</p>
        <a
          href={src}
          download
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-accent transition-colors"
        >
          <Download size={14} />
          Download
        </a>
      </div>
      <audio controls preload="none" className="w-full" aria-label={`Audio recording of ${title}`}>
        <source src={src} type="audio/mp4" />
        Your browser can&apos;t play this recording. <a href={src}>Download it instead.</a>
      </audio>
    </div>
  );
}
