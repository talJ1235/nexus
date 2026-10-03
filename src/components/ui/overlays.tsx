"use client";

import { Dialog as D, DropdownMenu as M, Popover as P } from "radix-ui";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Layering rule (Round 11 B1): every overlay surface (Modal, Sheet, full-screen cameras, command menu) sits on the same
 * z-layer, so the one opened last — portalled last — is always the one on top; Radix closes only the top layer on an
 * outside click or Esc. Something opened from inside a surface is either a sub-page of it (`onBack`: a back arrow in the
 * header, Esc goes back) or a new surface fully on top.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  onBack,
  backLabel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** Showing a sub-page: a back arrow before the title; Esc goes back instead of closing. */
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] overlay-in" />
        <D.Content
          onInteractOutside={keepOpenForToasts}
          onEscapeKeyDown={(e) => {
            if (!onBack) return;
            e.preventDefault();
            onBack();
          }}
          onOpenAutoFocus={(e) => {
            // Focus the first field if the dialog has one; otherwise the dialog itself (no stray ring on the close button).
            const root = e.currentTarget as HTMLElement;
            if (!root.querySelector("[autofocus], input:not([type=hidden]), textarea")) {
              e.preventDefault();
              root.focus();
            }
          }}
          className={cn(
            "fixed inset-x-0 top-[10vh] z-50 mx-auto max-h-[84vh] w-[calc(100vw-24px)] max-w-md animate-pop-in overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-pop outline-none",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            {onBack && (
              <button type="button" onClick={onBack} className="-m-1 -me-2 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sunken hover:text-fg" aria-label={backLabel} data-modal-back>
                <ArrowLeft className="size-4 rtl:-scale-x-100" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <D.Title className="text-base font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="-m-1 rounded-md p-1 text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// A modal dialog/sheet treats clicks on a toast (Undo, close) as "outside" and would close; toasts sit above it.
const keepOpenForToasts = (e: Event) => {
  if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
};

// Radix focuses the first tabbable element inside the sheet synchronously on mount; that focus() forces a full
// style + layout of the freshly mounted sheet inside the same task as React's commit (~half the "open item" long
// task under CPU ×4). Focus the sheet itself on the next frame instead (no scroll), so the commit and the first
// layout land in separate tasks. The focus trap still holds; Tab moves to the first control as before.
const deferredSheetFocus = (e: Event) => {
  e.preventDefault();
  const root = e.currentTarget as HTMLElement;
  requestAnimationFrame(() => {
    if (root.isConnected && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
  });
};

/** Side sheet: slides from the inline-end edge (right in LTR, left in RTL). Full screen on mobile. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = "end",
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
  side?: "start" | "end";
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35 overlay-in" />
        <D.Content
          onInteractOutside={keepOpenForToasts}
          onOpenAutoFocus={deferredSheetFocus}
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col bg-surface shadow-pop outline-none sm:max-w-[520px]",
            side === "end" ? "end-0 border-s border-line sheet-in-end" : "start-0 border-e border-line sheet-in-start",
            className,
          )}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export const SheetClose = D.Close;

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-[200px] animate-pop-in rounded-xl border border-line bg-raised p-1 shadow-pop", className)}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}
export function MenuItem({ className, danger, ...props }: M.DropdownMenuItemProps & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-sunken [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}
export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <M.Label className="px-2.5 pb-1 pt-2 text-xs text-faint">{children}</M.Label>;
}
export const MenuRadioGroup = M.RadioGroup;
export function MenuRadioItem({ className, children, ...props }: M.DropdownMenuRadioItemProps) {
  return (
    <M.RadioItem
      className={cn(
        "flex h-9 cursor-default select-none items-center justify-between gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-sunken",
        className,
      )}
      {...props}
    >
      {children}
      <M.ItemIndicator>
        <span className="block size-1.5 rounded-full bg-accent" />
      </M.ItemIndicator>
    </M.RadioItem>
  );
}

export const Pop = P.Root;
export const PopTrigger = P.Trigger;
export function PopContent({ children, className, align = "start" }: { children: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={6} className={cn("z-50 animate-pop-in rounded-xl border border-line bg-raised p-3 shadow-pop outline-none", className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}
