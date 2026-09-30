// sonner's toast with one house rule: toasts that carry an action (Undo, Open…) stay up ~7 s instead of 4 s.
import { toast as base, type ExternalToast } from "sonner";

type Message = Parameters<typeof base>[0];
type Fn = (message: Message, data?: ExternalToast) => string | number;

const withAction = (data?: ExternalToast) => (data?.action && data.duration == null ? { ...data, duration: 7000 } : data);
const wrap = (fn: Fn): Fn => (message, data) => fn(message, withAction(data));

export const toast = Object.assign(wrap(base), {
  ...base,
  success: wrap(base.success),
  error: wrap(base.error),
  warning: wrap(base.warning),
  info: wrap(base.info),
  message: wrap(base.message),
});
