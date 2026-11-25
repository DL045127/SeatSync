"use client";

import { Attribution } from "./Attribution.tsx";
import { useEffect, useId, useRef, useState } from "react";

// Address search combobox (docs/ARCHITECTURE-v2.md section 3). The client
// debounces typing, aborts superseded requests and discards any reply whose
// generation is no longer current. A suggestion becomes a selection only by an
// explicit choice (click, or Enter on the active option); editing the text
// clears the selection, so the form can submit only an address that agrees with
// what is displayed. City, ZIP and street-only results are shown but cannot be
// chosen. Suggestions live only in page memory; search writes nothing.

export type Purpose = "venue" | "driver_start" | "pickup";

export interface Selection {
  label: string;
  token: string;
}

interface Suggestion {
  label: string;
  detail: string;
  precision: string;
  selectable: boolean;
  token?: string;
}

interface SearchBody {
  provider?: string;
  attribution?: string;
  suggestions?: Suggestion[];
  error?: { code?: string; message?: string };
}

const DEBOUNCE_MS = 300;

export function LocationPicker({
  label,
  purpose,
  tripId,
  disabled,
  onSelect,
  resetSignal,
}: {
  label: string;
  purpose: Purpose;
  tripId?: string;
  disabled?: boolean;
  onSelect: (selection: Selection | null) => void;
  /** Change this value to clear the field after a successful submission. */
  resetSignal?: number;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [provider, setProvider] = useState<{ name: string; attribution: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "searching" | "empty" | "error">("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  // A monotonically increasing generation. Only the newest search may update state.
  const generation = useRef(0);
  // The generation whose results are on screen. An option may be chosen only
  // while it still answers the CURRENT query (ISSUE-055).
  const resultGeneration = useRef(-1);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const pendingTimer = timer;
    const pendingRequest = controller;
    return () => {
      clearTimeout(pendingTimer.current);
      pendingRequest.current?.abort();
      // The field is going away, so nothing it displayed may stay selected in
      // the parent: otherwise a hidden token could still be submitted (ISSUE-056).
      onSelectRef.current(null);
    };
  }, []);

  useEffect(() => {
    if (resetSignal === undefined) return;
    generation.current += 1;
    clearTimeout(timer.current);
    controller.current?.abort();
    /* eslint-disable react-hooks/set-state-in-effect */
    setQuery("");
    setSelected(null);
    setSuggestions([]);
    setOpen(false);
    setStatus("idle");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [resetSignal]);

  async function search(text: string, mine: number): Promise<void> {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const res = await fetch("/api/locations/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tripId ? { query: text, purpose, tripId } : { query: text, purpose }),
        cache: "no-store",
        signal: abort.signal,
      });
      const body = (await res.json().catch(() => ({}))) as SearchBody;
      if (mine !== generation.current) return; // superseded: discard
      if (!res.ok) {
        setSuggestions([]);
        setStatus("error");
        setErrorText(body.error?.message ?? `Search failed (${res.status}).`);
        return;
      }
      const found = body.suggestions ?? [];
      resultGeneration.current = mine;
      setSuggestions(found);
      setProvider(body.provider ? { name: body.provider, attribution: body.attribution ?? "" } : null);
      setErrorText(null);
      setStatus(found.length === 0 ? "empty" : "idle");
      setActive(found.findIndex((s) => s.selectable));
      setOpen(true);
    } catch {
      if (mine !== generation.current) return;
      setSuggestions([]);
      setStatus("error");
      setErrorText("Search is unavailable. Try again.");
    }
  }

  function onChange(text: string): void {
    setQuery(text);
    // The options on screen answer the PREVIOUS query. Remove them, and the
    // active index, at once, so Enter or a click cannot choose one before the
    // new reply arrives (ISSUE-055).
    setSuggestions([]);
    setActive(-1);
    setOpen(false);
    // Editing the text clears the selection: the form cannot submit an address
    // that disagrees with what is displayed.
    if (selected) {
      setSelected(null);
      onSelect(null);
    }
    generation.current += 1;
    const mine = generation.current;
    clearTimeout(timer.current);
    controller.current?.abort();
    if (text.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    timer.current = setTimeout(() => void search(text, mine), DEBOUNCE_MS);
  }

  function choose(suggestion: Suggestion): void {
    if (!suggestion.selectable || !suggestion.token) return;
    // Defense in depth: refuse an option that does not answer the current query.
    if (resultGeneration.current !== generation.current) return;
    generation.current += 1; // a late reply can no longer override this choice
    clearTimeout(timer.current);
    controller.current?.abort();
    const next = { label: suggestion.label, token: suggestion.token };
    setSelected(next);
    setQuery(suggestion.label);
    setOpen(false);
    setStatus("idle");
    onSelect(next);
  }

  function move(delta: 1 | -1): void {
    if (suggestions.length === 0) return;
    let index = active;
    for (let step = 0; step < suggestions.length; step += 1) {
      index = (index + delta + suggestions.length) % suggestions.length;
      if (suggestions[index].selectable) {
        setActive(index);
        return;
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open && suggestions.length > 0) setOpen(true);
      else move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      if (open && active >= 0 && suggestions[active]?.selectable) {
        e.preventDefault(); // choosing a suggestion must not submit the form
        choose(suggestions[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`;
  const showList = open && suggestions.length > 0;

  return (
    <div data-testid={`picker-${purpose}`}>
      <p>In live mode, Geoapify receives your search text and the trip venue’s coordinates when available. For driving estimates, Geoapify receives the selected driver start, passenger pickup, and venue coordinates.</p>
      <label>
        {label}
        <input
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={query}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
      </label>
      <ul id={listId} role="listbox" aria-label={`${label} suggestions`} hidden={!showList}>
        {suggestions.map((s, index) => (
          <li
            key={`${s.label}-${index}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            aria-disabled={!s.selectable}
            // mouseDown fires before the input's blur closes the list.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(s);
            }}
          >
            {s.label} — {s.detail}
            {s.selectable && provider?.name === "geoapify" ? " (approximate building location)" : ""}
            {s.selectable ? "" : ` (${s.precision} only: be more specific)`}
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite">
        {status === "searching" ? "Searching…" : null}
        {status === "empty" ? "No matching address. Try more of the name or street." : null}
        {selected ? `Selected: ${selected.label}` : null}
      </p>
      {status === "error" && errorText ? <p role="alert">{errorText}</p> : null}
      {provider ? (
        <p data-testid="provider-attribution">
          {provider.name === "fixture" ? "Fixture data — fictional places. " : ""}
          <Attribution provider={provider.name} sources={[provider.attribution]} />
        </p>
      ) : null}
    </div>
  );
}
