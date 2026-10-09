"use client";

import { useI18n } from "@/components/providers";

/** R17 S3 — the three steps to allow notifications again in this browser (blocked = `denied`), or to install on iPhone. */
export function AllowSteps({ phone, iphone }: { phone: boolean; iphone?: boolean }) {
  const { t } = useI18n();
  const a = t.nt.ask;
  const steps = iphone ? [a.iphone1, a.iphone2, a.iphone3] : phone ? [a.step1Phone, a.step2Phone, a.step3Phone] : [a.step1, a.step2, a.step3];
  return (
    <div className="steps grow-in" data-nt-steps={iphone ? "iphone" : "blocked"}>
      {steps.map((s, i) => (
        <div key={i}>
          <span className="n">{i + 1}</span>
          <span className="bidi">{s}</span>
        </div>
      ))}
    </div>
  );
}
