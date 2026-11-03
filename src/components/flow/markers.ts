/**
 * The four kinds of message a flow animation can carry, and how each one looks.
 *
 * This is the single source of truth for the marker that travels along an edge AND for the legend
 * under the diagram: both are built from `markerMarkup`, and both take their colours from the
 * `.flow-m-*` rules in globals.css, so the two can never drift apart.
 */
export type MarkerType = "data" | "metadata" | "request" | "uri";

export const MARKER_TYPES: Record<MarkerType, { label: string; markup: string }> = {
  data: {
    label: "Data",
    markup: '<rect class="flow-m flow-m-data" x="-7" y="-4.5" width="14" height="9" rx="3"/>',
  },
  metadata: {
    label: "Metadata",
    markup: '<rect class="flow-m flow-m-metadata" x="-4.6" y="-4.6" width="9.2" height="9.2" transform="rotate(45)"/>',
  },
  request: {
    label: "Request or acknowledgment",
    markup: '<circle class="flow-m flow-m-request" r="5"/>',
  },
  uri: {
    label: "URI or reference",
    markup: '<rect class="flow-m flow-m-uri" x="-4.5" y="-4.5" width="9" height="9"/>',
  },
};

export const isMarkerType = (v: unknown): v is MarkerType => typeof v === "string" && v in MARKER_TYPES;

/** One message: it travels from the box named `from` to the box named `to` along the arrow between them. */
export interface FlowStep {
  /** The text of a box in the diagram. If two boxes share a name, add `#2` for the second one. */
  from: string;
  to: string;
  /** The text of an existing label near the arrow. Optional: many arrows have none. */
  label?: string;
  type: MarkerType;
}
