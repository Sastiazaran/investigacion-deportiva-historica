"use client";

import { formatSeasonPart, rangePresets } from "../lib/analysis";

type Props = {
  minYear: number;
  maxYear: number;
  startYear: number;
  endYear: number;
  onStartYear: (year: number) => void;
  onEndYear: (year: number) => void;
};

export default function YearRange({
  minYear,
  maxYear,
  startYear,
  endYear,
  onStartYear,
  onEndYear,
}: Props) {
  const presets = rangePresets(minYear, maxYear);
  return (
    <>
      <div className="preset-row">
        {presets.map((preset) => {
          const active = startYear === preset.start && endYear === preset.end;
          return (
            <button
              key={preset.label}
              type="button"
              className={`chip ${active ? "active" : ""}`}
              onClick={() => {
                onStartYear(preset.start);
                onEndYear(preset.end);
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="sliders">
        <label className="slider-block">
          <span>
            Start year: <strong>{startYear}</strong> ({formatSeasonPart(startYear)})
          </span>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={startYear}
            onChange={(event) => onStartYear(Number(event.target.value))}
          />
        </label>
        <label className="slider-block">
          <span>
            End year: <strong>{endYear}</strong> ({formatSeasonPart(endYear)})
          </span>
          <input
            type="range"
            min={minYear}
            max={maxYear}
            value={endYear}
            onChange={(event) => onEndYear(Number(event.target.value))}
          />
        </label>
      </div>
    </>
  );
}
