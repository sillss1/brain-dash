# brain-dash

A Claude Code mod that shows how much room the session has left, plus your deadlines, in a pane
next to the code:

- **Context:** a bar with the auto-compact threshold marked, a per-turn sparkline, and roughly
  how many turns are left at the current pace. Only growth since the last compaction or `/clear`
  counts as pace, and subagent turns are ignored.
- **Plan limits (5-hour and weekly windows):** elapsed time against usage, and a linear
  projection of where usage will be at reset at the average rate so far. When the projection
  passes 100% it shows when the window runs out.
- **Deadline radar:** a 21-day calendar and a list of deadlines, read from a plain file in your
  project. Overdue items stay visible for two weeks, and critical ones until you tick them off.

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

## Deadlines in one file

Create `DEADLINES.md` at the project root, with one deadline per line:

```markdown
# Deadlines
- [ ] 2026-10-15 Submit the report !
- [ ] 20/10/2026 Networks exam
- [x] 2026-10-01 Already done
- Email the advisor !
Notes without a date are ignored.
```

- A date is `YYYY-MM-DD` or `DD/MM/YYYY`, anywhere in the line. The rest of the line is the text.
- A `!` at the end of a line marks it **critical**: red in the radar, and kept on screen after it
  is overdue.
- A ticked box (`[x]`) means done, and the line is skipped. Headings and lines without a date are
  ignored, so the file can hold notes.
- A list item with no date that ends in `!` goes under "sem data" (critical, no date yet).

The radar reloads the file at the end of the turn after you save it.

## Or from your own command

To use a deadline source you already have (a script, a calendar export, a task tool), set
`radar_command`. Its output replaces the file. The command runs at the project root every
30 minutes, and on the pane's `r` key. It runs without a shell, so wrap pipes in `sh -c '...'`.
It can print the same line format, or JSON:

```json
{
  "deadlines": [{ "date": "2026-10-15", "text": "Submit the report", "critical": true }],
  "undated": ["Email the advisor"],
  "warnings": ["2 items to review"]
}
```

A plain array of deadlines also works. Keys can be English or Portuguese (`prazos`, `data`,
`texto`, `critico`, `sem_data`, `avisos`). Unknown fields are ignored. A command that exits
non-zero, times out after 20 seconds or prints invalid JSON turns the radar red with the reason.
The same happens to a file that cannot be read. The mod never stays silent about a radar that
did not run.

## Options

Set them in `/config`. A change reloads the mod.

| Option | Default | |
|---|---|---|
| `radar_file` | `DEADLINES.md` | Relative to the project root. A `.json` file uses the JSON format |
| `radar_command` | *(empty)* | When set, replaces the file |
| `radar_days` | `21` | How many days ahead the radar shows (1–90) |

With no file and no command there is no radar. The band shows usage only, and the pane explains
how to add deadlines.

## What it touches

- No network access, and it never writes files.
- It does not listen to prompts or tool calls. It reads the session usage measurements that
  Claude Code already reports (context, rate limits, cost) and your deadlines file.
- The only process it starts is `radar_command`, and only if you set it.

## Tests

```
claude plugin test brain-dash
```

23 tests. They cover the projections, both deadline formats, the radar window, the drawing, and
the mod running in the engine on both the terminal and Desktop surfaces.
