import type { Metadata } from "next";
import "@/components/auth/nx.css";
import { WelcomeChoice } from "@/components/auth/welcome-choice";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Welcome · ${APP_NAME}`, robots: { index: false, follow: false } };

// R15 A2 first run (behind the session proxy): the personal space already exists; pick how to go on.
export default function WelcomePage() {
  return (
    <div className="nx">
      <WelcomeChoice app={APP_NAME} />
    </div>
  );
}
