"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "ops_theme_mode";
const THEME_CHOICES = ["light", "dark", "system"] as const;

function getSystemMode(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const resolved = mode === "system" ? getSystemMode() : mode;
  root.classList.toggle("theme-dark", resolved === "dark");
  root.classList.toggle("theme-light", resolved === "light");
  root.setAttribute("data-theme", resolved);
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const savedMode = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    const initialMode: ThemeMode =
      savedMode === "light" || savedMode === "dark" || savedMode === "system"
        ? savedMode
        : "system";
    setMode(initialMode);
  }, []);

  useEffect(() => {
    if (mode === null) {
      return;
    }
    applyTheme(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (mode === null) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = (): void => {
      if (mode === "system") {
        applyTheme("system");
      }
    };

    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, [mode]);

  function onSelect(nextMode: ThemeMode): void {
    setMode(nextMode);
  }

  function onChoiceKeyDown(event: KeyboardEvent<HTMLButtonElement>, choice: ThemeMode): void {
    const currentIndex = THEME_CHOICES.indexOf(choice);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % THEME_CHOICES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + THEME_CHOICES.length) % THEME_CHOICES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = THEME_CHOICES.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextChoice = THEME_CHOICES[nextIndex];
    onSelect(nextChoice);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-theme-choice="${nextChoice}"]`)
      ?.focus();
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="sr-only" id="theme-label">Theme</span>
      <div className="app-theme-toggle" role="radiogroup" aria-labelledby="theme-label">
        {THEME_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => onSelect(choice)}
            onKeyDown={(event) => onChoiceKeyDown(event, choice)}
            className={`app-theme-choice ${mode === choice ? "app-theme-choice-active" : ""}`}
            role="radio"
            aria-checked={mode === choice}
            tabIndex={mode === choice || (mode === null && choice === "system") ? 0 : -1}
            data-theme-choice={choice}
            title={`Use ${choice} theme`}
          >
            {choice[0].toUpperCase() + choice.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
