import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProfileSheet } from "./ProfileSheet";

const props = () => ({
  open: true,
  onClose: vi.fn(),
  user: { id: "u1", name: "Karthik", email: "user@example.test" },
  dark: false,
  onToggleDark: vi.fn(),
  customView: "all" as const,
  onChangeCustomView: vi.fn(),
  onLogout: vi.fn(),
  onNavigate: vi.fn(),
  palette: "coral" as const,
  onChangePalette: vi.fn(),
});

describe("ProfileSheet", () => {
  it("uses the common named frame and keeps appearance controls accessible", () => {
    const callbacks = props();
    render(<ProfileSheet {...callbacks} />);
    expect(
      screen.getByRole("dialog", { name: "Profile and settings" }),
    ).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Toggle dark mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("type", "button");
    fireEvent.click(toggle);
    expect(callbacks.onToggleDark).toHaveBeenCalledOnce();
    const palette = screen.getByRole("button", { name: "Coral Fire" });
    expect(palette).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(palette);
    expect(callbacks.onChangePalette).toHaveBeenCalledWith("coral");
    fireEvent.click(
      screen.getByRole("button", { name: "Close Profile and settings" }),
    );
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it("routes supported destinations and closes the frame; admin remains role gated", () => {
    const callbacks = props();
    render(<ProfileSheet {...callbacks} />);
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Weekly Review" }));
    expect(callbacks.onNavigate).toHaveBeenCalledWith("review");
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it("cycles the custom tab and signs out through their owner callbacks", () => {
    const callbacks = props();
    render(<ProfileSheet {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /Custom tab:/ }));
    expect(callbacks.onChangeCustomView).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(callbacks.onLogout).toHaveBeenCalledOnce();
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it("keeps Tasks and Focus accessible without changing the custom tab", () => {
    const callbacks = props();
    render(<ProfileSheet {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(callbacks.onNavigate).toHaveBeenCalledWith("tasks");
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(callbacks.onNavigate).toHaveBeenCalledWith("focus");
    expect(callbacks.onChangeCustomView).not.toHaveBeenCalled();
    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
  });
});
