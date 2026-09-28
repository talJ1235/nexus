"use client";

import { Component, type ReactNode } from "react";

/** Keeps a crash inside one panel from taking down the whole app. */
export class PanelBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(`[Nexus] ${this.props.label} crashed:`, error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="fixed bottom-4 end-4 z-[60] flex max-w-sm items-center gap-3 rounded-xl border border-danger/40 bg-raised p-3 text-sm shadow-pop">
        <span className="min-w-0 flex-1">Something went wrong in {this.props.label}.</span>
        <button type="button" onClick={() => this.setState({ failed: false })} className="rounded-lg bg-sunken px-2.5 py-1 text-xs font-medium hover:bg-line">
          Retry
        </button>
      </div>
    );
  }
}
