"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { departureInstants } from "./departure.ts";

const commonZones = [
  ["America/New_York", "Eastern Time"],
  ["America/Chicago", "Central Time"],
  ["America/Denver", "Mountain Time"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific Time"],
  ["America/Anchorage", "Alaska Time"],
  ["Pacific/Honolulu", "Hawaii Time"],
  ["UTC", "UTC"],
];
const otherZones = (Intl.supportedValuesOf?.("timeZone") ?? [])
  .filter(zone => !commonZones.some(([common]) => common === zone));
const emptyZones: string[] = [];
const subscribe = () => () => {};

export function DepartureFields() {
  const zones = useSyncExternalStore(subscribe, () => otherZones, () => emptyZones);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [zone, setZone] = useState("");
  const [choice, setChoice] = useState("");
  const instants = useMemo(() => {
    try {
      return departureInstants(date, time, zone);
    } catch {
      return [];
    }
  }, [date, time, zone]);
  const complete = !!date && !!time && !!zone;
  const resolved = instants.length === 1 ? instants[0] : choice;

  return (
    <fieldset className="departure-fields">
      <legend>Departure</legend>
      <div className="departure-clock">
        <label>Date<input type="date" value={date} required onChange={e => { setDate(e.target.value); setChoice(""); }} /></label>
        <label>Time<input type="time" value={time} required onChange={e => { setTime(e.target.value); setChoice(""); }} /></label>
      </div>
      <label>
        Time zone
        <select value={zone} required onChange={e => { setZone(e.target.value); setChoice(""); }}>
          <option value="">Choose a time zone</option>
          {commonZones.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          {zones.length > 0 && <optgroup label="Other time zones">
            {zones.map(id => <option key={id} value={id}>{id.replaceAll("_", " ")}</option>)}
          </optgroup>}
        </select>
      </label>
      {complete && instants.length === 0 && <p role="alert">This date and time is unavailable in the selected time zone. Choose another time.</p>}
      {instants.length > 1 && (
        <label>
          This time occurs twice. Choose a departure.
          <select value={choice} required onChange={e => setChoice(e.target.value)}>
            <option value="">Choose first or second occurrence</option>
            {instants.map((instant, index) => (
              <option key={instant} value={instant}>
                {index === 0 ? "First" : "Second"} ({instant.slice(0, 10)} {instant.slice(11, 16)} UTC)
              </option>
            ))}
          </select>
        </label>
      )}
      <input type="hidden" name="departAt" value={resolved} />
    </fieldset>
  );
}
