"use client";
import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Browser side of Better Auth (R15 A2). Google is always a full-page redirect (works in an installed PWA).
export const authClient = createAuthClient({ plugins: [passkeyClient(), emailOTPClient()] });
