import { formatTimestampWithAge } from "../lib/format";

export function Timestamp({
  value,
  emptyLabel = "Never"
}: {
  value: string | null | undefined;
  emptyLabel?: string;
}) {
  if (!value) {
    return <>{emptyLabel}</>;
  }

  return <time dateTime={value}>{formatTimestampWithAge(value, emptyLabel)}</time>;
}
