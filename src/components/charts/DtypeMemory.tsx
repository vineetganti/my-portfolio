"use client";

import { useState } from "react";
import { ChartFrame, Slider } from "./ChartFrame";
import { SANS } from "./util";

const W = 720;
const H = 310;
const BAR_X = 170;
const BAR_MAX_W = 400; // the longest bar or the GPU line ends here, leaving room for its label
const GPU_SIZES = [8, 12, 16, 24, 40, 48, 80];

const PRECISIONS = [
  { name: "FP32", detail: "4 bytes", bytes: 4, fill: "#dfedcc", stroke: "#4b7d33" },
  { name: "FP16 / BF16", detail: "2 bytes", bytes: 2, fill: "#dfedcc", stroke: "#4b7d33" },
  { name: "INT8", detail: "1 byte", bytes: 1, fill: "#fdf0d4", stroke: "#9a5400" },
  { name: "INT4", detail: "½ byte", bytes: 0.5, fill: "#fdf0d4", stroke: "#9a5400" },
];

const DESCRIPTION =
  "Weight memory of a model at different precisions. A 7 billion parameter model needs 28 GB in FP32, 14 GB in FP16 or BF16, 7 GB in INT8 and 3.5 GB in INT4, so on a 24 GB GPU only the FP32 version does not fit. Use the sliders to change the parameter count and the GPU memory.";

const fmtGb = (gb: number) => (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1).replace(/\.0$/, ""));

export default function DtypeMemory({ alt = DESCRIPTION }: { alt?: string }) {
  const [billions, setBillions] = useState(7);
  const [gpuIndex, setGpuIndex] = useState(GPU_SIZES.indexOf(24));
  const gpu = GPU_SIZES[gpuIndex];

  // Weights only: parameters × bytes per parameter (decimal GB, as in the post).
  const sizes = PRECISIONS.map((p) => ({ ...p, gb: billions * p.bytes }));
  const scale = BAR_MAX_W / Math.max(sizes[0].gb, gpu);
  const fitting = sizes.filter((s) => s.gb <= gpu).map((s) => s.name);
  const gpuX = BAR_X + gpu * scale;
  const gpuName = `${gpu === 8 || gpu === 80 ? "an" : "a"} ${gpu} GB GPU`; // "an eight", "an eighty", but "a twelve"

  return (
    <ChartFrame
      alt={alt}
      readout={
        <>
          A <strong>{billions}B</strong>-parameter model needs{" "}
          {sizes.map((s, i) => (
            <span key={s.name}>
              {i > 0 && (i === sizes.length - 1 ? ", and " : ", ")}
              <strong>{fmtGb(s.gb)} GB</strong> in {s.name}
            </span>
          ))}
          .{" "}
          {fitting.length === 0
            ? `None of these fit ${gpuName}.`
            : fitting.length === sizes.length
              ? `All of them fit ${gpuName}, before the KV cache and activations.`
              : `On ${gpuName}, ${fitting.join(", ")} fit.`}
        </>
      }
      controls={
        <>
          <Slider
            label="Parameters"
            value={billions}
            min={1}
            max={70}
            step={1}
            onChange={setBillions}
            display={`${billions}B`}
            valueText={`${billions} billion parameters`}
          />
          <Slider
            label="GPU memory"
            value={gpuIndex}
            min={0}
            max={GPU_SIZES.length - 1}
            step={1}
            onChange={setGpuIndex}
            display={`${gpu} GB`}
            valueText={`${gpu} gigabytes`}
          />
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} fontFamily={SANS} aria-hidden="true" focusable="false">
        <rect width={W} height={H} fill="#fffdf8" />
        <text x="20" y="24" fontSize="14" fontWeight="700" fill="#2f281e">
          {billions}B parameters × bytes per parameter
        </text>

        <line x1={gpuX} y1="40" x2={gpuX} y2="252" stroke="#b0273f" strokeWidth="1.6" strokeDasharray="6 4" />
        <text x={gpuX} y="268" fontSize="12" fontWeight="700" fill="#b0273f" textAnchor="middle">
          {gpu} GB GPU
        </text>

        {sizes.map((s, i) => {
          const top = 52 + i * 50;
          const fits = s.gb <= gpu;
          const width = Math.max(2, s.gb * scale);
          return (
            <g key={s.name}>
              <text x="20" y={top + 18} fontSize="13" fontWeight="700" fill="#2f281e">
                {s.name}
              </text>
              <text x="20" y={top + 34} fontSize="11" fill="#5e5241">
                {s.detail}
              </text>
              <rect x={BAR_X} y={top} width={width} height="34" rx="4" fill={s.fill} stroke={fits ? s.stroke : "#b0273f"} strokeWidth="1.6" />
              {/* The halo keeps the label readable where the GPU line passes through it. */}
              <text
                x={BAR_X + width + 10}
                y={top + 23}
                fontSize="13"
                fontWeight="700"
                fill={fits ? "#2f281e" : "#b0273f"}
                stroke="#fffdf8"
                strokeWidth="4"
                paintOrder="stroke"
              >
                {fmtGb(s.gb)} GB{fits ? "" : "  does not fit"}
              </text>
            </g>
          );
        })}

        <text x="360" y="296" fontSize="12.5" fill="#5e5241" textAnchor="middle" fontStyle="italic">
          Weights only. Activations, the KV cache and framework overhead come on top of this.
        </text>
      </svg>
    </ChartFrame>
  );
}
