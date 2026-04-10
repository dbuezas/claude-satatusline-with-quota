export interface RateLimitWindow {
  used_percentage?: number;
  resets_at?: number; // unix epoch seconds
}

export interface StatusLineInput {
  version: string;
  model?: { display_name?: string };
  workspace?: { current_dir?: string };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  context_window?: { used_percentage?: number };
  rate_limits?: {
    five_hour?: RateLimitWindow;
    seven_day?: RateLimitWindow;
  };
}

// Colors
const colors = {
  reset: "\x1b[0m",
  white: { fg: "\x1b[97m" },
  cyan: { fg: "\x1b[96m" },
  green: { fg: "\x1b[92m" },
  red: { fg: "\x1b[91m" },
  gray: { bg: "\x1b[100m" },
  darkGray: { bg: "\x1b[48;5;238m" },
};

// Green (hue 120°) → Yellow (60°) → Red (0°) via HSL interpolation
function colorRGB(pct: number): [number, number, number] {
  const p = Math.max(0, Math.min(100, pct));
  const hue = (1 - p / 100) * 120; // 120° → 0°
  const s = 1,
    l = 0.4;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = hue < 60 ? [c, x, 0] : [x, c, 0];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

const BAR_WIDTH = 45;

function makeBar(
  pct?: number,
  left = "",
  right = "",
  markerPct?: number,
): string | undefined {
  if (pct === undefined) return undefined;
  const width = BAR_WIDTH;
  const filled = Math.min(Math.round((pct * width) / 100), width);
  const markerEnd =
    markerPct !== undefined
      ? Math.min(Math.round((markerPct * width) / 100), width)
      : 0;
  const padding = Math.max(0, width - left.length - right.length);
  const text = (left + " ".repeat(padding) + right).slice(0, width);

  let bar = "";
  let prevBg = "";
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      const cellPct = (i / (width - 1)) * 100;
      const dark = i < markerEnd;
      let [r, g, b] = colorRGB(cellPct);
      if (dark) {
        r = Math.round(r * 0.5);
        g = Math.round(g * 0.5);
        b = Math.round(b * 0.5);
      }
      const bg = `\x1b[48;2;${r};${g};${b}m`;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const fg = lum > 100 ? "\x1b[30m" : "\x1b[97m";
      if (bg !== prevBg) {
        bar += bg + fg;
        prevBg = bg;
      }
      bar += text[i];
    } else if (i < markerEnd) {
      if (prevBg !== "darkGray") {
        bar += colors.darkGray.bg + colors.white.fg;
        prevBg = "darkGray";
      }
      bar += text[i];
    } else {
      if (prevBg !== "gray") {
        bar += colors.gray.bg + colors.white.fg;
        prevBg = "gray";
      }
      bar += text[i];
    }
  }
  return bar + colors.reset;
}

function calcPacing(resetsAt: number, windowSecs: number): number | undefined {
  const resetEpoch = resetsAt * 1000;
  if (!Number.isFinite(resetEpoch)) return undefined;
  const now = Date.now();
  const windowStart = resetEpoch - windowSecs * 1000;
  const elapsed = Math.max(0, Math.min(now - windowStart, windowSecs * 1000));
  return Math.round((elapsed / (windowSecs * 1000)) * 100);
}

function fmtReset(resetsAt: number): string {
  const resetDate = new Date(resetsAt * 1000);
  if (isNaN(resetDate.getTime())) return "?";
  const diffMs = resetDate.getTime() - Date.now();

  const hour = resetDate.getHours();
  const ampm = hour >= 12 ? "pm" : "am";
  const h12 = hour % 12 || 12;
  const timeStr = `${h12}${ampm}`;

  if (diffMs <= 86400_000) {
    return timeStr;
  }
  const dow = resetDate
    .toLocaleDateString("en-US", { weekday: "short" })
    .toLowerCase();
  return `${dow}, ${timeStr}`;
}

const FIVE_HOURS = 5 * 3600;
const SEVEN_DAYS = 7 * 86400;

type QuotaInfo = { label: string; pct: number; pace?: number } | undefined;

function fmtQuotaLabel(
  data: RateLimitWindow | undefined,
  windowSecs: number,
): QuotaInfo {
  if (data?.used_percentage === undefined || data.resets_at === undefined)
    return undefined;
  const pct = Math.round(data.used_percentage);
  const pace = calcPacing(data.resets_at, windowSecs);
  const reset = fmtReset(data.resets_at);
  return { label: ` ${pct}% @${reset}`, pct, pace };
}

export function render(input: StatusLineInput, branch: string): void {
  const model = input.model?.display_name ?? "";
  const dir = input.workspace?.current_dir ?? "";
  const cost = input.cost?.total_cost_usd ?? 0;
  const rawPct = input.context_window?.used_percentage ?? 0;
  const EFFECTIVE_CONTEXT_SIZE_PCT = 100 - 3.3;
  const pct = Math.min(
    100,
    Math.trunc((rawPct / EFFECTIVE_CONTEXT_SIZE_PCT) * 100),
  );
  const durationMs = input.cost?.total_duration_ms ?? 0;
  const linesAdded = input.cost?.total_lines_added ?? 0;
  const linesRemoved = input.cost?.total_lines_removed ?? 0;

  const q5h = fmtQuotaLabel(input.rate_limits?.five_hour, FIVE_HOURS);
  const q7d = fmtQuotaLabel(input.rate_limits?.seven_day, SEVEN_DAYS);

  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);
  const dirName = dir.split("/").pop() ?? dir;
  const costFmt = `$${cost.toFixed(2)}`;

  process.stdout.write(
    [
      `${colors.cyan.fg}${dirName}${colors.reset}${branch ? ` ${branch}` : ""}${linesAdded || linesRemoved ? ` ${colors.green.fg}+${linesAdded}${colors.reset} ${colors.red.fg}-${linesRemoved}${colors.reset}` : ""}`,
      makeBar(pct, ` CTX ${pct}%`, `${model} `),
      makeBar(
        q5h?.pct,
        q5h?.label,
        `${costFmt} │ ${mins}m${secs}s `,
        q5h?.pace,
      ),
      makeBar(q7d?.pct, q7d?.label, "", q7d?.pace),
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );
}
