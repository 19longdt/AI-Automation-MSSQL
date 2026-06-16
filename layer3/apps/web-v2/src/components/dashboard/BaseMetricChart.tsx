import type { ReactElement } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface BaseMetricChartLine {
  dataKey: string;
  name: string;
  stroke: string;
  hide?: boolean;
  yAxisId?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeOpacity?: number;
}

export interface BaseMetricChartAxis {
  id?: string;
  orientation?: "left" | "right";
  width?: number;
  tickFormatter?: (value: number) => string;
}

export interface BaseMetricChartReferenceLine {
  y: number;
  stroke: string;
  yAxisId?: string;
  strokeDasharray?: string;
}

export function BaseMetricChart<TData extends object>({
  data,
  height = 320,
  lines,
  yAxes,
  tooltip,
  referenceLines = [],
  margin,
}: {
  data: TData[];
  height?: number;
  lines: BaseMetricChartLine[];
  yAxes: BaseMetricChartAxis[];
  tooltip: ReactElement;
  referenceLines?: BaseMetricChartReferenceLine[];
  margin?: { top?: number; right?: number; left?: number; bottom?: number };
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" debounce={80}>
        <LineChart data={data} margin={margin}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="ts"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
          />
          {yAxes.map((axis, index) => (
            <YAxis
              key={axis.id ?? `y-${index}`}
              yAxisId={axis.id}
              orientation={axis.orientation}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={axis.width ?? 56}
              tickFormatter={axis.tickFormatter}
            />
          ))}
          <Tooltip content={tooltip} isAnimationActive={false} cursor={false} />
          {referenceLines.map((line, index) => (
            <ReferenceLine
              key={`${line.yAxisId ?? "default"}-${line.y}-${index}`}
              yAxisId={line.yAxisId}
              y={line.y}
              stroke={line.stroke}
              strokeDasharray={line.strokeDasharray ?? "4 4"}
            />
          ))}
          {lines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.stroke}
              strokeWidth={line.strokeWidth ?? 2.25}
              strokeDasharray={line.strokeDasharray}
              strokeOpacity={line.strokeOpacity}
              yAxisId={line.yAxisId}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              hide={line.hide}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
