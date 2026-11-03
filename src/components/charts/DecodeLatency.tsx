"use client";

import { useState } from "react";
import { ChartFrame, Slider } from "./ChartFrame";
import { SANS, decimalsFor, niceStep } from "./util";

// The model and GPU behind the original picture: Llama-2-7B in FP16 on a 2 TB/s GPU.
const WEIGHT_BYTES = 14e9;
const BANDWIDTH = 2e12; // bytes per second
/** 2 (K and V) × 32 layers × 4,096 values × 2 bytes (FP16) = 0.5 MiB for every token in the cache. */
const KV_BYTES_PER_TOKEN = 2 * 32 * 4096 * 2;
const MAX_CONTEXT = 32768; // the "32k" on the axis is 32,768 tokens

const W = 720;
const H = 392;
const X0 = 84;
const X1 = 664;
const Y0 = 292;
const Y_TOP = 58;

const DESCRIPTION =
  "A stacked chart of the idealised time per decode step. Reading the weights costs a constant 7 milliseconds. Reading the KV cache adds time that grows linearly with context length and overtakes the weight cost at about 27 thousand tokens at batch size 1. Use the sliders to change the context length and the batch size.";

const WEIGHT_MS = (WEIGHT_BYTES / BANDWIDTH) * 1000; // 7 ms
const kvMs = (batch: number, tokens: number) => ((batch * tokens * KV_BYTES_PER_TOKEN) / BANDWIDTH) * 1000;
const fmtK = (tokens: number) => (tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `${Math.round(tokens)}`);
const fmtMs = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1));

