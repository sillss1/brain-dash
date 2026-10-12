# brain-dash

A Claude Code mod that shows how much room the session has left, next to the code:

- **Context:** a bar with the auto-compact threshold marked, a per-turn sparkline, and roughly
  how many turns are left at the current pace. Only growth since the last compaction or `/clear`
  counts as pace, and subagent turns are ignored.
- **Plan limits (5-hour and weekly windows):** elapsed time against usage, and a linear
  projection of where usage will be at reset at the average rate so far. When the projection
  passes 100% it shows when the window runs out.
- **Deadline radar (optional):** a 21-day calendar and a list of deadlines. It is read from a
  script in the project (see below). Projects without that script show usage only.

The pane opens on its own at startup when there is room: fullscreen renderer (`/tui fullscreen`)
and at least 144 columns. `/brain` toggles it. When the pane is closed or does not fit, a one-line
summary sits above the prompt. If the pane cannot be placed, a toast says why.

The UI text is in Portuguese.

## Install

```
/plugin marketplace add sillss1/brain-dash
/plugin install brain-dash@sillss1
/reload-plugins
```

## What it touches

- No network access, and it never writes files.
- It does not listen to prompts or tool calls. It reads only the session usage measurements
  (context, rate limits, cost) that Claude Code already reports.
- The only process it starts is the radar script, and only if that script exists in the project.

## The radar contract

At the project root, if `system/scripts/agenda.py` exists, the mod runs
`python system/scripts/agenda.py --json` every 30 minutes. It also re-runs the script when
`personal/academic-deadlines.yaml` changes. It looks for a Python interpreter in this order:
`system/.venv`, then `python3`, then `python`. The script must print the JSON described by the
`Radar` type in [`brain-dash/types/index.d.ts`](brain-dash/types/index.d.ts), without `lidoEm`:

```json
{
  "hoje": "2026-10-11",
  "janela_dias": 21,
  "prazos": [{ "data": "2026-10-13", "dias": 2, "quando": "13/10 2d", "texto": "Networks — project 1", "critico": true }],
  "sem_data": [],
  "por_espelhar": [],
  "sem_avaliacao": [],
  "falha": null
}
```

If the script fails, the band and the pane say so in red. The mod never stays silent about a
radar that did not run.

## Tests

```
claude plugin test brain-dash
```

16 tests. They cover the projections, the drawing, and the mod running in the engine on both
the terminal and Desktop surfaces.
