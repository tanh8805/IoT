import { ALERT_STATUS_LABEL, CMD_STATUS_LABEL, DeviceState, STATE_LABEL } from './api';

export function StateBadge({ state }: { state: DeviceState }) {
  return <span className={`badge st-${state}`}>{STATE_LABEL[state]}</span>;
}
export function StatusBadge({ kind, value }: { kind: 'cmd' | 'alert'; value: string }) {
  const label = kind === 'cmd' ? CMD_STATUS_LABEL[value] : ALERT_STATUS_LABEL[value];
  return <span className={`badge ${kind}-${value}`}>{label}</span>;
}
export function Msg({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="msg err">{error}</div>;
  if (ok) return <div className="msg ok">{ok}</div>;
  return null;
}