export default function DecodeLatency({ alt = DESCRIPTION }: { alt?: string }) {
  const [context, setContext] = useState(16384);
  const [batch, setBatch] = useState(1);

  const kvAtMax = kvMs(batch, MAX_CONTEXT);
  const step = niceStep((WEIGHT_MS + kvAtMax) * 1.08, 5);
  const yMax = step * Math.ceil(((WEIGHT_MS + kvAtMax) * 1.08) / step);
  const decimals = decimalsFor(step);
  const x = (t: number) => X0 + (t / MAX_CONTEXT) * (X1 - X0);
  const y = (ms: number) => Y0 - (ms / yMax) * (Y0 - Y_TOP);

  const crossover = (WEIGHT_MS / 1000) * BANDWIDTH / (batch * KV_BYTES_PER_TOKEN); // tokens where KV reads = weight reads
  const kvNow = kvMs(batch, context);
  const stepMs = WEIGHT_MS + kvNow;
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) yTicks.push(v);
  const crossRight = x(crossover) < 300;
  // With a big batch the weights band is thin; the labels that sit inside it then move or drop out.
  const roomInside = Y0 - y(WEIGHT_MS) >= 40;

  return (
    <ChartFrame
      alt={alt}
      readout={
        <>
          At <strong>{context.toLocaleString("en-US")}</strong> tokens of context and a batch of <strong>{batch}</strong>, a
          decode step reads <strong>{fmtMs(WEIGHT_MS)} ms</strong> of weights and <strong>{fmtMs(kvNow)} ms</strong> of KV
          cache: <strong>{fmtMs(stepMs)} ms</strong> in all. The cache costs more than the weights beyond about{" "}
          <strong>{Math.round(crossover).toLocaleString("en-US")}</strong> tokens.
        </>
      }
      controls={
        <>
          <Slider
            label="Context length T"
            value={context}
            min={0}
            max={MAX_CONTEXT}
            step={256}
            onChange={setContext}
            display={`${fmtK(context)} tokens`}
            valueText={`${context} tokens`}
          />
          <Slider
            label="Batch size B"
            value={batch}
            min={1}
            max={32}
            step={1}
            onChange={setBatch}
            display={`${batch}`}
            valueText={`${batch} sequences in the batch`}
          />
        </>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} fontFamily={SANS} aria-hidden="true" focusable="false">
        <rect width={W} height={H} fill="#fffdf8" />
        <text x="20" y="24" fontSize="14" fontWeight="700" fill="#2f281e">
          Idealised time per decode step (Llama-2-7B, FP16, 2 TB/s)
        </text>

        <rect x={X0} y={y(WEIGHT_MS)} width={X1 - X0} height={Y0 - y(WEIGHT_MS)} fill="#dfedcc" />
        <path d={`M${X0} ${y(WEIGHT_MS)} L${X1} ${y(WEIGHT_MS)} L${X1} ${y(WEIGHT_MS + kvAtMax)} Z`} fill="#fdf0d4" />
        <line x1={X0} y1={y(WEIGHT_MS)} x2={X1} y2={y(WEIGHT_MS)} stroke="#5e5241" strokeWidth="1.4" />
        <line x1={X0} y1={y(WEIGHT_MS)} x2={X1} y2={y(WEIGHT_MS + kvAtMax)} stroke="#9a5400" strokeWidth="2.6" />

        <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="#5e5241" strokeWidth="1.6" />
        <line x1={X0} y1={Y0} x2={X0} y2={Y_TOP} stroke="#5e5241" strokeWidth="1.6" />
        {[0, 8192, 16384, 24576, 32768].map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={Y0} x2={x(t)} y2={Y0 + 5} stroke="#5e5241" strokeWidth="1.2" />
            <text x={x(t)} y={Y0 + 19} fontSize="11.5" fill="#5e5241" textAnchor="middle">
              {t === 0 ? "0" : `${t / 1024}k`}
            </text>
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={X0 - 5} y1={y(v)} x2={X0} y2={y(v)} stroke="#5e5241" strokeWidth="1.2" />
            <text x={X0 - 9} y={y(v) + 4} fontSize="11.5" fill="#5e5241" textAnchor="end">
              {v.toFixed(decimals)}
            </text>
          </g>
        ))}
        <text x="374" y="330" fontSize="12.5" fill="#5e5241" textAnchor="middle">
          context length T (tokens already in the KV cache)
        </text>
        <text transform="translate(26 179) rotate(-90)" fontSize="12.5" fill="#5e5241" textAnchor="middle">
          ms per decode step
        </text>

        <text x={X1 - 8} y={roomInside ? y(WEIGHT_MS) + 22 : y(WEIGHT_MS) - 8} fontSize="13" fontWeight="700" fill="#2f281e" textAnchor="end" stroke="#fffdf8" strokeWidth="4" paintOrder="stroke">
          read the weights: 14 GB ÷ 2 TB/s = 7 ms (constant)
        </text>
        {/* Ends at x = 440 so the whole label sits above the rising line. */}
        <text x="440" y={y(WEIGHT_MS + kvAtMax * ((440 - X0) / (X1 - X0))) - 14} fontSize="13" fontWeight="700" fill="#9a5400" textAnchor="end">
          read the KV cache: grows with T
        </text>

        {crossover < MAX_CONTEXT && (
          <g>
            <line x1={x(crossover)} y1={y(WEIGHT_MS)} x2={x(crossover)} y2={Y0} stroke="#9a5400" strokeWidth="1.3" strokeDasharray="5 4" />
            {roomInside && (
              <text
                x={x(crossover) + (crossRight ? 6 : -6)}
                y={Y0 - 8}
                fontSize="11.5"
                fontWeight="700"
                fill="#9a5400"
                stroke="#fffdf8"
                strokeWidth="4"
                paintOrder="stroke"
                textAnchor={crossRight ? "start" : "end"}
              >
                ≈{fmtK(crossover)} tokens: KV reads = weight reads
              </text>
            )}
          </g>
        )}

        {/* The live marker: where the sliders put the current step. */}
        <line x1={x(context)} y1={y(stepMs)} x2={x(context)} y2={Y0} stroke="#2f281e" strokeWidth="1.2" strokeDasharray="3 4" />
        <circle cx={x(context)} cy={y(stepMs)} r="7" fill="#fdf0d4" stroke="#9a5400" strokeWidth="2.2" />

        <text x="360" y="362" fontSize="12.5" fill="#5e5241" textAnchor="middle" fontStyle="italic">
          t_step ≈ (weight bytes + B · T · KV bytes per token) ÷ HBM bandwidth
        </text>
        <text x="360" y="380" fontSize="12.5" fill="#5e5241" textAnchor="middle" fontStyle="italic">
          More sequences in the batch (B) make the KV term dominate sooner.
        </text>
      </svg>
    </ChartFrame>
  );
}
