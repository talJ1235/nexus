// sonner's toast with one house rule: toasts that carry an action (Undo, Open…) stay up ~7 s instead of 4 s.
import { toast as base, type ExternalToast } from "sonner";
import { recordClientError } from "./client-errors";

type Message = Parameters<typeof base>[0];
type Fn = (message: Message, data?: ExternalToast) => string | number;

const withAction = (data?: ExternalToast) => (data?.action && data.duration == null ? { ...data, duration: 7000 } : data);
const wrap = (fn: Fn): Fn => (message, data) => fn(message, withAction(data));

export const toast = Object.assign(wrap(base), {
  ...base,
  success: wrap(base.success),
  // Error toasts are also remembered for problem reports (lib/client-errors).
  error: wrap((message, data) => {
    recordClientError("toast", typeof message === "string" ? message : data?.description ?? "error");
    return base.error(message, data);
  }),
  warning: wrap(base.warning),
  info: wrap(base.info),
  message: wrap(base.message),
});
