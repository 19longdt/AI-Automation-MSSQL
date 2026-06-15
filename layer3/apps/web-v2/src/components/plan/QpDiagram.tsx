import { QpCanvas } from "@/components/plan/QpCanvas";

interface Props {
  xml: string;
  onError?: (msg: string) => void;
}

const QP_WRAP_STYLE = {
  "--qp-block-height": "calc(100vh - 280px)",
  "--qp-block-height-dvh": "calc(100dvh - 280px)",
} as React.CSSProperties;

export function QpDiagram({ xml, onError }: Props) {
  return <QpCanvas xml={xml} onError={onError} style={QP_WRAP_STYLE} ariaLabel="SQL execution plan diagram" />;
}
